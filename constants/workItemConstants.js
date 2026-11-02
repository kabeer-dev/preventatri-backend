const {TIME_ZONES} = require('./generalConstant');

// Shared by follow-up tasks and supervisory visits: both are patient work
// items with a care-team assignee, a history log and the same sweeps.

const WORK_ITEM_ACTOR_TYPES = {
  user: {value: 'USER'},
  system: {value: 'SYSTEM'},
};

// Why a person is on a patient's care team; drives the assignee picker copy.
const WORK_ITEM_CARE_TEAM_ROLES = {
  patientPrimaryNurse: {value: 'PATIENT_PRIMARY_NURSE', label: 'Primary nurse'},
  patientSecondaryNurse: {
    value: 'PATIENT_SECONDARY_NURSE',
    label: 'Secondary nurse',
  },
  regionDefaultNurse: {value: 'REGION_DEFAULT_NURSE', label: 'Region nurse'},
  caseManager: {value: 'CASE_MANAGER', label: 'Case manager'},
  caregiver: {value: 'CAREGIVER', label: 'Caregiver'},
  admin: {value: 'ADMIN', label: 'Org administrator'},
};

// Every work item reminds its assignee this long before it is due (24h and 2h).
const WORK_ITEM_REMINDER_OFFSETS_MINUTES = [1440, 120];

const WORK_ITEM_DEFAULT_TIME_ZONE = TIME_ZONES.eastern.value;

// Overdue sweeps run just past midnight Eastern (the org's working day); the
// reminder sweeps every five minutes, so a 2h reminder lands within 5 minutes.
const WORK_ITEM_CRON = {
  overduePattern: '5 0 * * *',
  overdueTimeZone: TIME_ZONES.eastern.value,
  reminderPattern: '*/5 * * * *',
  reminderTimeZone: 'UTC',
};

const WORK_ITEM_TEXT_MAX_LENGTH = 5000;
const WORK_ITEM_CANCEL_REASON_MAX_LENGTH = 2000;
const WORK_ITEM_EVENTS_LIMIT = 200;
const WORK_ITEM_EVIDENCE_FIELD_NAME = 'files';

// Checklist photos arrive as <prefix>_<questionId>; `images` is what the shared
// checklist form sends, `files` what older clients sent.
const WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES = ['files', 'images'];

module.exports = {
  WORK_ITEM_ACTOR_TYPES,
  WORK_ITEM_CARE_TEAM_ROLES,
  WORK_ITEM_REMINDER_OFFSETS_MINUTES,
  WORK_ITEM_DEFAULT_TIME_ZONE,
  WORK_ITEM_CRON,
  WORK_ITEM_TEXT_MAX_LENGTH,
  WORK_ITEM_CANCEL_REASON_MAX_LENGTH,
  WORK_ITEM_EVENTS_LIMIT,
  WORK_ITEM_EVIDENCE_FIELD_NAME,
  WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES,
};
