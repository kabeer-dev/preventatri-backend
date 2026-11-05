/**
 * Database Model Names
 * Centralized constants for all Prisma model names used throughout the application
 * This prevents hardcoded strings and ensures consistency across all files
 */

module.exports = {
  MODELS: {
    USER: 'User',
    ORGANIZATION: 'Organization',
    USER_ORGANIZATION: 'UserOrganization',
    PERMISSION: 'Permission',
    IDEMPOTENCY: 'Idempotency',
    NURSE_PROFILE: 'NurseProfile',
    REGION: 'Region',
    NURSE_REGION: 'NurseRegion',
    REGION_DEFAULT_NURSE: 'RegionDefaultNurse',
    COUNTY: 'County',
    CAREGIVER_PROFILE: 'CaregiverProfile',
    CAREGIVER_PATIENT: 'CaregiverPatient',
    PATIENT: 'Patient',
    CASE_MANAGER_PROFILE: 'CaseManagerProfile',
    CASE_MANAGER_REGION: 'CaseManagerRegion',
    CASE_MANAGER_PATIENT: 'CaseManagerPatient',
    PATIENT_HHA_COORDINATOR: 'PatientHhaCoordinator',
    HHA_PENDING_IMPORT: 'HhaPendingImport',
    CHECKLIST_TEMPLATE: 'ChecklistTemplate',
    CHECKLIST_TEMPLATE_SECTION: 'ChecklistTemplateSection',
    CHECKLIST_TEMPLATE_QUESTION: 'ChecklistTemplateQuestion',
    CHECKLIST_SUBMISSION: 'ChecklistSubmission',
    CHECKLIST_SUBMISSION_ANSWER: 'ChecklistSubmissionAnswer',
    CHECKLIST_SUBMISSION_RISK: 'ChecklistSubmissionRisk',
    RED_FLAG: 'SubmissionFlag',
    SUBMISSION_FLAG: 'SubmissionFlag',
    SUBMISSION_FLAG_ESCALATION: 'SubmissionFlagEscalation',
    SUBMISSION_FLAG_ESCALATION_EVENT: 'SubmissionFlagEscalationEvent',
    SUBMISSION_FLAG_ESCALATION_RESPONSE: 'SubmissionFlagEscalationResponse',
    ESCALATION_POLICY: 'EscalationPolicy',
    CHECKLIST_ASSIGNMENT: 'ChecklistAssignment',
    SUPERVISORY_VISIT: 'SupervisoryVisit',
    SUPERVISORY_VISIT_CAREGIVER: 'SupervisoryVisitCaregiver',
    SUPERVISORY_VISIT_EVENT: 'SupervisoryVisitEvent',
    FOLLOW_UP_TASK: 'FollowUpTask',
    FOLLOW_UP_TASK_EVENT: 'FollowUpTaskEvent',
    NOTIFICATION: 'Notification',
    AUDIT_LOG: 'AuditLog',
    HHA_VISIT: 'HhaVisit',
    HHA_CREDENTIAL: 'OrganizationHhaCredential',
    HHA_SYNC_RUN: 'HhaSyncRun',
    HHA_SYNC_EXCEPTION: 'HhaSyncException',
    HHA_SYNC_CHANGE: 'HhaSyncChange',
    USER_SESSION: 'UserSession',
    SECURITY: 'Security',
  },

  /**
   * Maps SYSTEM_ENTITIES keys to their corresponding Prisma model names (lowercase)
   * Only add entries where the mapping is not a direct lowercase match
   */
  ENTITY_TO_MODEL_MAP: {
    nurse: 'nurseprofile', // SYSTEM_ENTITIES.nurse → MODELS.NURSE_PROFILE
    caregiver: 'caregiverprofile', // SYSTEM_ENTITIES.caregiver → MODELS.CAREGIVER_PROFILE
    patient: 'patient', // SYSTEM_ENTITIES.patient → MODELS.PATIENT
    caseManager: 'casemanagerprofile', // SYSTEM_ENTITIES.caseManager → MODELS.CASE_MANAGER_PROFILE
    // All other entities map directly (e.g., 'users' → 'user')
  },
};
