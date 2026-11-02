module.exports.SUPERVISORY_VISIT_ERRORS_TYPES = {
  supervisoryVisitNotFound: {value: 'SUPERVISORY_VISIT_NOT_FOUND'},
  duplicateVisit: {value: 'SUPERVISORY_VISIT_DUPLICATE'},
  patientNotAssigned: {value: 'PATIENT_NOT_ASSIGNED_TO_CASE_MANAGER'},
  templateNotFound: {value: 'SUPERVISORY_VISIT_TEMPLATE_NOT_FOUND'},
  assigneeNotInCareTeam: {
    value: 'SUPERVISORY_VISIT_ASSIGNEE_NOT_IN_CARE_TEAM',
  },
  caregiverNotInCareTeam: {
    value: 'SUPERVISORY_VISIT_CAREGIVER_NOT_IN_CARE_TEAM',
  },
  invalidStatusTransition: {
    value: 'SUPERVISORY_VISIT_INVALID_STATUS_TRANSITION',
  },
  forbiddenVisitAction: {value: 'SUPERVISORY_VISIT_FORBIDDEN'},
  cannotReviewOwnFiling: {value: 'SUPERVISORY_VISIT_CANNOT_REVIEW_OWN_FILING'},
  invalidSchedule: {value: 'SUPERVISORY_VISIT_INVALID_SCHEDULE'},
  tooManyEvidenceFiles: {value: 'SUPERVISORY_VISIT_TOO_MANY_EVIDENCE_FILES'},
  tooManyQueuedFollowUps: {
    value: 'SUPERVISORY_VISIT_TOO_MANY_QUEUED_FOLLOW_UPS',
  },
};
