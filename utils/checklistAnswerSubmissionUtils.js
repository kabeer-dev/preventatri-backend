const {
  getAllQuestionsFromTemplate,
  getMissingRequiredQuestions,
  getInvalidQuestionIds,
  getOffendingAttachmentQuestions,
  validateAnswerValues,
} = require('./assessmentsUtils');
const {uploadFile, deleteFile} = require('./fileUtils');

const {
  MAX_ATTACHMENTS_PER_QUESTION,
} = require('../constants/assessmentConstants');

const {
  WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES,
} = require('../constants/workItemConstants');

const {AssessmentsErrorsFactories} = require('../factories');
const {AssessmentsServices} = require('../services');

// Checklist answers + evidence uploads shared by every work item that carries
// a checklist (follow-up tasks, supervisory visits). Answers are validated
// against the template, photos land under `fileDir` on S3 and every upload
// can be rolled back when the surrounding write fails.

function groupFilesByAnswerQuestion({files, answeredQuestionIds}) {
  const filesByQuestion = {};
  const answeredSet = new Set(answeredQuestionIds);

  for (const file of files) {
    const separatorIndex = file.fieldname.indexOf('_');
    if (separatorIndex === -1) continue;

    const type = file.fieldname.substring(0, separatorIndex);
    if (!WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES.includes(type)) continue;

    const questionId = file.fieldname
      .substring(separatorIndex + 1)
      .toLowerCase();

    if (!answeredSet.has(questionId)) continue;

    if (!filesByQuestion[questionId]) {
      filesByQuestion[questionId] = [];
    }

    filesByQuestion[questionId].push(file);
  }

  return {filesByQuestion};
}

// All-or-nothing: a single failed upload deletes the ones that succeeded.
async function settleUploads({uploadPromises}) {
  const results = await Promise.allSettled(uploadPromises);
  const uploaded = [];

  for (const result of results) {
    if (result.status === 'fulfilled') uploaded.push(result.value);
  }

  if (uploaded.length === results.length) return uploaded;

  for (const file of uploaded) {
    try {
      await deleteFile({key: file.key});
    } catch {
      // Best-effort cleanup
    }
  }

  const firstError = results.find((r) => r.status === 'rejected');
  throw firstError.reason;
}

const toStoredFile = ({file, url, key}) => ({
  url,
  key,
  mimeType: file.mimetype,
  originalName: file.originalname,
});

async function buildAnswersWithFiles({answers, filesByQuestion, fileDir}) {
  const uploadPromises = [];

  for (const answer of answers) {
    const answerFiles = filesByQuestion[answer.questionId] || [];

    for (const file of answerFiles) {
      uploadPromises.push(
        uploadFile({file, fileDir}).then(({url, key}) =>
          Object.assign(
            {questionId: answer.questionId},
            toStoredFile({file, url, key})
          )
        )
      );
    }
  }

  const uploadedFiles = await settleUploads({uploadPromises});
  const uploadedFilesByQuestion = {};

  for (const uploadedFile of uploadedFiles) {
    if (!uploadedFilesByQuestion[uploadedFile.questionId]) {
      uploadedFilesByQuestion[uploadedFile.questionId] = [];
    }

    uploadedFilesByQuestion[uploadedFile.questionId].push({
      url: uploadedFile.url,
      key: uploadedFile.key,
      mimeType: uploadedFile.mimeType,
      originalName: uploadedFile.originalName,
    });
  }

  return answers.map((answer) => ({
    questionId: answer.questionId,
    value: answer.value,
    comment: answer.comment || null,
    files: uploadedFilesByQuestion[answer.questionId] || [],
  }));
}

async function uploadEvidenceFiles({files, fileDir}) {
  if (!files || files.length === 0) return [];

  return settleUploads({
    uploadPromises: files.map((file) =>
      uploadFile({file, fileDir}).then(({url, key}) =>
        toStoredFile({file, url, key})
      )
    ),
  });
}

async function cleanupEvidenceFiles({files}) {
  for (const file of files || []) {
    try {
      await deleteFile({key: file.key});
    } catch {
      // Best-effort cleanup; deleteFile already logs failures.
    }
  }
}

async function cleanupUploadedAnswerFiles({answersWithFiles}) {
  for (const answer of answersWithFiles) {
    await cleanupEvidenceFiles({
      files: Array.isArray(answer.files) ? answer.files : [],
    });
  }
}

/**
 * Validates `body.answers` against the template and uploads their photos.
 * Existence only on the template: an item already in flight must stay
 * submittable even if its template was archived.
 *
 * @returns {Promise<{answers, cleanupOnError}>}
 */
async function prepareChecklistAnswers({
  checklistTemplateId,
  body,
  files,
  fileDir,
  templateNotFoundErr = AssessmentsErrorsFactories.templateNotFoundErr,
}) {
  const reqFiles = Array.isArray(files) ? files : [];
  const {answers} = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    throw AssessmentsErrorsFactories.requiredQuestionsUnansweredErr({
      missingQuestions: [],
    });
  }

  const {doc: template} = await AssessmentsServices.getTemplateById({
    id: checklistTemplateId,
  });

  if (!template) throw templateNotFoundErr();

  for (const answer of answers) {
    answer.questionId = answer.questionId.toLowerCase();
  }

  const allQuestions = getAllQuestionsFromTemplate({template});
  const answeredQuestionIds = answers.map((a) => a.questionId);

  const missingRequired = getMissingRequiredQuestions({
    allQuestions,
    answeredQuestionIds,
  });

  if (missingRequired.length > 0) {
    throw AssessmentsErrorsFactories.requiredQuestionsUnansweredErr({
      missingQuestions: missingRequired.map((q) => ({
        id: q.id,
        title: q.title,
      })),
    });
  }

  const invalidIds = getInvalidQuestionIds({allQuestions, answeredQuestionIds});

  if (invalidIds.length > 0) {
    throw AssessmentsErrorsFactories.invalidFieldsErr({
      customMessage: 'Some question IDs do not belong to this template',
    });
  }

  const invalidAnswers = validateAnswerValues({allQuestions, answers});

  if (invalidAnswers.length > 0) {
    throw AssessmentsErrorsFactories.invalidAnswerValuesErr({invalidAnswers});
  }

  const {filesByQuestion} = groupFilesByAnswerQuestion({
    files: reqFiles,
    answeredQuestionIds,
  });

  const offendingQuestions = getOffendingAttachmentQuestions({filesByQuestion});

  if (offendingQuestions.length > 0) {
    throw AssessmentsErrorsFactories.tooManyAttachmentsPerQuestionErr({
      maxAllowed: MAX_ATTACHMENTS_PER_QUESTION,
      offendingQuestions,
    });
  }

  const answersWithFiles = await buildAnswersWithFiles({
    answers,
    filesByQuestion,
    fileDir,
  });

  return {
    answers: answersWithFiles,
    cleanupOnError: () => cleanupUploadedAnswerFiles({answersWithFiles}),
  };
}

module.exports = {
  groupFilesByAnswerQuestion,
  buildAnswersWithFiles,
  uploadEvidenceFiles,
  cleanupEvidenceFiles,
  cleanupUploadedAnswerFiles,
  prepareChecklistAnswers,
};
