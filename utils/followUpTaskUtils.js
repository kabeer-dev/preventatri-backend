const {
  prepareChecklistAnswers,
  uploadEvidenceFiles,
  cleanupEvidenceFiles,
} = require('./checklistAnswerSubmissionUtils');

const {S3_DIRS} = require('../constants/file');
const {FollowUpTasksErrorsFactories} = require('../factories');

function getFollowUpTaskFileDir({taskId}) {
  return `${S3_DIRS.followUpTasks}/${taskId}`;
}

function groupReplyFiles({files}) {
  const replyFiles = [];

  for (const file of files) {
    const fieldname = file.fieldname || '';
    if (fieldname === 'replyFile' || fieldname.startsWith('reply_')) {
      replyFiles.push(file);
    }
  }

  return {replyFiles};
}

async function prepareSubmissionPayload({task, body, files, taskId}) {
  const fileDir = getFollowUpTaskFileDir({taskId});

  if (task.checklistTemplateId) {
    const {answers, cleanupOnError} = await prepareChecklistAnswers({
      checklistTemplateId: task.checklistTemplateId,
      body,
      files,
      fileDir,
      templateNotFoundErr: FollowUpTasksErrorsFactories.templateNotFoundErr,
    });

    return {type: 'answers', answers, cleanupOnError};
  }

  // Reply path — no template attached.
  const reply =
    typeof body.caseManagerReply === 'string'
      ? body.caseManagerReply.trim()
      : '';

  if (!reply) {
    throw FollowUpTasksErrorsFactories.caseManagerReplyRequiredErr();
  }

  const {replyFiles} = groupReplyFiles({
    files: Array.isArray(files) ? files : [],
  });

  const uploadedReplyFiles = await uploadEvidenceFiles({
    files: replyFiles,
    fileDir,
  });

  return {
    type: 'reply',
    caseManagerReply: reply,
    caseManagerReplyFiles: uploadedReplyFiles,
    cleanupOnError: () => cleanupEvidenceFiles({files: uploadedReplyFiles}),
  };
}

const uploadTaskEvidence = ({files, taskId}) =>
  uploadEvidenceFiles({files, fileDir: getFollowUpTaskFileDir({taskId})});

const cleanupTaskEvidence = ({files}) => cleanupEvidenceFiles({files});

module.exports = {
  uploadTaskEvidence,
  cleanupTaskEvidence,
  getFollowUpTaskFileDir,
  groupReplyFiles,
  prepareSubmissionPayload,
};
