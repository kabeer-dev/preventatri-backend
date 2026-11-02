module.exports.FOLLOW_UP_TASK_ERRORS_TYPES = {
  followUpTaskNotFound: {value: 'FOLLOW_UP_TASK_NOT_FOUND'},
  duplicateFollowUpTask: {value: 'FOLLOW_UP_TASK_DUPLICATE'},
  followUpTaskAlreadyCompleted: {value: 'FOLLOW_UP_TASK_ALREADY_COMPLETED'},
  templateOrInstructionsRequired: {
    value: 'FOLLOW_UP_TASK_TEMPLATE_OR_INSTRUCTIONS_REQUIRED',
  },
  templateNotFound: {value: 'FOLLOW_UP_TASK_TEMPLATE_NOT_FOUND'},
  caseManagerReplyRequired: {
    value: 'FOLLOW_UP_TASK_CASE_MANAGER_REPLY_REQUIRED',
  },
  unexpectedAnswersWithoutTemplate: {
    value: 'FOLLOW_UP_TASK_UNEXPECTED_ANSWERS_WITHOUT_TEMPLATE',
  },
  assigneeNotInCareTeam: {value: 'FOLLOW_UP_TASK_ASSIGNEE_NOT_IN_CARE_TEAM'},
  assigneeRequired: {value: 'FOLLOW_UP_TASK_ASSIGNEE_REQUIRED'},
  invalidStatusTransition: {
    value: 'FOLLOW_UP_TASK_INVALID_STATUS_TRANSITION',
  },
  forbiddenTaskAction: {value: 'FOLLOW_UP_TASK_FORBIDDEN'},
  tooManyEvidenceFiles: {value: 'FOLLOW_UP_TASK_TOO_MANY_EVIDENCE_FILES'},
};
