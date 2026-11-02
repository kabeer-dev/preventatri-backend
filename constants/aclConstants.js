const {SYSTEM_ROLES} = require('./usersConstants');

const SYSTEM_ENTITIES = {
  organization: {value: 'organization', label: 'Organization'},
  users: {value: 'users', label: 'User'},
  region: {value: 'region', label: 'Region'},
  nurse: {value: 'nurse', label: 'Nurse'},
  caregiver: {value: 'caregiver', label: 'Caregiver'},
  patient: {value: 'patient', label: 'Patient'},
  caseManager: {value: 'caseManager', label: 'Case Manager'},
  checklistTemplate: {value: 'checklistTemplate', label: 'Checklist Template'},
  checklistSubmission: {
    value: 'checklistSubmission',
    label: 'Checklist Submission',
  },
  emergencyFlag: {value: 'emergencyFlag', label: 'Emergency Flag'},
  checklistAssignment: {
    value: 'checklistAssignment',
    label: 'Checklist Assignment',
  },
  escalation: {
    value: 'assigned-escalation',
    label: 'Assigned Escalation',
  },
  supervisoryVisit: {
    value: 'supervisoryVisit',
    label: 'Supervisory Visit',
  },
  followUpTask: {
    value: 'followUpTask',
    label: 'Follow-Up Task',
  },
  triageEngine: {
    value: 'triageEngine',
    label: 'Triage Engine',
  },
  notification: {
    value: 'notification',
    label: 'Notification',
  },
  auditLog: {
    value: 'auditLog',
    label: 'Audit Log',
  },
  report: {
    value: 'report',
    label: 'Report',
  },
  globalSearch: {
    value: 'globalSearch',
    label: 'Global Search',
  },
  hhaExchange: {
    value: 'hhaExchange',
    label: 'HHAeXchange Integration',
  },
  otpMethod: {
    value: 'otpMethod',
    label: 'OTP Method',
  },
  signoutADevice: {
    value: 'SignoutADevice',
    label: 'A Device (Signout)',
  },
  signoutAllOtherDevices: {
    value: 'SignoutAllOtherDevices',
    label: 'All Other Devices (Signout)',
  },
};

const extractValues = ({obj}) =>
  Object.fromEntries(Object.entries(obj).map(([key, obj]) => [key, obj.value]));

const {
  users,
  organization,
  region,
  nurse,
  caregiver,
  patient,
  caseManager,
  checklistTemplate,
  checklistSubmission,
  emergencyFlag,
  checklistAssignment,
  supervisoryVisit,
  followUpTask,
  triageEngine,
  notification,
  auditLog,
  report,
  globalSearch,
  hhaExchange,
} = extractValues({
  obj: SYSTEM_ENTITIES,
});

const {
  admin,
  nurse: nurseRole,
  caregiver: caregiverRole,
  case_manager: caseManagerRole,
} = extractValues({obj: SYSTEM_ROLES});

// Generic CRUD permission keys - reusable for all CRUD entities
const CRUD_PERMISSIONS = {
  CREATE: 'create',
  VIEW: 'view',
  UPDATE: 'update',
  DELETE: 'delete',
};

// Shared invite permission for user management entities
const INVITE_PERMISSIONS = {
  INVITE_USER: 'inviteUser',
};

// Submission-specific permissions
const SUBMISSION_PERMISSIONS = {
  SUBMIT: 'submit',
  VOID: 'void',
};

// Patient-specific permissions beyond generic CRUD
const PATIENT_PERMISSIONS = {
  VIEW_ASSESSMENTS: 'viewAssessments',
  VIEW_TIMELINE: 'viewTimeline',
};

// HHAeXchange integration permissions.
//
// ONE sync key, not one per resource. A run reconciles every resource in
// HHAX_SYNC_RESOURCES together -- there is no way to import only patients -- so
// a per-resource grant would describe a distinction the integration does not
// make. Renamed from syncPatients when caregivers joined the run; safe to
// rename because the grant is isCustom:false, so aclAccessMiddleware resolves
// it statically from this file and never reads a stored Permission row.
//
// VIEW_VISITS is the read side of the visit import: the HHA Visits page lists
// what the sync stored and nothing else. Separate from SYNC because reading an
// import and triggering one are different decisions, even while both are
// admin-only.
const HHA_EXCHANGE_PERMISSIONS = {
  SYNC: 'sync',
  VIEW_VISITS: 'viewVisits',
  VIEW_SYNC_HISTORY: 'viewSyncHistory',
  RESOLVE_SYNC_EXCEPTIONS: 'resolveSyncExceptions',
};

