const {getCurrentTime} = require('./dateUtils');

const {uploadFile, deleteFile} = require('./fileUtils');

const {
  CHECKLIST_FIELD_TYPES,
  CHECKLIST_OPTION_FLAG_POINTS,
  CHECKLIST_TYPES_WITH_SCORED_OPTIONS,
  MAX_ATTACHMENTS_PER_QUESTION,
} = require('../constants/assessmentConstants');

const {
  RISK_SCORE_THRESHOLDS,
  RISK_SCORE_THRESHOLDS_ARR,
} = require('../constants/riskCalcConstants');

// The scored submission behind an AUTO flag, as the flag review views show it.
const flagSubmissionEvidenceSelect = {
  id: true,
  submittedAt: true,
  visitNotes: true,
  checklistTemplate: {
    select: {
      id: true,
      title: true,
      description: true,
      sections: {
        orderBy: {sortOrder: 'asc'},
        select: {
          id: true,
          title: true,
          sortOrder: true,
          questions: {
            orderBy: {sortOrder: 'asc'},
            select: {
              id: true,
              title: true,
              type: true,
              required: true,
              options: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  },
  answers: {
    where: {isDeleted: null},
    select: {
      id: true,
      questionId: true,
      value: true,
      comment: true,
      images: true,
    },
  },
};

/**
 * Builds a question's `options` JSON. Points are derived from the flag, and both
 * are dropped for template types that are not scored by answer points. Shared by
 * the create endpoint and the seed.
 */
function buildQuestionOptions({options = [], type}) {
  const isScored = CHECKLIST_TYPES_WITH_SCORED_OPTIONS.includes(type);

  return options.map((option) =>
    isScored
      ? {
          title: option.title,

          // A draft may not have picked a flag yet; publishing requires one.
          flag: option.flag ?? null,
          points: CHECKLIST_OPTION_FLAG_POINTS[option.flag] ?? 0,
        }
      : {title: option.title}
  );
}

/**
 * Builds the Prisma nested create for a template's sections and questions.
 * sortOrder is taken from array position, so client-supplied ordering is ignored.
 */
function buildSectionsNestedCreate({sections, type}) {
  return sections.map((section, sIdx) => ({
    title: section.title,
    sortOrder: sIdx,
    questions: {
      create: section.questions.map((question, qIdx) => ({
        title: question.title,
        type: question.type,
        required: question.required || false,
        placeholder: question.placeholder || null,
        sortOrder: qIdx,
        options: buildQuestionOptions({options: question.options, type}),
      })),
    },
  }));
}

function getAllQuestionsFromTemplate({template}) {
  const allQuestions = [];
  for (const section of template.sections) {
    for (const question of section.questions) {
      allQuestions.push(question);
    }
  }

  return allQuestions;
}

function getMissingRequiredQuestions({allQuestions, answeredQuestionIds}) {
  const answeredSet = new Set(answeredQuestionIds);

  return allQuestions.filter((q) => q.required && !answeredSet.has(q.id));
}

function getInvalidQuestionIds({allQuestions, answeredQuestionIds}) {
  const validQuestionIds = new Set(allQuestions.map((q) => q.id));

  return answeredQuestionIds.filter((id) => !validQuestionIds.has(id));
}

function getOffendingAttachmentQuestions({filesByQuestion}) {
  return Object.entries(filesByQuestion)
    .filter(([, qFiles]) => qFiles.length > MAX_ATTACHMENTS_PER_QUESTION)
    .map(([questionId, qFiles]) => ({questionId, count: qFiles.length}));
}

function groupImagesByQuestion({files, answeredQuestionIds}) {
  const imageFilesByQuestion = {};
  const answeredSet = new Set(answeredQuestionIds);

  for (const file of files) {
    const separatorIndex = file.fieldname.indexOf('_');
    if (separatorIndex === -1) continue;

    const type = file.fieldname.substring(0, separatorIndex);

    const questionId = file.fieldname.substring(separatorIndex + 1);

    if (!answeredSet.has(questionId)) continue;

    if (type === 'images') {
      imageFilesByQuestion[questionId] = [file];
    }
  }

  return {imageFilesByQuestion};
}

async function buildAnswersWithImages({
  answers,
  imageFilesByQuestion,
  fileDir,
}) {
  if (Object.keys(imageFilesByQuestion).length === 0) {
    return answers;
  }

  // Upload all images in parallel across all questions
  const uploadPromises = [];

  for (const answer of answers) {
    const imageFiles = imageFilesByQuestion[answer.questionId];
    if (imageFiles && imageFiles.length > 0) {
      for (const imageFile of imageFiles) {
        uploadPromises.push(
          uploadFile({file: imageFile, fileDir}).then(({url, key}) => ({
            questionId: answer.questionId,
            url,
            key,
          }))
        );
      }
    }
  }

  const uploadedImages = await Promise.all(uploadPromises);

  // Group uploaded images by questionId
  const imagesByQuestion = {};
  for (const img of uploadedImages) {
    if (!imagesByQuestion[img.questionId]) {
      imagesByQuestion[img.questionId] = [];
    }
    imagesByQuestion[img.questionId].push({url: img.url, key: img.key});
  }

  // Build final answers array
  return answers.map((answer) => {
    const answerData = {
      questionId: answer.questionId,
      value: answer.value,
      comment: answer.comment,
    };

    if (imagesByQuestion[answer.questionId]) {
      answerData.images = imagesByQuestion[answer.questionId];
    }

    return answerData;
  });
}

function validateAnswerValues({allQuestions, answers}) {
  const questionMap = Object.fromEntries(allQuestions.map((q) => [q.id, q]));
  const invalidAnswers = [];

  for (const answer of answers) {
    const question = questionMap[answer.questionId];
    if (!question) continue;

    const {value} = answer;

    if (value === null || value === undefined || value === '') {
      if (question.required)
        invalidAnswers.push({
          questionId: answer.questionId,
          message: 'Required question must have a value',
        });

      continue;
    }

    const options = Array.isArray(question.options) ? question.options : [];

    // Only the chosen title is validated. Flag/points echoed by the client are
    // ignored -- scoring reads them from the template instead.
    const optionByTitle = new Map(
      options
        .map((o) => (typeof o === 'string' ? {title: o} : o))
        .filter((o) => o && typeof o.title === 'string')
        .map((o) => [o.title, o])
    );
    const validTitles = Array.from(optionByTitle.keys());
    let isValid = true;
    let message = '';

    switch (question.type) {
      case CHECKLIST_FIELD_TYPES.TEXTAREA.value:
        isValid = typeof value === 'string';
        message = 'Value must be a string';
        break;

      case CHECKLIST_FIELD_TYPES.NUMBER.value:
        {
          const rawNumber =
            value !== null && typeof value === 'object' ? value.title : value;

          // Number('') and Number(' ') are 0, so blank input must be rejected first.
          isValid =
            (typeof rawNumber === 'number' && !Number.isNaN(rawNumber)) ||
            (typeof rawNumber === 'string' &&
              rawNumber.trim() !== '' &&
              !Number.isNaN(Number(rawNumber)));
        }
        message = 'Value must be a number';
        break;

      case CHECKLIST_FIELD_TYPES.BOOLEAN.value:
        isValid =
          value === true ||
          value === false ||
          value === 'true' ||
          value === 'false';
        message = 'Value must be true or false';
        break;

      case CHECKLIST_FIELD_TYPES.SELECT.value:
        {
          const selectedTitle =
            typeof value === 'string' ? value : value?.title;
          isValid =
            typeof selectedTitle === 'string' &&
            optionByTitle.has(selectedTitle);
        }
        message = `Value must be one of: ${validTitles.join(', ')}`;
        break;

      case CHECKLIST_FIELD_TYPES.MULTI_SELECT.value:
        isValid =
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((v) => {
            const title = typeof v === 'string' ? v : v?.title;

            return typeof title === 'string' && optionByTitle.has(title);
          });
        message = `Each value must be one of: ${validTitles.join(', ')}`;
        break;

      case CHECKLIST_FIELD_TYPES.DATE.value:
        isValid = typeof value === 'string' && !isNaN(Date.parse(value));
        message = 'Value must be a valid date string';
        break;

      case CHECKLIST_FIELD_TYPES.CHECKBOX.value:
        isValid = value === 'yes' || value === 'no';
        message = 'Value must be "yes" or "no"';
        break;
    }

    if (!isValid) {
      invalidAnswers.push({
        questionId: question.id,
        title: question.title,
        message,
      });
    }
  }

  return invalidAnswers;
}

function getRemovedImageKeys({existingAnswers, imageFilesByQuestion}) {
  // Images are removed only when new files are uploaded for that questionId
  const removedKeys = [];
  for (const existingAnswer of existingAnswers) {
    if (existingAnswer.images && existingAnswer.images.length > 0) {
      if (imageFilesByQuestion[existingAnswer.questionId]) {
        for (const img of existingAnswer.images) {
          removedKeys.push(img.key);
        }
      }
    }
  }

  return removedKeys;
}

async function buildUpdateAnswersWithImages({
  answers,
  existingAnswers,
  imageFilesByQuestion,
  fileDir,
}) {
  // Build a map of existing images by questionId
  const existingImagesByQuestion = {};
  for (const existingAnswer of existingAnswers) {
    if (existingAnswer.images && existingAnswer.images.length > 0) {
      existingImagesByQuestion[existingAnswer.questionId] =
        existingAnswer.images;
    }
  }

  // Upload new images in parallel
  const uploadPromises = [];

  for (const answer of answers) {
    const imageFiles = imageFilesByQuestion[answer.questionId];
    if (imageFiles && imageFiles.length > 0) {
      for (const imageFile of imageFiles) {
        uploadPromises.push(
          uploadFile({file: imageFile, fileDir}).then(({url, key}) => ({
            questionId: answer.questionId,
            url,
            key,
          }))
        );
      }
    }
  }

  const uploadedImages = await Promise.all(uploadPromises);

  // Group newly uploaded images by questionId
  const newImagesByQuestion = {};
  for (const img of uploadedImages) {
    if (!newImagesByQuestion[img.questionId]) {
      newImagesByQuestion[img.questionId] = [];
    }
    newImagesByQuestion[img.questionId].push({url: img.url, key: img.key});
  }

  // Build final answers: new uploads replace old images, otherwise keep existing
  return answers.map((answer) => {
    const answerData = {
      questionId: answer.questionId,
      value: answer.value,
      comment: answer.comment,
    };

    if (newImagesByQuestion[answer.questionId]) {
      answerData.images = newImagesByQuestion[answer.questionId];
    } else if (existingImagesByQuestion[answer.questionId]) {
      answerData.images = existingImagesByQuestion[answer.questionId];
    }

    return answerData;
  });
}

async function cleanupRemovedImages({removedImageKeys}) {
  if (!removedImageKeys || removedImageKeys.length === 0) return;

  for (const key of removedImageKeys) {
    try {
      await deleteFile({key});
    } catch {
      // Best-effort cleanup — log is handled inside deleteFile
    }
  }
}

async function cleanupUploadedImages({answersWithFiles}) {
  for (const answer of answersWithFiles) {
    if (answer.images && answer.images.length > 0) {
      for (const image of answer.images) {
        try {
          await deleteFile({key: image.key});
        } catch {
          // Best-effort cleanup — log is handled inside deleteFile
        }
      }
    }
  }
}

/**
 * Scores a submission from the template's own points, not from whatever the
 * client echoed back -- an answer that omits points used to score zero.
 */
function calculateSubmissionRisk({answers, template}) {
  const pointsByQuestion = new Map(
    getAllQuestionsFromTemplate({template}).map((question) => [
      question.id,
      new Map(
        (question.options || []).map((option) => [option.title, option.points])
      ),
    ])
  );

  const totalScore = answers.reduce((score, {questionId, value}) => {
    if (value === null || value === undefined) return score;

    const pointsByTitle = pointsByQuestion.get(questionId);
    if (!pointsByTitle) return score;

    const items = Array.isArray(value) ? value : [value];

    return items.reduce((s, item) => {
      const title = typeof item === 'string' ? item : item?.title;
      const points = pointsByTitle.get(title);

      return typeof points === 'number' ? s + Math.max(0, points) : s;
    }, score);
  }, 0);

  const threshold =
    RISK_SCORE_THRESHOLDS_ARR.find(
      ({min, max}) => totalScore >= min && totalScore <= max
    ) ?? RISK_SCORE_THRESHOLDS.GREEN;

  return {
    flag: threshold.flag,
    riskScore: totalScore,
    riskCategory: threshold.category,
    calculatedAt: getCurrentTime(),
  };
}

module.exports = {
  flagSubmissionEvidenceSelect,
  buildQuestionOptions,
  buildSectionsNestedCreate,
  getAllQuestionsFromTemplate,
  getMissingRequiredQuestions,
  getInvalidQuestionIds,
  getOffendingAttachmentQuestions,
  validateAnswerValues,
  groupImagesByQuestion,
  buildAnswersWithImages,
  buildUpdateAnswersWithImages,
  getRemovedImageKeys,
  cleanupUploadedImages,
  cleanupRemovedImages,
  calculateSubmissionRisk,
};
