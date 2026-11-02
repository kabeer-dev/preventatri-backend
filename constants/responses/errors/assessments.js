module.exports.CHECKLIST_TEMPLATE_ERRORS_TYPES = {
  templateNotFound: {value: 'CHECKLIST_TEMPLATE_NOT_FOUND'},
  templateInactive: {value: 'CHECKLIST_TEMPLATE_INACTIVE'},
  invalidFields: {value: 'INVALID_CHECKLIST_FIELDS'},
  templateTitleAlreadyExists: {
    value: 'CHECKLIST_TEMPLATE_TITLE_ALREADY_EXISTS',
  },
  templateStatusTransitionNotAllowed: {
    value: 'CHECKLIST_TEMPLATE_STATUS_TRANSITION_NOT_ALLOWED',
  },
  templateIncomplete: {value: 'CHECKLIST_TEMPLATE_INCOMPLETE'},
  templateNotEditable: {value: 'CHECKLIST_TEMPLATE_NOT_EDITABLE'},
};

module.exports.CHECKLIST_SUBMISSION_ERRORS_TYPES = {
  submissionNotFound: {value: 'CHECKLIST_SUBMISSION_NOT_FOUND'},
  patientNotAssigned: {value: 'PATIENT_NOT_ASSIGNED_TO_CAREGIVER'},
  caregiverProfileNotFound: {value: 'CAREGIVER_PROFILE_NOT_FOUND'},
  requiredQuestionsUnanswered: {value: 'REQUIRED_QUESTIONS_UNANSWERED'},
  invalidAnswerValues: {value: 'INVALID_ANSWER_VALUES'},
  answerNotFound: {value: 'SUBMISSION_ANSWER_NOT_FOUND'},
  tooManyAttachmentsPerQuestion: {value: 'TOO_MANY_ATTACHMENTS_PER_QUESTION'},
  escalationNotFound: {value: 'ESCALATION_NOT_FOUND'},
  escalationAlreadyResolved: {value: 'ESCALATION_ALREADY_RESOLVED'},
  escalationExpired: {value: 'ESCALATION_EXPIRED'},
  escalationNotAcceptable: {value: 'ESCALATION_NOT_ACCEPTABLE'},
};