// Nurse-specific self-service permissions beyond generic CRUD.
// Unlike nurse.view (managing nurse records — admin side), these cover
// actions a nurse performs on their own data.
const NURSE_PERMISSIONS = {
  VIEW_DASHBOARD: 'viewDashboard',
  VIEW_ADMIN_STATS: 'viewAdminStats',
};

// Case-manager-specific self-service permissions beyond generic CRUD.
// Unlike caseManager.view (managing case manager records — admin side),
// these cover actions a case manager performs on their own data.
const CASE_MANAGER_PERMISSIONS = {
  VIEW_DASHBOARD: 'viewDashboard',
  VIEW_ADMIN_STATS: 'viewAdminStats',
};

// Triage-engine-specific permissions beyond generic CRUD.
// Unlike triageEngine.view (dashboard analytics for admins, nurses and case
// managers), the system-generated alerts list is admin-only.
const TRIAGE_ENGINE_PERMISSIONS = {
  VIEW_ALERTS: 'viewAlerts',
};

// Notification-specific permissions beyond generic CRUD. Every authorized role
// reads its own notifications; only admins may read the whole organization's.
const NOTIFICATION_PERMISSIONS = {
  VIEW_ALL: 'viewAll',
};

// Caregiver-specific permissions beyond generic CRUD
const CAREGIVER_PERMISSIONS = {
  VIEW_STATS: 'viewStats',
  VIEW_ADMIN_STATS: 'viewAdminStats',
};

const USER_PERMISSIONS = {
  VIEW_ADMIN_STATS: 'viewAdminStats',
};

// Follow-up-task-specific permission beyond generic CRUD: completing a task
// assigned to you is open to every care-team role, while UPDATE (edit, cancel)
// is not.
const FOLLOW_UP_TASK_PERMISSIONS = {
  COMPLETE: 'complete',
};

// Supervisory-visit-specific permissions: the assignee files (COMPLETE) the
// visit, a reviewer (admin / case manager) approves it or sends it back.
const SUPERVISORY_VISIT_PERMISSIONS = {
  COMPLETE: 'complete',
  REVIEW: 'review',
};

// Permission keys - ACL rules for each entity
const ACL_ACTIONS = {
  [users]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: true,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: true,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [INVITE_PERMISSIONS.INVITE_USER]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [USER_PERMISSIONS.VIEW_ADMIN_STATS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },
  [organization]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  [region]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  [nurse]: {
    [NURSE_PERMISSIONS.VIEW_DASHBOARD]: {
      allowedRoles: [nurseRole],
      isCustom: false,
    },
    [NURSE_PERMISSIONS.VIEW_ADMIN_STATS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: true,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: true,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Caregiver: Admin and Case Manager can manage; Caregivers can only view own assigned patients
  [caregiver]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CAREGIVER_PERMISSIONS.VIEW_STATS]: {
      allowedRoles: [caregiverRole],
      isCustom: false,
    },
    [CAREGIVER_PERMISSIONS.VIEW_ADMIN_STATS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Patient: Admin and Case Manager can manage; Nurses view region patients; Caregivers view assigned only
  [patient]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, caregiverRole, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [PATIENT_PERMISSIONS.VIEW_ASSESSMENTS]: {
      allowedRoles: [admin, caregiverRole],
      isCustom: false,
    },

    // The timeline spans flags, follow-ups and visits caregivers cannot see.
    [PATIENT_PERMISSIONS.VIEW_TIMELINE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // HHAeXchange: admin only. A sync rewrites demographics for every
  // HHA-sourced patient AND caregiver in the organization.
  [hhaExchange]: {
    [HHA_EXCHANGE_PERMISSIONS.SYNC]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [HHA_EXCHANGE_PERMISSIONS.VIEW_VISITS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Case Manager: Only admin can manage case managers
  [caseManager]: {
    [CASE_MANAGER_PERMISSIONS.VIEW_DASHBOARD]: {
      allowedRoles: [caseManagerRole],
      isCustom: false,
    },
    [CASE_MANAGER_PERMISSIONS.VIEW_ADMIN_STATS]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Checklist Submission: Caregivers submit; Admin voids; Admin, Case Managers, Nurses can view
  [checklistSubmission]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, caregiverRole, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [SUBMISSION_PERMISSIONS.SUBMIT]: {
      allowedRoles: [caregiverRole],
      isCustom: false,
    },
    [SUBMISSION_PERMISSIONS.VOID]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Emergency Flag: Caregivers create; Admin voids; Admins, Caregivers, Nurses, and Case Managers can view
  [emergencyFlag]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [caregiverRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, caregiverRole, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [SUBMISSION_PERMISSIONS.VOID]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Checklist Assignment: Admin and Case Manager assign checklists to caregivers
  [checklistAssignment]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, caregiverRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Checklist Template: Admin only for writes. Drafts can be edited and deleted;
  // published templates only change status.
  [checklistTemplate]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, caregiverRole, caseManagerRole, nurseRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.DELETE]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Supervisory Visit: any nurse / admin / case manager can be assigned one;
  // caregivers only see visits they are listed on. Row-level rules (assignee,
  // creator, caseload, reviewer-not-filer) live in supervisoryVisitAccessUtils.
  [supervisoryVisit]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, nurseRole, caseManagerRole, caregiverRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [SUPERVISORY_VISIT_PERMISSIONS.COMPLETE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [SUPERVISORY_VISIT_PERMISSIONS.REVIEW]: {
      allowedRoles: [admin, caseManagerRole],
      isCustom: false,
    },
  },

  // Follow-Up Task: any care-team role can be assigned one, so every role can
  // view and complete; only admins, nurses and case managers edit or cancel.
  // Row-level rules (assignee, creator, caseload, admin-owned) live in
  // followUpTaskAccessUtils. Caregivers cannot create tasks.
  [followUpTask]: {
    [CRUD_PERMISSIONS.CREATE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, nurseRole, caseManagerRole, caregiverRole],
      isCustom: false,
    },
    [CRUD_PERMISSIONS.UPDATE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
      isCustom: false,
    },
    [FOLLOW_UP_TASK_PERMISSIONS.COMPLETE]: {
      allowedRoles: [admin, nurseRole, caseManagerRole, caregiverRole],
      isCustom: false,
    },
    [SUBMISSION_PERMISSIONS.SUBMIT]: {
      allowedRoles: [admin, nurseRole, caseManagerRole, caregiverRole],
      isCustom: false,
    },
  },

  // Triage Engine: dashboard analytics readable by admins, nurses and case
  // managers; the controller scopes every query to the caller's own org.
  [triageEngine]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, nurseRole, caseManagerRole],
    },
    [TRIAGE_ENGINE_PERMISSIONS.VIEW_ALERTS]: {
      allowedRoles: [admin],
    },
  },

  // Notification: Admins, Nurses, Case Managers, and Caregivers can view their
  // own notifications (the list is self-scoped to the authenticated recipient)
  [notification]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin, nurseRole, caseManagerRole, caregiverRole],
      isCustom: false,
    },
    [NOTIFICATION_PERMISSIONS.VIEW_ALL]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Audit Log: sensitive HIPAA audit trail — admins only. The controller scopes
  // every query to the caller's own organization.
  [auditLog]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Reports: organization-wide analytics, admins only.
  [report]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },

  // Global Search: the dashboard search spans every patient and staff member in the org.
  [globalSearch]: {
    [CRUD_PERMISSIONS.VIEW]: {
      allowedRoles: [admin],
      isCustom: false,
    },
  },
};

const CRUD_ACTIONS = {
  create: 'CREATE',
  view: 'VIEW',
  update: 'UPDATE',
  delete: 'DELETE',
};

const ACCESS_LEVELS = {
  all: 'ALL',
  none: 'NONE',
};

module.exports = {
  ACL_ACTIONS,
  SYSTEM_ENTITIES,
  ACCESS_LEVELS,
  CRUD_ACTIONS,
  CRUD_PERMISSIONS,
  INVITE_PERMISSIONS,
  SUBMISSION_PERMISSIONS,
  PATIENT_PERMISSIONS,
  HHA_EXCHANGE_PERMISSIONS,
  NURSE_PERMISSIONS,
  CASE_MANAGER_PERMISSIONS,
  TRIAGE_ENGINE_PERMISSIONS,
  NOTIFICATION_PERMISSIONS,
  USER_PERMISSIONS,
  CAREGIVER_PERMISSIONS,
  FOLLOW_UP_TASK_PERMISSIONS,
  SUPERVISORY_VISIT_PERMISSIONS,
};
