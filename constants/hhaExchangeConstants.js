/**
 * HHAeXchange integration constants.
 *
 * Every literal the SOAP client, mapper and sync engine touch lives here —
 * operation names, XML element names, the SOAPAction base, the value maps and
 * the job identifiers. Nothing in the integration hard-codes a string.
 *
 * The value maps and formats below are NOT guesses: they were confirmed against
 * the app2sandbox tenant on 2026-08-28. Where that matters the evidence is noted
 * inline, so a future reader knows what to re-probe if HHAeXchange changes.
 */

const {CAREGIVER_STATUSES} = require('./caregiversConstants');
const {ENTITY_STATUSES} = require('./generalConstant');
const {HHA_VISIT_TYPES} = require('./hhaVisitsConstants');
const {PROFESSIONAL_ROLES} = require('./nursesConstants');
const {PATIENT_STATUSES, GENDERS} = require('./patientsConstants');
const {PHONE_NUMBER_MAX_LENGTH} = require('./usersConstants');

// ── Transport ───────────────────────────────────────────────────────────────

const HHAX_XML_NAMESPACE = 'https://www.hhaexchange.com/apis/hhaws.integration';
const HHAX_SOAP_ENV_NAMESPACE = 'http://schemas.xmlsoap.org/soap/envelope/';
const HHAX_SOAP_ACTION_BASE = `${HHAX_XML_NAMESPACE}/`;
const HHAX_CONTENT_TYPE = 'text/xml; charset=utf-8';

/**
 * SOAP 1.1 is POST-only. Declared here rather than in a shared HTTP constants
 * file because this integration is the backend's only outbound HTTP client —
 * every other external call goes through a vendor SDK.
 */
const HHAX_REQUEST_METHOD = 'POST';
const HHAX_XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>';

const HHAX_OPERATIONS = {
  // V3, not V4: the current agency credentials answer V4 with ErrorID -9.
  GET_PATIENT_CHANGES: 'GetPatientChangesV3',
  GET_CAREGIVER_CHANGES: 'GetCaregiverChangesV3',
  GET_LANGUAGES: 'GetLanguages',
  GET_COORDINATORS: 'GetCoordinators',
  GET_NURSES: 'GetNurses',

  // One record per call: nurse detail for each roster id, and the coordinator
  // ids of a patient whose feed coordinator NAME is ambiguous.
  GET_CAREGIVER_DEMOGRAPHICS: 'GetCaregiverDemographics',
  GET_PATIENT_DEMOGRAPHICS: 'GetPatientDemographics',

  // Visit feed. GetVisitChangesV5 and GetDeletedVisitsV2 both take exactly
  // Authentication + ModifiedAfter + PageNumber in that xs:sequence order and
  // answer with the same Pagination shape, so both reuse fetchChangeFeedPage.
  GET_VISIT_CHANGES: 'GetVisitChangesV5',
  GET_DELETED_VISITS: 'GetDeletedVisitsV2',

  // V1, deliberately: GetMissedVisitReasons takes Authentication ONLY, so it is
  // one cheap master-list call per run -- the exact analogue of GetLanguages.
  // GetMissedVisitReasonsV2 requires a VisitInfo{VisitId} block and answers for
  // ONE visit, which would be a call per record.
  GET_MISSED_VISIT_REASONS: 'GetMissedVisitReasons',
};

/**
 * Envelope-level element names: the auth block the request carries and the
 * result/fault wrapper every response comes back in. Shared by every operation,
 * so these are the only element names soapEnvelope and soapClient ever touch.
 */
const HHAX_ENVELOPE_ELEMENTS = {
  AUTHENTICATION: 'Authentication',
  APP_NAME: 'AppName',
  APP_SECRET: 'AppSecret',
  APP_KEY: 'AppKey',
  SOAP_FAULT: 'Fault',
  FAULT_STRING: 'faultstring',

  // Status is an ATTRIBUTE on <Result>, not a child element.
  RESULT: 'Result',
  RESULT_STATUS_ATTRIBUTE: 'Status',
  ERROR_INFO: 'ErrorInfo',
  ERROR_ID: 'ErrorID',
  ERROR_MESSAGE: 'ErrorMessage',
};

/**
 * Request-only filter elements.
 *
 * There is deliberately no OfficeID here. GET_PATIENT_CHANGES returns the whole
 * agency when the element is OMITTED, which is what makes office discovery
 * unnecessary. GET_CAREGIVER_CHANGES takes the identical three elements in the
 * same xs:sequence order, so this group is shared by both feeds. Note that omitted is not the same as empty: buildElement renders
 * an empty value as <OfficeID />, and that self-closing tag makes HHAeXchange
 * answer HTTP 500 on every retry (confirmed 2026-08-31). Never send the element
 * with a null or blank value.
 */
const HHAX_REQUEST_ELEMENTS = {
  MODIFIED_AFTER: 'ModifiedAfter',
  PAGE_NUMBER: 'PageNumber',
};

/** Paging envelope on the patient change feed. */
const HHAX_PAGINATION_ELEMENTS = {
  PAGINATION: 'Pagination',
  CURRENT_PAGE: 'CurrentPage',
  TOTAL_RECORDS: 'TotalRecords',
  TOTAL_PAGES: 'TotalPages',
};

/** GetCaregiverChangesV3 sends the same paging envelope in lowercase. */
const HHAX_LOWERCASE_PAGINATION_ELEMENTS = {
  PAGINATION: 'pagination',
  CURRENT_PAGE: 'currentPage',
  TOTAL_RECORDS: 'totalRecords',
  TOTAL_PAGES: 'totalPages',
};

/**
 * Patient payload elements — the only group the mapper reads.
 *
 * Kept apart from the transport groups above deliberately: these are the names
 * that change when HHAeXchange versions the patient schema, and isolating them
 * means a future V5 feed is a change to this object alone.
 *
 * Only change-feed names live here; GetPatientDemographics has its own group.
 */
const HHAX_PATIENT_ELEMENTS = {
  CHANGES_RESULT: 'GetPatientChangesV3Result',
  CHANGES_INFO: 'GetPatientChangesV3Info',

  PATIENT_ID: 'PatientID',
  FIRST_NAME: 'FirstName',
  LAST_NAME: 'LastName',
  DATE_OF_BIRTH: 'DateOfBirth',
  BIRTH_DATE: 'BirthDate',
  GENDER: 'Gender',
  STATUS_ID: 'StatusID',
  PATIENT_STATUS_ID: 'PatientStatusID',
  PATIENT_STATUS_NAME: 'PatientStatusName',
  DISCHARGE_DATE: 'DischargeDate',
  MODIFIED_DATE: 'ModifiedDate',
  MEDICAID_NUMBER: 'MedicaidNumber',
  HOME_PHONE: 'HomePhone',
  PHONE_2: 'Phone2',
  ADDRESS_1: 'Address1',
  CITY: 'City',
  STATE: 'State',
  ZIP_5: 'Zip5',
  EMERGENCY_CONTACT_1: 'EmergencyContact1',
  PHONE_1: 'Phone1',

  // The patient's links. NurseID is the nurse's CaregiverID, -1 when unset.
  // Coordinators is a repeated element of coordinator NAMES, never ids.
  NURSE_ID: 'NurseID',
  COORDINATORS: 'Coordinators',
  COORDINATOR: 'Coordinator',
};

/** What the feed sends in place of a coordinator name when the slot is empty. */
const HHAX_PATIENT_NO_COORDINATOR_VALUE = '0';

/** How a patient's feed coordinator resolved against the synced case managers. */
const HHAX_COORDINATOR_MATCH_KINDS = {
  MATCHED: 'MATCHED',
  UNKNOWN: 'UNKNOWN',
  AMBIGUOUS: 'AMBIGUOUS',
};

/** Both demographics calls take one `<XInfo><ID>n</ID></XInfo>` block. */
const HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS = {
  ID: 'ID',
};

/**
 * GetCaregiverDemographics names that differ from the caregiver feed. Address,
 * phones, email, discipline and licence share the feed's names and nesting.
 */
const HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS = {
  CAREGIVER_INFO: 'CaregiverInfo',
  NPI_NUMBER: 'NPINumber',
  LAST_MODIFIED_DATE: 'LastModifiedDate',

  // Status is {ID, Name} here and plain text on the feed; the language id
  // sits beside its name instead of in Language1.
  STATUS_NAME: 'Name',
  LANGUAGE_ID_1: 'LanguageID1',
};

/** GetPatientDemographics coordinators carry ids; empty slots answer ID "0". */
const HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS = {
  PATIENT_INFO: 'PatientInfo',
  COORDINATORS: 'Coordinators',
  COORDINATOR: 'Coordinator',
  ID: 'ID',
};

/**
 * Caregiver payload elements -- the only group the caregiver mapper reads.
 *
 * Separate from HHAX_PATIENT_ELEMENTS even where the names coincide, because
 * these are the names that move when HHAeXchange versions the CAREGIVER schema.
 * A future V5 caregiver feed is then a change to this object alone.
 *
 * Two traps encoded here:
 *  - DATE_OF_BIRTH is 'DateofBirth' with a LOWERCASE 'o' on the caregiver feed,
 *    where the patient feed spells it 'DateOfBirth'. It is listed even though no
 *    caregiver column stores it, because HHAX_MASKED_FIELDS needs the exact
 *    spelling to keep it out of logs.
 *  - EMPLOYMENT_TYPES wraps a REPEATED <Discipline> element, so it must go
 *    through unwrapArray before anything indexes into it.
 */
const HHAX_CAREGIVER_ELEMENTS = {
  CHANGES_RESULT: 'GetCaregiverChangesV3Result',
  CHANGES_INFO: 'GetCaregiverChangesV3Info',

  CAREGIVER_ID: 'CaregiverID',
  FIRST_NAME: 'FirstName',
  LAST_NAME: 'LastName',
  DATE_OF_BIRTH: 'DateofBirth',
  STATUS: 'Status',
  TERMINATED_DATE: 'TerminatedDate',
  MODIFIED_DATE: 'ModifiedDate',
  HIRE_DATE: 'HireDate',

  EMPLOYMENT_TYPES: 'EmploymentTypes',
  DISCIPLINE: 'Discipline',

  ADDRESS: 'Address',
  STREET_1: 'Street1',
  CITY: 'City',
  STATE: 'State',
  ZIP_5: 'Zip5',
  HOME_PHONE: 'HomePhone',
  PHONE_2: 'Phone2',

  NOTIFICATION_PREFERENCES: 'NotificationPreferences',
  EMAIL: 'Email',

  LANGUAGE_1: 'Language1',

  // Read ONLY for records the nurse roster claims (see HHAX_NURSE_ELEMENTS):
  // a caregiver has no PreventaTri column for either, a nurse has both.
  PROFESSIONAL_LICENSE_NUMBER: 'ProfessionalLicensenumber',
  NPI_NUMBER: 'NPInumber',
};

/**
 * GetNurses response elements.
 *
 * The roster is thin (id, "Last First" name, offices, Active) and decides WHO
 * is a nurse. NurseID === CaregiverID, so GetCaregiverDemographics supplies the
 * address, email, phone, licence and NPI the roster lacks.
 */
const HHAX_NURSE_ELEMENTS = {
  RESULT: 'GetNursesResult',
  NURSES: 'Nurses',
  NURSE: 'Nurse',

  NURSE_ID: 'NurseID',
  NURSE_NAME: 'NurseName',
  ACTIVE: 'Active',
};

/**
 * GetNurses request elements. Unlike GetCoordinators there is NO SearchFilters
 * wrapper: OfficeID and Status are direct children of the operation element.
 * OfficeID is nillable and deliberately not sent (every office comes back).
 */
const HHAX_NURSE_REQUEST_ELEMENTS = {
  STATUS: 'Status',
};

/**
 * GetLanguages response elements.
 *
 * Language1 on the caregiver feed is a numeric LanguageID, not a name, so the
 * agency's language master list has to be read once per run to resolve it.
 * GetLanguages takes Authentication only -- no OfficeID, no pagination.
 */
const HHAX_LANGUAGE_ELEMENTS = {
  RESULT: 'GetLanguagesResult',
  LANGUAGES: 'Languages',
  LANGUAGE: 'Language',
  LANGUAGE_ID: 'LanguageID',
  LANGUAGE_NAME: 'LanguageName',
};

/**
 * Visit payload elements -- the only group the visit mapper reads.
 *
 * In HHAeXchange a SCHEDULE and a VISIT are the same record: GetScheduleInfo
 * takes a Visit ID, CreateSchedule answers with a VisitID, and one
 * GetVisitChangesV5Info row carries both the planned window (ScheduleStartTime
 * / ScheduleEndTime) and the actual and EVV clock times. So one feed feeds one
 * table, and "schedule" versus "visit" is two halves of the same row.
 *
 * Separate from the patient and caregiver groups even where names coincide,
 * because these are the names that move when HHAeXchange versions the VISIT
 * schema. A future V6 feed is then a change to this object alone.
 *
 * Traps encoded here (live-verified 2026-09-01):
 *  - CHANGES_INFO is the ELEMENT name inside the response, not the WSDL type
 *    name. The V5 response wraps rows in elements literally called
 *    GetVisitChangesV5Info.
 *  - PATIENT and CAREGIVER are nested blocks whose id child is plainly `ID`,
 *    not PatientID / CaregiverID as on the demographic feeds.
 *  - The billing, payroll, task and verification blocks (BilledAmount,
 *    PayHours, TaskPerformed, Verification, Timesheet, TTOT, OfficeID...) are
 *    deliberately absent: PreventaTri stores none of them, and naming them
 *    here would invite someone to start.
 */
const HHAX_VISIT_ELEMENTS = {
  CHANGES_RESULT: 'GetVisitChangesV5Result',
  CHANGES_INFO: 'GetVisitChangesV5Info',

  VISIT_ID: 'VisitID',
  LAST_MODIFIED_DATE: 'LastModifiedDate',
  VISIT_DATE: 'VisitDate',
  VISIT_TYPE: 'VisitType',

  PATIENT: 'Patient',
  CAREGIVER: 'Caregiver',
  ID: 'ID',
  ADMISSION_NUMBER: 'AdmissionNumber',
  FIRST_NAME: 'FirstName',
  LAST_NAME: 'LastName',

  SCHEDULE_START_TIME: 'ScheduleStartTime',
  SCHEDULE_END_TIME: 'ScheduleEndTime',
  SCHEDULE_DURATION: 'ScheduleDuration',
  SCHEDULE_DURATION_HOURS: 'ScheduleDurationHours',
  SCHEDULE_DURATION_MINUTES: 'ScheduleDurationMinutes',

  VISIT_START_TIME: 'VisitStartTime',
  VISIT_END_TIME: 'VisitEndTime',
  EVV_START_TIME: 'EVVStartTime',
  EVV_END_TIME: 'EVVEndTime',
  CLOCK_IN_EVV_TYPE: 'ClockInEvvType',
  CLOCK_OUT_EVV_TYPE: 'ClockOutEvvType',

  IS_MISSED_VISIT: 'IsMissedVisit',
  MISSED_VISIT_REASON_ID: 'MissedVisitReasonID',
  TIME_ZONE: 'TimeZone',
};

/**
 * GetDeletedVisitsV2 response elements.
 *
 * CHANGES_INFO is `GetDeletedVisitsInfo` -- the ELEMENT name. `GetDeletedVisits`
 * is the WSDL TYPE those elements carry, and using it would make findNode return
 * nothing and every deleted-visit page look empty, silently and forever.
 *
 * DeletedBy is deliberately absent: it names a person and nothing displays it.
 */
const HHAX_DELETED_VISIT_ELEMENTS = {
  CHANGES_RESULT: 'GetDeletedVisitsV2Result',
  CHANGES_INFO: 'GetDeletedVisitsInfo',

  VISIT_ID: 'VisitID',
  LAST_MODIFIED_DATE: 'LastModifiedDate',
  DELETED_DATE: 'DeletedDate',
  DELETED_REASON: 'DeletedReason',
};

/**
 * GetMissedVisitReasons response elements.
 *
 * MissedVisitReasonID on the visit feed is a numeric id, not text, so the
 * agency's reason master list has to be read once per run to resolve it -- the
 * same shape as GetLanguages for caregiver languages.
 */
const HHAX_MISSED_REASON_ELEMENTS = {
  RESULT: 'GetMissedVisitReasonsResult',
  REASONS: 'MissedVisitReasons',
  REASON_INFO: 'MissedVisitReasonsInfo',
  REASON_ID: 'ReasonID',
  REASON: 'Reason',
};

/**
 * GetCoordinators response elements -- the group the coordinator mapper reads.
 *
 * GetCoordinators is a FULL ROSTER read, not a change feed. Confirmed against
 * the sandbox on 2026-09-03 by listing every operation the service exposes:
 * there is no GetCoordinatorChanges of any version, the record carries no
 * ModifiedDate, and the response has no Pagination envelope. So the coordinator
 * runner makes exactly one call per sync run, gates writes on hhaSyncHash
 * alone, and stores no hhaModifiedDate.
 *
 * NAME is one string holding "First Last" -- there are no FirstName/LastName
 * elements, unlike every other feed.
 *
 * No Description entry: it is HHAeXchange's free-text label for the role, but
 * the case manager `title` is PreventaTri-owned and admin-edited, so the
 * mapper never reads it.
 *
 * No Offices/Office entry: the coordinator's office has no PreventaTri column
 * to land on and nothing reads or displays it, so the mapper never opens that
 * node.
 */
const HHAX_COORDINATOR_ELEMENTS = {
  RESULT: 'GetCoordinatorsResult',
  COORDINATORS: 'Coordinators',
  COORDINATOR: 'Coordinator',

  COORDINATOR_ID: 'CoordinatorID',
  NAME: 'Name',
  EMAIL: 'Email',
  ACTIVE: 'Active',
};

/**
 * GetCoordinators request elements.
 *
 * SearchFilters is MANDATORY: omitting the element answers ErrorID -12
 * "Invalid Filter Value" (confirmed 2026-09-03). A bare <SearchFilters /> is
 * accepted, but Status is sent explicitly so INACTIVE coordinators come back
 * too -- an inactive coordinator still owns history in PreventaTri and must be
 * imported too.
 *
 * OfficeID is nillable and deliberately not sent, matching the change feeds:
 * omitting it returns every office and each record carries its own Offices
 * block anyway.
 */
const HHAX_COORDINATOR_REQUEST_ELEMENTS = {
  SEARCH_FILTERS: 'SearchFilters',
  STATUS: 'Status',
};

/**
 * Status filter value that returns active AND inactive records. Shared by
 * GetCoordinators (inside SearchFilters) and GetNurses (a direct child).
 */
const HHAX_STATUS_FILTER_ALL = 'All';

/**
 * `Result Status` values. This attribute — not the HTTP status code — is the
 * success check: HHAeXchange answers an application failure with HTTP 400 AND
 * Status="Failure", so a non-2xx response must still be parsed rather than
 * treated as a transport error.
 */
const HHAX_RESULT_STATUSES = {
  SUCCESS: 'Success',
  FAILURE: 'Failure',
};

/** ErrorIDs worth recognising by value rather than by message text. */
const HHAX_ERROR_IDS = {
  NONE: '0',
  INVALID_APP_KEY: '-5',
  MODIFIED_AFTER_REQUIRED: '-315',
  INVALID_MODIFIED_AFTER: '-527',

  // The VISIT feed's own rejection of a badly shaped ModifiedAfter. A different
  // id from -527 because the visit endpoints validate the value with a
  // different parser -- which is exactly why they disagree about the Z. See
  // HHAX_VISIT_MODIFIED_AFTER_FORMAT.
  INVALID_VISIT_MODIFIED_AFTER: '-523',
};

// ── Request formats ─────────────────────────────────────────────────────────

/**
 * ModifiedAfter is REQUIRED (omitting it returns ErrorID -315). The V3 change
 * feeds reject a trailing Z (-523); V4 required it (-527), so switch back with V4.
 */
const HHAX_MODIFIED_AFTER_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * The VISIT feeds want the SAME instant WITHOUT the trailing Z.
 *
 * Live-verified 2026-09-01: sending the patient-feed format to
 * GetVisitChangesV5 answers ErrorID -523. The two endpoint families genuinely
 * disagree, so this is a second format constant rather than a shared one -- do
 * not "fix" the inconsistency by unifying them.
 *
 * The value is still a UTC instant; only its serialisation differs.
 */
const HHAX_VISIT_MODIFIED_AFTER_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

/** PageNumber is 1-based; "0" is rejected as "Page number must be greater than 0". */
const HHAX_FIRST_PAGE_NUMBER = 1;

/** Observed page size. Used to sanity-check pagination, never to slice. */
const HHAX_PAGE_SIZE = 100;

/**
 * HHAeXchange mixes two date shapes in ONE payload: ModifiedDate is ISO-with-Z,
 * while DischargeDate / ServiceStartDate are "YYYY-MM-DD HH:mm:ss". Parse each
 * with its own format — a single new Date() guess mis-parses one of them.
 */
const HHAX_DATE_FORMATS = {
  ISO_UTC: "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
  ISO_UTC_NO_MS: "yyyy-MM-dd'T'HH:mm:ss'Z'",
  SQL_DATETIME: 'yyyy-MM-dd HH:mm:ss',
  DATE_ONLY: 'yyyy-MM-dd',

  // Visit-feed shapes, all live-verified against the sandbox on 2026-09-01
  // rather than guessed:
  //  - SQL_DATETIME_NO_SECONDS is what ScheduleStartTime / ScheduleEndTime
  //    actually use ("2026-08-14 09:00"): a SPACE separator and no seconds.
  //  - SQL_DATETIME_MS is LastModifiedDate on the change feed and both
  //    VisitDate and DeletedDate on the deleted feed.
  //  - ISO_LOCAL has no zone suffix and is where the "0001-01-01T00:00:00"
  //    unset sentinel shows up; the year guard in toDate turns it into null.
  //  - US_DATETIME* have not been observed but cost nothing to try last, and
  //    HHAeXchange varies serialisation across its endpoint families.
  SQL_DATETIME_NO_SECONDS: 'yyyy-MM-dd HH:mm',
  SQL_DATETIME_MS: 'yyyy-MM-dd HH:mm:ss.SSS',
  ISO_LOCAL: "yyyy-MM-dd'T'HH:mm:ss",
  US_DATETIME: 'M/d/yyyy h:mm:ss a',
  US_DATETIME_NO_SECONDS: 'M/d/yyyy h:mm a',

  // A bare time-of-day only means something combined with the record's
  // VisitDate, which is what the visit mapper prefixes before parsing.
  TIME_ONLY: 'HH:mm',
  TIME_ONLY_WITH_SECONDS: 'HH:mm:ss',
  TIME_ONLY_12H: 'h:mm a',
  TIME_ONLY_12H_WITH_SECONDS: 'h:mm:ss a',
};

/**
 * Candidate formats for a visit clock value that carries its own date, tried in
 * order. Separate from the loose list toDate uses because a visit time is
 * parsed in the RECORD'S timezone rather than in UTC.
 *
 * SQL_DATETIME_NO_SECONDS is first because it is what the schedule times
 * actually are; the rest are fallbacks.
 */
const HHAX_VISIT_DATETIME_FORMATS = [
  HHAX_DATE_FORMATS.SQL_DATETIME_NO_SECONDS,
  HHAX_DATE_FORMATS.SQL_DATETIME,
  HHAX_DATE_FORMATS.SQL_DATETIME_MS,
  HHAX_DATE_FORMATS.ISO_UTC,
  HHAX_DATE_FORMATS.ISO_UTC_NO_MS,
  HHAX_DATE_FORMATS.ISO_LOCAL,
  HHAX_DATE_FORMATS.US_DATETIME,
  HHAX_DATE_FORMATS.US_DATETIME_NO_SECONDS,
];

/**
 * Candidate formats for a time-of-day with no date of its own. The mapper joins
 * the record's VisitDate to the value with a single space before trying these,
 * which is why each one is DATE_ONLY + ' ' + a clock shape.
 */
const HHAX_VISIT_TIME_ONLY_FORMATS = [
  `${HHAX_DATE_FORMATS.DATE_ONLY} ${HHAX_DATE_FORMATS.TIME_ONLY_WITH_SECONDS}`,
  `${HHAX_DATE_FORMATS.DATE_ONLY} ${HHAX_DATE_FORMATS.TIME_ONLY}`,
  `${HHAX_DATE_FORMATS.DATE_ONLY} ${HHAX_DATE_FORMATS.TIME_ONLY_12H_WITH_SECONDS}`,
  `${HHAX_DATE_FORMATS.DATE_ONLY} ${HHAX_DATE_FORMATS.TIME_ONLY_12H}`,
];

// ── Value maps ──────────────────────────────────────────────────────────────

/**
 * HHAeXchange StatusID -> PreventaTri PatientStatus.
 *
 * Confirmed by reading PatientStatusName back from GetPatientDemographics for a
 * sample of every id present in the sandbox roster:
 *   1 Waiting (2)   3 Active (222)   4 Hospitalized (5)
 *   5 Discharged (41)   8 Hold (1)
 *
 * Only members of the PatientStatus Postgres enum may appear on the
 * right-hand side.
 */
const HHAX_PATIENT_STATUS_MAP = {
  1: PATIENT_STATUSES.WAITING.value,
  3: PATIENT_STATUSES.ACTIVE.value,
  4: PATIENT_STATUSES.HOSPITALIZED.value,
  5: PATIENT_STATUSES.DISCHARGED.value,
  8: PATIENT_STATUSES.HOLD.value,
};

/** Fallback for a StatusID HHAeXchange adds later. Recorded as an exception. */
const HHAX_DEFAULT_PATIENT_STATUS = PATIENT_STATUSES.ACTIVE.value;

/**
 * HHAeXchange sends full words ("Female" / "Male"), not M/F. Keys are lowercased
 * before lookup. Anything unrecognised maps to null rather than being written
 * through: Patient.gender is free-text in Postgres but the Yup update schema
 * restricts it to GENDERS_VALUES, so a raw passthrough would make every later
 * admin PATCH fail validation on a field the admin cannot even edit.
 */
const HHAX_GENDER_MAP = {
  male: GENDERS.MALE.value,
  female: GENDERS.FEMALE.value,
  other: GENDERS.OTHER.value,
};

/**
 * HHAeXchange caregiver Status -> PreventaTri CaregiverStatus.
 *
 * NOTE the shape difference from patients: the caregiver change feed sends
 * Status as a NAME string ("On Leave"), not a numeric StatusID, so this map is
 * name-keyed and lookups lowercase first. The six keys are the six options the
 * CreateCaregiver form exposes; they are the reason CaregiverStatus grew from
 * two members to six, so every value here has a Postgres enum member.
 */
const HHAX_CAREGIVER_STATUS_MAP = {
  active: CAREGIVER_STATUSES.ACTIVE.value,
  inactive: CAREGIVER_STATUSES.INACTIVE.value,
  hold: CAREGIVER_STATUSES.HOLD.value,
  'on leave': CAREGIVER_STATUSES.ON_LEAVE.value,
  onleave: CAREGIVER_STATUSES.ON_LEAVE.value,
  terminated: CAREGIVER_STATUSES.TERMINATED.value,
  rejected: CAREGIVER_STATUSES.REJECTED.value,
};

/** Fallback for a Status HHAeXchange adds later. Recorded as an exception. */
const HHAX_DEFAULT_CAREGIVER_STATUS = CAREGIVER_STATUSES.ACTIVE.value;

/**
 * CaregiverProfile.role is NOT NULL, so a caregiver whose EmploymentTypes block
 * is empty still needs a value. Skipping the record instead would drop a real
 * caregiver over a field PreventaTri treats as free text anyway, so the record
 * imports with this and a MISSING_DISCIPLINE exception marks it for review.
 */
const HHAX_DEFAULT_CAREGIVER_ROLE = 'Unspecified';

/**
 * HHAeXchange coordinator Active -> PreventaTri CaseManagerStatus.
 *
 * Active is a "Yes"/"No" string, not a status name and not a numeric id, so
 * this map is two entries wide and lookups lowercase first.
 *
 * ENTITY_STATUSES rather than a case-manager-specific set: CaseManagerStatus
 * has exactly the two members ACTIVE and INACTIVE, which is precisely what
 * ENTITY_STATUSES already is and what the case manager Yup schemas already
 * validate against. Caregivers needed their own six-value set; case managers do
 * not.
 */
const HHAX_COORDINATOR_ACTIVE_MAP = {
  yes: ENTITY_STATUSES.ACTIVE.value,
  no: ENTITY_STATUSES.INACTIVE.value,
};

/** Fallback for an Active value HHAeXchange adds later. Recorded as an exception. */
const HHAX_DEFAULT_CASE_MANAGER_STATUS = ENTITY_STATUSES.ACTIVE.value;

/**
 * HHAeXchange nurse Active -> PreventaTri NurseStatus.
 *
 * The nurse ROSTER's "Yes"/"No" flag is the status source, not the caregiver
 * feed's six-valued Status on the same record: the roster is the table that
 * says this person is a nurse, and NurseStatus has exactly the two members
 * ENTITY_STATUSES already is.
 */
const HHAX_NURSE_ACTIVE_MAP = {
  yes: ENTITY_STATUSES.ACTIVE.value,
  no: ENTITY_STATUSES.INACTIVE.value,
};

/** Fallback for an Active value HHAeXchange adds later. Recorded as an exception. */
const HHAX_DEFAULT_NURSE_STATUS = ENTITY_STATUSES.ACTIVE.value;

/**
 * EmploymentTypes > Discipline -> NurseProfile.professionalRole, keyed
 * lowercase. Every sandbox nurse carries "RN"; LPN is the only other member of
 * the ProfessionalRole enum. Anything else falls back and records an
 * UNMAPPED_PROFESSIONAL_ROLE exception rather than skipping a real nurse.
 */
const HHAX_PROFESSIONAL_ROLE_MAP = {
  rn: PROFESSIONAL_ROLES.RN.value,
  lpn: PROFESSIONAL_ROLES.LPN.value,
};

/** Fallback for a Discipline outside the enum. Recorded as an exception. */
const HHAX_DEFAULT_PROFESSIONAL_ROLE = PROFESSIONAL_ROLES.RN.value;

/**
 * IsMissedVisit is typed s:string on the change feed, not s:boolean, so
 * HHAeXchange is free to send any of these spellings and has been seen to send
 * more than one across its endpoint families. Keys are lowercased before lookup.
 *
 * A value that is present but absent from this map is NOT treated as false --
 * the mapper records an UNMAPPED_MISSED_VISIT exception, because silently
 * reading an unknown value as "the visit happened" is the one wrong answer that
 * hides a care gap.
 */
const HHAX_MISSED_VISIT_MAP = {
  y: true,
  yes: true,
  true: true,
  1: true,
  n: false,
  no: false,
  false: false,
  0: false,
};

/**
 * HHAeXchange's TimeZone element, resolved to an IANA zone name.
 *
 * The real values are FULL WORDS -- live-verified 2026-09-01, the sandbox sends
 * `<TimeZone>Eastern</TimeZone>`. An abbreviation-only map would miss every
 * record and silently store every visit in the fallback zone, so the full words
 * are the primary keys here and the abbreviations are defensive extras against
 * a differently configured agency. Keys are lowercased before lookup.
 *
 * IANA names rather than offsets because Luxon (and Postgres) only understand
 * those, and because the zone database already knows which offset applies on a
 * given date. That is also why the standard and daylight spellings map to the
 * SAME zone: treating EST and EDT as different zones would double-shift a
 * summer visit.
 *
 * A value absent from this map falls back to the default zone the caller
 * supplies (config hhax.syncTimezone) and records an UNMAPPED_TIMEZONE
 * exception naming it -- which is how the real list gets discovered rather than
 * guessed at here.
 */
const HHAX_TIMEZONE_MAP = {
  eastern: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  et: 'America/New_York',

  central: 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  ct: 'America/Chicago',

  mountain: 'America/Denver',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mt: 'America/Denver',

  pacific: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pt: 'America/Los_Angeles',

  // Arizona does not observe DST, so it is its own zone rather than Mountain.
  arizona: 'America/Phoenix',

  alaska: 'America/Anchorage',
  akst: 'America/Anchorage',
  akdt: 'America/Anchorage',

  hawaii: 'Pacific/Honolulu',
  hst: 'Pacific/Honolulu',

  atlantic: 'America/Puerto_Rico',
  ast: 'America/Puerto_Rico',

  utc: 'UTC',
  gmt: 'UTC',
};

/**
 * VisitType -> HhaVisit.visitType, keyed lowercase.
 *
 * The change feed types VisitType as s:string and documents no domain for it;
 * these four are what HHAeXchange's own CreateSchedule form offers, and every
 * visit in the sandbox carries "Daily Fixed". Spacing is normalised away on
 * lookup so "DailyFixed" and "Daily  Fixed" land on the same member.
 *
 * A value absent from this map stores NULL and records an UNMAPPED_VISIT_TYPE
 * exception naming it, the same bargain as HHAX_TIMEZONE_MAP: the real list
 * gets discovered from live data instead of being guessed at here, and an
 * agency that uses a fifth spelling costs one blank cell rather than a
 * rejected write.
 */
const HHAX_VISIT_TYPE_MAP = {
  'daily fixed': HHA_VISIT_TYPES.DAILY_FIXED.value,
  dailyfixed: HHA_VISIT_TYPES.DAILY_FIXED.value,
  'daily variable': HHA_VISIT_TYPES.DAILY_VARIABLE.value,
  dailyvariable: HHA_VISIT_TYPES.DAILY_VARIABLE.value,
  'weekly variable': HHA_VISIT_TYPES.WEEKLY_VARIABLE.value,
  weeklyvariable: HHA_VISIT_TYPES.WEEKLY_VARIABLE.value,
  'no schedule': HHA_VISIT_TYPES.NO_SCHEDULE.value,
  noschedule: HHA_VISIT_TYPES.NO_SCHEDULE.value,
};

/**
 * HHAeXchange LanguageName -> PreventaTri language code, keyed lowercase.
 *
 * Seeded from the language options PreventaTri already offers. HHAeXchange's
 * language master list is agency-configurable and longer than this, so a miss
 * is expected rather than exceptional: it stores null and records an
 * UNMAPPED_LANGUAGE exception naming the language, which is how the real list
 * gets discovered without guessing at it here.
 */
const HHAX_LANGUAGE_NAME_MAP = {
  english: 'en',
  spanish: 'es',
  mandarin: 'zh',
  chinese: 'zh',
  cantonese: 'yue',
  vietnamese: 'vi',
  korean: 'ko',
  russian: 'ru',
  french: 'fr',
  'haitian creole': 'ht',
  creole: 'ht',
  arabic: 'ar',
  bengali: 'bn',
  hindi: 'hi',
  urdu: 'ur',
  polish: 'pl',
  italian: 'it',
  portuguese: 'pt',
  tagalog: 'tl',
  albanian: 'sq',
  hebrew: 'he',
  yiddish: 'yi',
  japanese: 'ja',
  greek: 'el',
  german: 'de',
  ukrainian: 'uk',
  romanian: 'ro',
  punjabi: 'pa',
  nepali: 'ne',
  somali: 'so',
  amharic: 'am',
  swahili: 'sw',
  turkish: 'tr',
  thai: 'th',
  farsi: 'fa',
  persian: 'fa',
  armenian: 'hy',
  georgian: 'ka',
  uzbek: 'uz',
  dutch: 'nl',
};

/**
 * Domain for the synthetic address given to a caregiver HHAeXchange has no
 * email for. `.invalid` is reserved by RFC 2606, so it can never resolve and a
 * message can never accidentally leave the building.
 *
 * Sync itself never sends mail -- the invitation is a separate call the
 * caregiver invite controller makes and sync does not -- so a placeholder is
 * inert until an admin replaces it, which updateCaregiver allows only while the
 * stored address still ends in this domain.
 */
const HHAX_PLACEHOLDER_EMAIL_DOMAIN = 'hhax.invalid';

/**
 * Local-part prefix per imported role, so a placeholder address says which feed
 * minted it. Keyed rather than a single constant because caregivers and
 * coordinators are numbered independently by HHAeXchange -- caregiver 4870049
 * and coordinator 4870049 are different people, and one shared prefix would
 * mint the same address for both and collide on the per-org unique index.
 */
const HHAX_PLACEHOLDER_EMAIL_PREFIXES = {
  CAREGIVER: 'hha-caregiver-',
  CASE_MANAGER: 'hha-coordinator-',
  NURSE: 'hha-nurse-',
};

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * Credentials and PHI that must never reach a log line, a Sentry event or an
 * X-Ray span. Passed to maskSensitiveFields(). The SOAP client sanitises BEFORE
 * constructing an Error, because utils/monitoring puts error.message straight
 * into span.setStatus and span.recordException with no redaction of its own.
 */
const HHAX_MASKED_FIELDS = [
  // Remote-controlled text. HHAeXchange composes ErrorMessage and faultstring
  // itself, so their contents are outside our control and may echo back part
  // of what was sent or found. errorId carries the actionable signal (see
  // HHAX_ERROR_IDS) and stays readable, so masking this costs no diagnosis.
  'errorMessage',

  'AppName',
  'AppSecret',
  'AppKey',
  'FirstName',
  'MiddleName',
  'LastName',
  'DateOfBirth',
  'BirthDate',
  'SSN',
  'MedicaidNumber',
  'MedicareNumber',
  'AdmissionID',
  'MRNumber',
  'HomePhone',
  'Phone1',
  'Phone2',
  'Phone3',
  'Address1',

  // Caregiver feed. These are masked even where PreventaTri stores nothing:
  // masking happens on the way to the log/Sentry/X-Ray sinks, so a field we
  // deliberately ignore still traverses those sinks inside an error context.
  //
  // 'DateofBirth' has a LOWERCASE 'o' on the caregiver feed and would NOT be
  // caught by the 'DateOfBirth' entry above. Both spellings are required.
  'DateofBirth',
  'Street1',
  'Street2',
  'Email',
  'Initials',
  'Ethnicity',
  'MaritalStatus',
  'CountryOfBirth',
  'TimeAndAttendancePIN',
  'ProfessionalLicensenumber',
  'NPInumber',

  // GetCaregiverDemographics spells these differently from the feed.
  'NPINumber',
  'Intials',
  'EmployeeID',
  'Registrynumber',
  'CaregiverCode',
  'AlternateCaregiverCode',
  'CaregiverMobileID',

  // 'Name' covers three different people-or-place fields across the feeds: the
  // emergency-contact person on patients and caregivers, and the coordinator's
  // own full name on GetCoordinators. One entry masks all of them.
  //
  // The rest of CoordinatorInfo needs no entry: CoordinatorID and the office
  // ID/Name are agency reference data rather than PHI, Description is a free
  // text job title, Active is a Yes/No flag, and 'Email' is already listed
  // above from the caregiver feed and matches by field name regardless of which
  // feed it arrived on.
  'Name',

  // GetNurses carries the nurse's full name in one element.
  'NurseName',

  // The patient feed names each coordinator as plain text.
  'Coordinator',

  // Visit feed. The patient's agency admission number identifies a real person
  // as surely as a Medicaid number does, so it never reaches a log sink.
  'AdmissionNumber',
];

// ── Sync run ────────────────────────────────────────────────────────────────

const HHAX_SYNC_TRIGGERS = {
  SCHEDULED: {value: 'SCHEDULED', label: 'Scheduled'},
  MANUAL: {value: 'MANUAL', label: 'Manual'},
};

const HHAX_SYNC_TRIGGERS_VALUES = Object.values(HHAX_SYNC_TRIGGERS).map(
  (trigger) => trigger.value
);

/**
 * Per-record outcomes surfaced in the run summary. These are the reasons a
 * patient did not import cleanly — silence here is the worst outcome, so every
 * one of them is counted and returned to the caller.
 */
const HHAX_SYNC_EXCEPTION_TYPES = {
  MISSING_PATIENT_ID: 'MISSING_PATIENT_ID',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  UNMAPPED_STATUS_ID: 'UNMAPPED_STATUS_ID',
  UNMAPPED_GENDER: 'UNMAPPED_GENDER',
  ARCHIVED_PATIENT_UPDATED: 'ARCHIVED_PATIENT_UPDATED',
  UPSERT_FAILED: 'UPSERT_FAILED',

  // County resolution. Kept apart because the fixes differ: a missing ZIP needs
  // correcting in HHAeXchange, an unrecognised one needs the ZIP reference data
  // refreshed, and a county absent from the org needs an admin to add it.
  MISSING_COUNTY_ZIP: 'MISSING_COUNTY_ZIP',
  UNRESOLVED_COUNTY_ZIP: 'UNRESOLVED_COUNTY_ZIP',
  COUNTY_NOT_IN_ORGANIZATION: 'COUNTY_NOT_IN_ORGANIZATION',

  // No longer raised (the ZIP data is national); kept for old history rows.
  OUT_OF_STATE_ZIP: 'OUT_OF_STATE_ZIP',

  // The state HHAeXchange sent is not the state the ZIP belongs to.
  ZIP_STATE_MISMATCH: 'ZIP_STATE_MISMATCH',

  // Patient links. Every "keep" outcome leaves the current PreventaTri link in
  // place; the feed-element types mean HHAeXchange stopped sending the element.
  PATIENT_NURSE_ELEMENT_MISSING: 'PATIENT_NURSE_ELEMENT_MISSING',
  PATIENT_COORDINATOR_ELEMENT_MISSING: 'PATIENT_COORDINATOR_ELEMENT_MISSING',
  UNKNOWN_HHA_NURSE: 'UNKNOWN_HHA_NURSE',
  NO_HHA_COORDINATOR: 'NO_HHA_COORDINATOR',
  UNKNOWN_COORDINATOR_NAME: 'UNKNOWN_COORDINATOR_NAME',
  AMBIGUOUS_COORDINATOR_NAME: 'AMBIGUOUS_COORDINATOR_NAME',

  // No longer raised (CASE_MANAGER_NOT_ACTIVE replaced it); kept for old rows.
  CASE_MANAGER_ARCHIVED: 'CASE_MANAGER_ARCHIVED',

  // The coordinator an admin chose is no longer on the patient in HHAeXchange.
  SELECTED_COORDINATOR_REMOVED: 'SELECTED_COORDINATOR_REMOVED',

  // HHAeXchange names a nurse but an admin already picked another one.
  PRIMARY_NURSE_CONFLICT: 'PRIMARY_NURSE_CONFLICT',

  // HHAeXchange's case manager is active now, but someone an admin chose (or
  // the next coordinator the sync used meanwhile) is on the patient.
  CASE_MANAGER_CONFLICT: 'CASE_MANAGER_CONFLICT',

  // One row per PERSON, not per patient: HHAeXchange names them on patients,
  // but nobody is linked until they accept an invitation or are active again.
  NURSE_INVITATION_PENDING: 'NURSE_INVITATION_PENDING',
  CASE_MANAGER_INVITATION_PENDING: 'CASE_MANAGER_INVITATION_PENDING',
  NURSE_NOT_ACTIVE: 'NURSE_NOT_ACTIVE',
  CASE_MANAGER_NOT_ACTIVE: 'CASE_MANAGER_NOT_ACTIVE',
  SECONDARY_NURSE_MATCHES_PRIMARY: 'SECONDARY_NURSE_MATCHES_PRIMARY',
  SECONDARY_NURSE_REGION_MISMATCH: 'SECONDARY_NURSE_REGION_MISMATCH',
  LINK_LOOKUP_FAILED: 'LINK_LOOKUP_FAILED',

  // Caregiver-side outcomes.
  MISSING_CAREGIVER_ID: 'MISSING_CAREGIVER_ID',
  MISSING_DISCIPLINE: 'MISSING_DISCIPLINE',
  UNMAPPED_CAREGIVER_STATUS: 'UNMAPPED_CAREGIVER_STATUS',
  UNMAPPED_LANGUAGE: 'UNMAPPED_LANGUAGE',
  ARCHIVED_CAREGIVER_UPDATED: 'ARCHIVED_CAREGIVER_UPDATED',

  // Coordinator-side outcomes. HHAeXchange's "Coordinator" is PreventaTri's
  // "Case Manager", so the type names follow whichever side the problem is on:
  // a malformed HHAeXchange record is a COORDINATOR problem, a PreventaTri row
  // that could not be written is a CASE_MANAGER one.
  MISSING_COORDINATOR_ID: 'MISSING_COORDINATOR_ID',
  UNMAPPED_COORDINATOR_STATUS: 'UNMAPPED_COORDINATOR_STATUS',
  ARCHIVED_CASE_MANAGER_UPDATED: 'ARCHIVED_CASE_MANAGER_UPDATED',

  // Nurse-side outcomes. A nurse is a caregiver-feed record the nurse roster
  // claims, so most of its problems are caregiver-shaped and reuse the types
  // above (MISSING_CAREGIVER_ID, MISSING_REQUIRED_FIELD, DUPLICATE_EMAIL).
  UNMAPPED_PROFESSIONAL_ROLE: 'UNMAPPED_PROFESSIONAL_ROLE',
  UNMAPPED_NURSE_STATUS: 'UNMAPPED_NURSE_STATUS',
  INVALID_NPI: 'INVALID_NPI',
  ARCHIVED_NURSE_UPDATED: 'ARCHIVED_NURSE_UPDATED',

  // GetCaregiverDemographics failed for a roster nurse. The roster alone has no
  // email, address or split name, so the record is reported, not created.
  NURSE_DEMOGRAPHICS_UNAVAILABLE: 'NURSE_DEMOGRAPHICS_UNAVAILABLE',

  // The caregiver runner cannot tell a nurse from a caregiver without the
  // roster, so when GetNurses fails the caregiver resource fails too rather
  // than re-importing every nurse as a caregiver.
  NURSE_ROSTER_UNAVAILABLE: 'NURSE_ROSTER_UNAVAILABLE',

  // Informational: an earlier run (before the nurse roster was consulted)
  // imported this nurse as a caregiver; this run converted the account.
  CAREGIVER_RECLASSIFIED_AS_NURSE: 'CAREGIVER_RECLASSIFIED_AS_NURSE',

  // The HHAeXchange email belongs to someone else here. The person is not
  // imported until an admin gives them a unique address.
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',

  // An existing person's HHA email changed but could not be applied: another
  // user here already has it (the old login is kept), or it is not valid.
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  INVALID_EMAIL: 'INVALID_EMAIL',

  // HHAeXchange's email changed for a person whose login email an admin typed.
  // The login is kept; detail holds "old -> new" so the admin can decide.
  HHA_EMAIL_CHANGED: 'HHA_EMAIL_CHANGED',

  // Visit-side outcomes. A visit is never resolved against a PreventaTri
  // patient or caregiver -- the row stores the HHAeXchange ids and a name
  // snapshot and nothing else -- so there is no UNRESOLVED_* type here.
  MISSING_VISIT_ID: 'MISSING_VISIT_ID',
  UNMAPPED_MISSED_REASON: 'UNMAPPED_MISSED_REASON',
  UNMAPPED_MISSED_VISIT: 'UNMAPPED_MISSED_VISIT',
  UNMAPPED_TIMEZONE: 'UNMAPPED_TIMEZONE',
  UNMAPPED_VISIT_TYPE: 'UNMAPPED_VISIT_TYPE',

  // The visit feed answers with about one month of changes per call, so the
  // sync walks it forward a window at a time (see walkFeedByCursor). This says
  // hhax.maxCursorWindows was reached before the walk caught up with the
  // present, which means the run is INCOMPLETE -- newer visits exist that were
  // not imported. Normally the lookback is far enough back to need more hops
  // than the guard allows.
  CURSOR_WINDOW_GUARD: 'CURSOR_WINDOW_GUARD',
};

// Informational: the record still imported or linked. Every other type is
// blocking, so a new type can never quietly leave a run "Succeeded".
const HHA_SYNC_WARNING_EXCEPTION_TYPES = [
  HHAX_SYNC_EXCEPTION_TYPES.NURSE_INVITATION_PENDING,
  HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_INVITATION_PENDING,
  HHAX_SYNC_EXCEPTION_TYPES.NURSE_NOT_ACTIVE,
  HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_NOT_ACTIVE,
  HHAX_SYNC_EXCEPTION_TYPES.CAREGIVER_RECLASSIFIED_AS_NURSE,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_PATIENT_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CAREGIVER_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_NURSE_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CASE_MANAGER_UPDATED,
];

/**
 * Fields owned by HHAeXchange on an HHA-sourced patient. Every sync overwrites
 * them, so an edit made here would silently disappear at the next run — the
 * update controller rejects them instead, and the UI greys them out.
 *
 * countyId is not here: it is derived from the ZIP and locked only while that
 * resolves (HHA_DERIVED_PATIENT_FIELDS), so an admin can fix an unresolved one.
 */
const HHA_MANAGED_PATIENT_FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'gender',
  'status',
  'address',
  'city',
  'state',
  'zipCode',
  'phoneNo',
  'emergencyContact',
  'medicaidId',
];

/**
 * Locked only while HHAeXchange names the primary nurse
 * (isPrimaryNurseHhaManaged) and that nurse is active; otherwise an admin picks.
 */
const HHA_MANAGED_PATIENT_LINK_FIELDS = ['primaryNurseProfileId'];

/**
 * Locked unless the patient waits for HHAeXchange's case manager, or an admin
 * already picked one. The case manager's own roster is guarded separately.
 */
const HHA_MANAGED_PATIENT_CASE_MANAGER_FIELDS = ['caseManagerProfileId'];

/** Locked only while the patient's ZIP resolves (isCountyHhaManaged). */
const HHA_DERIVED_PATIENT_FIELDS = ['countyId'];

/** Locked only while the nurse's ZIP resolves (isPrimaryRegionHhaManaged). */
const HHA_DERIVED_NURSE_FIELDS = ['primaryRegionIds'];

/**
 * Fields owned by HHAeXchange on an HHA-sourced caregiver. Every sync overwrites
 * them, so an edit made here would silently disappear at the next run -- the
 * update controllers reject them instead, and the UI greys them out.
 *
 * Spans two tables, because CaregiverProfile is a User satellite: firstName,
 * lastName, phoneNo, address, city, state and zipCode live on `users`, the rest
 * on `caregiver_profiles`. Both the admin edit path (updateCaregiver) and the
 * caregiver's own self-service path (updateProfile) check against this list --
 * without the second one, a synced caregiver could change their own address and
 * watch it revert overnight.
 *
 * `email` is deliberately ABSENT. Sync writes it once at create and never
 * again: it is the login identity and it sits under a unique index, so
 * overwriting it on a later run could lock a caregiver out or collide with
 * another account. It stays admin-editable while it is still a placeholder.
 */
const HHA_MANAGED_CAREGIVER_FIELDS = [
  'firstName',
  'lastName',
  'phoneNo',
  'address',
  'city',
  'state',
  'zipCode',
  'role',
  'status',
  'language',
  'startDate',
  'terminationDate',
];

/**
 * Fields owned by HHAeXchange on an HHA-sourced case manager.
 *
 * Much shorter than the caregiver list, because GetCoordinators publishes far
 * less: a name, an email, a description and an active flag -- and of those
 * only the name and the active flag are synced. title, phoneNo, regions,
 * preferredContactMethod, language, startDate and notes stay PreventaTri-owned.
 *
 * Patient assignments are split by the PATIENT's source: links to HHA patients
 * come from the patient feed and are read-only, links to manual patients stay
 * admin-editable. Regions never affect either.
 *
 * `title` is NOT managed even though HHAeXchange publishes a Description: the
 * sync never writes it, so an admin's title survives every run.
 *
 * `email` is deliberately ABSENT for the same reason as on caregivers: sync
 * writes it once at create and never again, and it stays admin-editable only
 * while it is still a placeholder.
 *
 * Spans two tables, because CaseManagerProfile is a User satellite: firstName
 * and lastName live on `users`, status on `case_manager_profiles`. Both the
 * admin edit path (updateCaseManager) and the case manager's own self-service
 * path (updateProfile) check against this list.
 */
const HHA_MANAGED_CASE_MANAGER_FIELDS = ['firstName', 'lastName', 'status'];

/**
 * Fields owned by HHAeXchange on an HHA-sourced nurse.
 *
 * GetCaregiverDemographics supplies the person (name, phone, address) and the
 * licence facts (Discipline -> professionalRole, ProfessionalLicensenumber,
 * NPINumber); the nurse roster supplies the active flag. All of those are
 * overwritten every run, so they are read-only here -- licenseNumber and npi
 * included even when HHAeXchange sent them blank, because HHAeXchange is where
 * the agency records them.
 *
 * PreventaTri-owned and editable on every nurse, imported or not:
 * licenseState, licenseExpirationDate (HHAeXchange never publishes one, which
 * is why the column is nullable), secondary regions, onCallIndicator,
 * preferredContactMethod, notes and joiningDate. Primary regions follow
 * HHA_DERIVED_NURSE_FIELDS.
 *
 * Spans two tables, because NurseProfile is a User satellite: the first seven
 * live on `users`, the rest on `nurse_profiles`. The admin edit path
 * (updateNurse) and the self-service path (updateProfile) both check this
 * list. `email` is absent for the same reason as on caregivers.
 */
const HHA_MANAGED_NURSE_FIELDS = [
  'firstName',
  'lastName',
  'phoneNo',
  'address',
  'city',
  'state',
  'zipCode',
  'professionalRole',
  'status',
  'licenseNumber',
  'npi',
];

/**
 * The resources one sync run reconciles, in run order.
 *
 * This is what makes the orchestrator and the nightly cron generic: both
 * iterate this registry rather than naming patients. Adding authorizations
 * later is an entry here plus a runner, with no change to
 * HhaSyncServices.runSync, the cron registration, the controller or the button.
 *
 * Ordering rules:
 *  - NURSES before CAREGIVERS: HHAeXchange lists nurses inside the caregiver
 *    feed, and the caregiver runner skips the roster ids the nurse runner puts
 *    on the run context (it refuses to run without them).
 *  - PATIENTS after every person resource: the patient runner links each
 *    patient to its nurse and case manager by HHAeXchange id or name, so those
 *    rows must already exist. A person resource that failed this run leaves
 *    last run's rows, which is still a valid target.
 *  - VISITS last: it is the longest walk and reads nothing the others write.
 *
 * `modifiedAfterFormat` is per resource rather than per run because feed
 * versions disagree on the trailing Z -- see HHAX_MODIFIED_AFTER_FORMAT.
 *
 * `lookbackDaysKey` is per resource for a stranger reason, live-verified
 * 2026-09-01. On the DEMOGRAPHIC feeds ModifiedAfter behaves as documented: an
 * older date returns MORE records, so a 3650-day window means "everything". On
 * GetVisitChangesV5 it is effectively WINDOWED and an older date returns FEWER:
 *
 *   2015-01-01 -> 0      2021-01-01 -> 0      2024-09-01 -> 0
 *   2025-01-01 -> 5      2026-01-01 -> 2841   2026-06-03 (~90d) -> 6827
 *
 * So the demographic lookback applied to visits would sync ZERO rows forever
 * while reporting success -- the worst possible failure, because it is silent.
 */
const HHAX_SYNC_RESOURCES = {
  // Labelled "Case Managers" because that is the PreventaTri word for the
  // role; the HHAeXchange operation is GetCoordinators.
  COORDINATORS: {
    value: 'COORDINATORS',
    label: 'Case Managers',
    summaryKey: 'caseManagers',
    modifiedAfterFormat: HHAX_MODIFIED_AFTER_FORMAT,
    lookbackDaysKey: 'hhax.lookbackDays',
  },
  NURSES: {
    value: 'NURSES',
    label: 'Nurses',
    summaryKey: 'nurses',
    modifiedAfterFormat: HHAX_MODIFIED_AFTER_FORMAT,
    lookbackDaysKey: 'hhax.lookbackDays',
  },
  CAREGIVERS: {
    value: 'CAREGIVERS',
    label: 'Caregivers',
    summaryKey: 'caregivers',
    modifiedAfterFormat: HHAX_MODIFIED_AFTER_FORMAT,
    lookbackDaysKey: 'hhax.lookbackDays',
  },
  PATIENTS: {
    value: 'PATIENTS',
    label: 'Patients',
    summaryKey: 'patients',
    modifiedAfterFormat: HHAX_MODIFIED_AFTER_FORMAT,
    lookbackDaysKey: 'hhax.lookbackDays',
  },
  VISITS: {
    value: 'VISITS',
    label: 'Visits',
    summaryKey: 'visits',
    modifiedAfterFormat: HHAX_VISIT_MODIFIED_AFTER_FORMAT,
    lookbackDaysKey: 'hhax.visitLookbackDays',
  },
};

const HHAX_SYNC_RESOURCES_VALUES = Object.values(HHAX_SYNC_RESOURCES).map(
  (resource) => resource.value
);

/**
 * Redis key for the single-run lock. Held for the run, released in a finally.
 *
 * Resource-agnostic on purpose: one run covers every resource in
 * HHAX_SYNC_RESOURCES, so one lock is what stops the nightly job and a button
 * press overlapping. One lock PER ORGANIZATION (this prefix + the organization
 * id): a sync in one organization never blocks another's. Renamed from 'hhax:patient-sync:lock' when caregivers
 * joined the run -- if you are debugging a stuck 409, this is the key to
 * inspect.
 */
const HHAX_SYNC_LOCK_KEY_PREFIX = 'hhax:sync:lock:';

/**
 * Claimed by the replica that runs an organization's nightly sync, so a second
 * replica walking the same list does not run it again after the first one's lock
 * is released. Shorter than a day, so tomorrow night's run is never blocked.
 */
const HHAX_NIGHTLY_CLAIM_KEY_PREFIX = 'hhax:sync:nightly:';
const HHAX_NIGHTLY_CLAIM_TTL_MS = 20 * 60 * 60 * 1000;

/**
 * Claimed by the controller before it enqueues, released by the worker once the
 * real lock is held. Needed because the lock is taken inside the WORKER, so
 * between the button press and the job starting isSyncRunning() is still false
 * and a second press would enqueue a duplicate run.
 *
 * Not a fixed BullMQ jobId: that only dedupes while the job exists in Redis, so
 * a retained failed job would silently swallow later presses.
 */
const HHAX_SYNC_QUEUED_KEY_PREFIX = 'hhax:sync:queued:';

// Only has to cover enqueue -> pickup, so minutes rather than the lock's hour.
const HHAX_SYNC_QUEUED_TTL_MS = 10 * 60 * 1000;

/**
 * Run-level failures, as opposed to the per-record HHAX_SYNC_EXCEPTION_TYPES.
 * Recorded as the audit row's errorId, so they must not be free text.
 */
const HHAX_SYNC_RUN_ERROR_IDS = {
  LOCK_OWNERSHIP_LOST: 'LOCK_OWNERSHIP_LOST',

  // The run never started: the queue would not accept the job.
  ENQUEUE_FAILED: 'ENQUEUE_FAILED',

  // A runner threw outside its own error handling.
  RUN_CRASHED: 'RUN_CRASHED',

  // The organization has no connected HHAeXchange credentials, so nothing was sent.
  HHA_NOT_CONNECTED: 'HHA_NOT_CONNECTED',

  // The organization's credentials could not be read (database or key problem).
  HHA_CREDENTIALS_UNAVAILABLE: 'HHA_CREDENTIALS_UNAVAILABLE',
};

// A feed failure with no HHA error id is stored as e.g. HTTP_403.
const HHA_SYNC_RUN_HTTP_ERROR_PREFIX = 'HTTP_';

/** Column widths the mapper enforces before any write reaches Postgres. */
const HHAX_FIELD_MAX_LENGTHS = {
  NAME: 100,
  ADDRESS: 500,
  CITY: 100,
  STATE: 2,
  ZIP_CODE: 10,
  PHONE: PHONE_NUMBER_MAX_LENGTH,
  MEDICAID_ID: 50,
  PATIENT_ID: 32,
  CAREGIVER_ID: 32,
  EMAIL: 255,

  // CaregiverProfile.language is VarChar(10) and holds a code, not a name.
  LANGUAGE: 10,
  ROLE: 50,

  // Coordinator -> case manager columns.
  COORDINATOR_ID: 32,

  // Nurse columns. NURSE_ID matches CAREGIVER_ID because it IS the caregiver id.
  NURSE_ID: 32,
  LICENSE_NUMBER: 50,
  NPI: 10,

  // Visit columns. VISIT_ID mirrors PATIENT_ID / CAREGIVER_ID so one identity
  // width covers the whole integration.
  // No VISIT_TYPE: visit_type is the HhaVisitType enum, resolved through
  // HHAX_VISIT_TYPE_MAP rather than stored as free text, so it has no width.
  VISIT_ID: 32,
  EVV_TYPE: 50,
  TIME_ZONE: 50,
  MISSED_REASON: 255,
  DELETED_REASON: 255,
};

const HHAX_ZIP_LENGTH = 5;

/** Lifecycle of one stored sync run (hha_sync_runs.status). */
const HHA_SYNC_RUN_STATUSES = {
  RUNNING: {value: 'RUNNING', label: 'Running'},
  SUCCEEDED: {value: 'SUCCEEDED', label: 'Succeeded'},

  // Every step finished but raised a blocking exception. Fits VarChar(16).
  WITH_EXCEPTIONS: {
    value: 'WITH_EXCEPTIONS',
    label: 'Completed with exceptions',
  },
  PARTIAL: {value: 'PARTIAL', label: 'Partly failed'},
  FAILED: {value: 'FAILED', label: 'Failed'},

  // The process died mid-run; marked by the next run, which holds the lock.
  ABANDONED: {value: 'ABANDONED', label: 'Abandoned'},
};

const HHA_SYNC_RUN_STATUSES_VALUES = Object.values(HHA_SYNC_RUN_STATUSES).map(
  (status) => status.value
);

/**
 * Lifecycle of one stored exception. DISMISSED survives a repeat; RESOLVED and
 * AUTO_RESOLVED reopen when a later run raises the same problem again.
 */
const HHA_SYNC_EXCEPTION_STATUSES = {
  OPEN: {value: 'OPEN', label: 'Open'},
  RESOLVED: {value: 'RESOLVED', label: 'Resolved'},
  DISMISSED: {value: 'DISMISSED', label: 'Dismissed'},
  AUTO_RESOLVED: {value: 'AUTO_RESOLVED', label: 'Resolved by sync'},
};

const HHA_SYNC_EXCEPTION_STATUSES_VALUES = Object.values(
  HHA_SYNC_EXCEPTION_STATUSES
).map((status) => status.value);

// Column widths of hha_sync_runs / hha_sync_exceptions.
const HHA_SYNC_HISTORY_MAX_LENGTHS = {
  ERROR_ID: 64,
  DETAIL: 255,
  DEDUPE_KEY: 255,
  RESOLUTION_NOTE: 500,
};

const HHA_SYNC_EXCEPTION_KEY_SEPARATOR = ':';

// Raised only when the record changes, so a quiet run proves nothing: these
// wait for an admin instead of closing on their own.
const HHA_SYNC_EVENT_ONLY_EXCEPTION_TYPES = [
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_PATIENT_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CAREGIVER_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_NURSE_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CASE_MANAGER_UPDATED,
  HHAX_SYNC_EXCEPTION_TYPES.HHA_EMAIL_CHANGED,

  // The run that raises it also clears the pick, so later runs stay quiet.
  HHAX_SYNC_EXCEPTION_TYPES.SELECTED_COORDINATOR_REMOVED,
];

// An open one of these means the person's login email is unsettled, so they
// cannot be invited until an admin resolves it.
const HHA_INVITE_BLOCKING_EXCEPTION_TYPES = [
  HHAX_SYNC_EXCEPTION_TYPES.DUPLICATE_EMAIL,
  HHAX_SYNC_EXCEPTION_TYPES.EMAIL_IN_USE,
  HHAX_SYNC_EXCEPTION_TYPES.INVALID_EMAIL,
  HHAX_SYNC_EXCEPTION_TYPES.HHA_EMAIL_CHANGED,
];

// Rows per history query, well under Postgres' bind-parameter limit.
const HHA_SYNC_HISTORY_BATCH_SIZE = 500;

/** What one hha_sync_changes row records. */
const HHA_SYNC_CHANGE_ACTIONS = {
  CREATED: {value: 'CREATED', label: 'Created'},
  UPDATED: {value: 'UPDATED', label: 'Updated'},
  LINK_CHANGED: {value: 'LINK_CHANGED', label: 'Link changed'},
  EMAIL_CHANGED: {value: 'EMAIL_CHANGED', label: 'Email changed'},
  ADOPTED: {value: 'ADOPTED', label: 'Linked to existing user'},
  RECLASSIFIED: {value: 'RECLASSIFIED', label: 'Caregiver became nurse'},
  PURGED: {value: 'PURGED', label: 'Caregiver profile removed'},
  DELETED_IN_HHA: {value: 'DELETED_IN_HHA', label: 'Deleted in HHA'},
};

const HHA_SYNC_CHANGE_ACTIONS_VALUES = Object.values(
  HHA_SYNC_CHANGE_ACTIONS
).map((action) => action.value);

/** Visit columns the sync writes; the change history diffs these. */
const HHA_VISIT_TRACKED_FIELDS = [
  'hhaPatientId',
  'hhaCaregiverId',
  'patientFirstName',
  'patientLastName',
  'caregiverFirstName',
  'caregiverLastName',
  'visitDate',
  'visitType',
  'timeZone',
  'status',
  'scheduledStartAt',
  'scheduledEndAt',
  'scheduleDurationMinutes',
  'actualStartAt',
  'actualEndAt',
  'evvStartAt',
  'evvEndAt',
  'clockInEvvType',
  'clockOutEvvType',
  'isMissedVisit',
  'missedReasonId',
  'missedReason',
];

/** Patient link columns the link sync may move. */
const HHA_PATIENT_TRACKED_LINK_FIELDS = [
  'countyId',
  'primaryNurseProfileId',
  'secondaryNurseProfileId',
];

// Field names for history entries that are not a column of the synced row.
const HHA_SYNC_CHANGE_FIELDS = {
  CASE_MANAGER: 'caseManagerProfileId',
  EMAIL: 'email',
  PRIMARY_REGIONS: 'primaryRegionIds',
  STATUS: 'status',
  CAREGIVER_PROFILE: 'caregiverProfileId',
  USER: 'userId',
};

// List filters and default orders of the sync history endpoints.
const HHA_SYNC_HISTORY_FILTER_ALL = 'all';

// A Running row younger than this is never closed as dead: its run may have
// taken the lock a moment after the reader looked.
const HHA_SYNC_DEAD_RUN_GRACE_MS = 60 * 1000;
const HHA_SYNC_RUN_DEFAULT_SORT = [{startedAt: 'desc'}, {id: 'desc'}];
const HHA_SYNC_CHANGE_DEFAULT_SORT = [{createdAt: 'desc'}, {id: 'desc'}];

// Newest problem first. Not lastSeenAt alone: a run refreshes every old row
// just after inserting the new ones, which buried new exceptions below them.
const HHA_SYNC_EXCEPTION_DEFAULT_SORT = [
  {firstSeenAt: 'desc'},
  {lastSeenAt: 'desc'},
  {id: 'desc'},
];

/** The statuses an admin may set by hand; AUTO_RESOLVED is the sync's alone. */
const HHA_SYNC_EXCEPTION_ADMIN_STATUSES = [
  HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
  HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
  HHA_SYNC_EXCEPTION_STATUSES.DISMISSED.value,
];

/** What a history row's HHA id points at here; the frontend builds links from it. */
const HHA_SYNC_RECORD_KINDS = {
  PATIENT: 'patient',
  NURSE: 'nurse',
  CAREGIVER: 'caregiver',
  CASE_MANAGER: 'caseManager',
  VISIT: 'visit',
  USER: 'user',
};

/** Where one person stands in a group sharing an HHAeXchange address. */
const HHA_EMAIL_CONFLICT_STATES = {
  USES_EMAIL: 'USES_EMAIL',
  NEEDS_EMAIL: 'NEEDS_EMAIL',
  ADMIN_SET: 'ADMIN_SET',
  OTHER_EMAIL: 'OTHER_EMAIL',

  // Not imported: waiting for an email, or for the next sync to import them.
  NOT_IMPORTED: 'NOT_IMPORTED',
  EMAIL_SAVED: 'EMAIL_SAVED',
};

// HHA_EMAIL_CHANGED detail: "old -> new", with a word for a missing address.
const HHA_EMAIL_CHANGE_SEPARATOR = ' -> ';
const HHA_EMAIL_NONE_LABEL = 'none';

// People created, updated or fetched at once. Each create holds a database
// transaction, so this stays well under the connection pool size.
const HHAX_SYNC_WRITE_CONCURRENCY = 5;

// The note left on an exception closed by importing the person directly.
const HHA_PENDING_IMPORT_RESOLUTION_NOTE =
  'An admin gave this person a login email and they were imported.';

// The note left on email exceptions closed by an admin giving a user their own email.
const HHA_ADMIN_EMAIL_RESOLUTION_NOTE =
  'An admin gave this person their own login email.';

// Writes of users.hha_email sent at once; kept under the connection pool size.
const HHA_EMAIL_STORE_CONCURRENCY = 5;

/** A shared address needs attention until nobody in it waits for an email. */
const HHA_EMAIL_CONFLICT_FILTERS = {
  NEEDS_ATTENTION: 'needsAttention',
  RESOLVED: 'resolved',
};

const HHA_EMAIL_CONFLICT_FILTERS_VALUES = Object.values(
  HHA_EMAIL_CONFLICT_FILTERS
);

const HHA_EMAIL_CONFLICT_OPEN_STATES = [
  HHA_EMAIL_CONFLICT_STATES.NEEDS_EMAIL,
  HHA_EMAIL_CONFLICT_STATES.OTHER_EMAIL,
  HHA_EMAIL_CONFLICT_STATES.NOT_IMPORTED,
];

/** Whose primary nurse an admin keeps when HHAeXchange and PreventaTri differ. */
const HHA_PRIMARY_NURSE_CHOICES = {
  PREVENTATRI: 'PREVENTATRI',
  HHA: 'HHA',
};

const HHA_PRIMARY_NURSE_CHOICES_VALUES = Object.values(
  HHA_PRIMARY_NURSE_CHOICES
);

// A case manager conflict is settled with the same two answers.
const HHA_CASE_MANAGER_CHOICES = HHA_PRIMARY_NURSE_CHOICES;

const HHA_CASE_MANAGER_RESOLUTION_NOTES = {
  [HHA_CASE_MANAGER_CHOICES.PREVENTATRI]:
    'An admin kept the current case manager.',
  [HHA_CASE_MANAGER_CHOICES.HHA]:
    'An admin chose the HHAeXchange case manager.',
};

/** Whether the sync may link a nurse or case manager to a patient. */
const HHA_LINK_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  INVITATION_PENDING: 'INVITATION_PENDING',
  NOT_ACTIVE: 'NOT_ACTIVE',
};

/** The person-level exception a waiting nurse or case manager is reported as. */
const HHA_PENDING_PERSON_EXCEPTION_TYPES = {
  [HHA_SYNC_RECORD_KINDS.NURSE]: {
    [HHA_LINK_ELIGIBILITY.INVITATION_PENDING]:
      HHAX_SYNC_EXCEPTION_TYPES.NURSE_INVITATION_PENDING,
    [HHA_LINK_ELIGIBILITY.NOT_ACTIVE]:
      HHAX_SYNC_EXCEPTION_TYPES.NURSE_NOT_ACTIVE,
  },
  [HHA_SYNC_RECORD_KINDS.CASE_MANAGER]: {
    [HHA_LINK_ELIGIBILITY.INVITATION_PENDING]:
      HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_INVITATION_PENDING,
    [HHA_LINK_ELIGIBILITY.NOT_ACTIVE]:
      HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_NOT_ACTIVE,
  },
};

/** The patient column holding who each kind of waiting person is. */
const HHA_PENDING_PERSON_PATIENT_FIELDS = {
  [HHA_SYNC_RECORD_KINDS.NURSE]: 'hhaPendingNurseProfileId',
  [HHA_SYNC_RECORD_KINDS.CASE_MANAGER]: 'hhaPendingCaseManagerProfileId',
};

const HHA_PENDING_PERSON_EXCEPTION_TYPES_VALUES = Object.values(
  HHA_PENDING_PERSON_EXCEPTION_TYPES
).flatMap((types) => Object.values(types));

// The note left on a person's exception once they are active and linked.
// Conflicts are not counted as assigned: the next sync raises them.
const HHA_PENDING_LINKS_RESOLUTION_NOTE = {
  ASSIGNED: 'This person is active now. Patients assigned: ',
  WAITING: '. Waiting for an admin choice after the next sync: ',
};

// The note left on "county not set up" exceptions closed by adding the county.
const HHA_COUNTY_ADDED_RESOLUTION_NOTE =
  'An admin added this county to a region.';

// The notes left on a nurse conflict the admin closed by choosing.
const HHA_PRIMARY_NURSE_RESOLUTION_NOTES = {
  [HHA_PRIMARY_NURSE_CHOICES.PREVENTATRI]:
    'An admin kept the PreventaTri primary nurse.',
  [HHA_PRIMARY_NURSE_CHOICES.HHA]:
    'An admin chose the HHAeXchange primary nurse.',
};

/** Coordinators view: patients still on HHA's first coordinator, or chosen. */
const HHA_COORDINATOR_CHOICE_FILTERS = {
  NEEDS_CHOICE: 'needsChoice',
  CHOSEN: 'chosen',
};

const HHA_COORDINATOR_CHOICE_FILTERS_VALUES = Object.values(
  HHA_COORDINATOR_CHOICE_FILTERS
);

// A patient is on the Coordinators view once HHA lists a second coordinator.
const HHA_COORDINATOR_FIRST_SLOT = 1;
const HHA_COORDINATOR_SHARED_SLOT = 2;

const HHA_COORDINATOR_NAME_MAX_LENGTH = 200;

// HHA Sync lists show the newest record first, like runs, changes and exceptions.
const HHA_PATIENT_COORDINATOR_DEFAULT_SORT = [
  {createdAt: 'desc'},
  {id: 'desc'},
];

module.exports = {
  HHAX_SYNC_WRITE_CONCURRENCY,
  HHA_PENDING_IMPORT_RESOLUTION_NOTE,
  HHA_ADMIN_EMAIL_RESOLUTION_NOTE,
  HHA_COUNTY_ADDED_RESOLUTION_NOTE,
  HHA_EMAIL_CHANGE_SEPARATOR,
  HHA_EMAIL_NONE_LABEL,
  HHA_EMAIL_STORE_CONCURRENCY,
  HHA_EMAIL_CONFLICT_STATES,
  HHA_EMAIL_CONFLICT_FILTERS,
  HHA_EMAIL_CONFLICT_FILTERS_VALUES,
  HHA_EMAIL_CONFLICT_OPEN_STATES,
  HHA_INVITE_BLOCKING_EXCEPTION_TYPES,
  HHA_PRIMARY_NURSE_CHOICES,
  HHA_PRIMARY_NURSE_CHOICES_VALUES,
  HHA_PRIMARY_NURSE_RESOLUTION_NOTES,
  HHA_CASE_MANAGER_CHOICES,
  HHA_CASE_MANAGER_RESOLUTION_NOTES,
  HHA_MANAGED_PATIENT_CASE_MANAGER_FIELDS,
  HHA_LINK_ELIGIBILITY,
  HHA_PENDING_PERSON_EXCEPTION_TYPES,
  HHA_PENDING_PERSON_EXCEPTION_TYPES_VALUES,
  HHA_PENDING_PERSON_PATIENT_FIELDS,
  HHA_PENDING_LINKS_RESOLUTION_NOTE,
  HHA_COORDINATOR_CHOICE_FILTERS,
  HHA_COORDINATOR_CHOICE_FILTERS_VALUES,
  HHA_COORDINATOR_FIRST_SLOT,
  HHA_COORDINATOR_SHARED_SLOT,
  HHA_COORDINATOR_NAME_MAX_LENGTH,
  HHA_PATIENT_COORDINATOR_DEFAULT_SORT,
  HHA_SYNC_HISTORY_FILTER_ALL,
  HHA_SYNC_DEAD_RUN_GRACE_MS,
  HHA_SYNC_RUN_DEFAULT_SORT,
  HHA_SYNC_CHANGE_DEFAULT_SORT,
  HHA_SYNC_EXCEPTION_DEFAULT_SORT,
  HHA_SYNC_EXCEPTION_ADMIN_STATUSES,
  HHA_SYNC_RECORD_KINDS,
  HHA_SYNC_CHANGE_ACTIONS,
  HHA_SYNC_CHANGE_ACTIONS_VALUES,
  HHA_VISIT_TRACKED_FIELDS,
  HHA_PATIENT_TRACKED_LINK_FIELDS,
  HHA_SYNC_CHANGE_FIELDS,
  HHA_SYNC_HISTORY_BATCH_SIZE,
  HHA_SYNC_RUN_STATUSES,
  HHA_SYNC_RUN_STATUSES_VALUES,
  HHA_SYNC_EXCEPTION_STATUSES,
  HHA_SYNC_EXCEPTION_STATUSES_VALUES,
  HHA_SYNC_HISTORY_MAX_LENGTHS,
  HHA_SYNC_EXCEPTION_KEY_SEPARATOR,
  HHA_SYNC_EVENT_ONLY_EXCEPTION_TYPES,
  HHAX_XML_NAMESPACE,
  HHAX_SOAP_ENV_NAMESPACE,
  HHAX_SOAP_ACTION_BASE,
  HHAX_CONTENT_TYPE,
  HHAX_REQUEST_METHOD,
  HHAX_XML_DECLARATION,
  HHAX_OPERATIONS,
  HHAX_ENVELOPE_ELEMENTS,
  HHAX_REQUEST_ELEMENTS,
  HHAX_PAGINATION_ELEMENTS,
  HHAX_LOWERCASE_PAGINATION_ELEMENTS,
  HHAX_PATIENT_ELEMENTS,
  HHAX_PATIENT_NO_COORDINATOR_VALUE,
  HHAX_COORDINATOR_MATCH_KINDS,
  HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS,
  HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS,
  HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS,
  HHAX_CAREGIVER_ELEMENTS,
  HHAX_LANGUAGE_ELEMENTS,
  HHAX_COORDINATOR_ELEMENTS,
  HHAX_COORDINATOR_REQUEST_ELEMENTS,
  HHAX_NURSE_ELEMENTS,
  HHAX_NURSE_REQUEST_ELEMENTS,
  HHAX_VISIT_ELEMENTS,
  HHAX_DELETED_VISIT_ELEMENTS,
  HHAX_MISSED_REASON_ELEMENTS,
  HHAX_STATUS_FILTER_ALL,
  HHAX_RESULT_STATUSES,
  HHAX_ERROR_IDS,
  HHAX_MODIFIED_AFTER_FORMAT,
  HHAX_VISIT_MODIFIED_AFTER_FORMAT,
  HHAX_FIRST_PAGE_NUMBER,
  HHAX_PAGE_SIZE,
  HHAX_DATE_FORMATS,
  HHAX_VISIT_DATETIME_FORMATS,
  HHAX_VISIT_TIME_ONLY_FORMATS,
  HHAX_MISSED_VISIT_MAP,
  HHAX_TIMEZONE_MAP,
  HHAX_VISIT_TYPE_MAP,
  HHAX_PATIENT_STATUS_MAP,
  HHAX_DEFAULT_PATIENT_STATUS,
  HHAX_GENDER_MAP,
  HHAX_CAREGIVER_STATUS_MAP,
  HHAX_DEFAULT_CAREGIVER_STATUS,
  HHAX_DEFAULT_CAREGIVER_ROLE,
  HHAX_COORDINATOR_ACTIVE_MAP,
  HHAX_DEFAULT_CASE_MANAGER_STATUS,
  HHAX_NURSE_ACTIVE_MAP,
  HHAX_DEFAULT_NURSE_STATUS,
  HHAX_PROFESSIONAL_ROLE_MAP,
  HHAX_DEFAULT_PROFESSIONAL_ROLE,
  HHAX_LANGUAGE_NAME_MAP,
  HHAX_PLACEHOLDER_EMAIL_DOMAIN,
  HHAX_PLACEHOLDER_EMAIL_PREFIXES,
  HHAX_MASKED_FIELDS,
  HHAX_SYNC_TRIGGERS,
  HHAX_SYNC_TRIGGERS_VALUES,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHA_SYNC_WARNING_EXCEPTION_TYPES,
  HHA_MANAGED_PATIENT_FIELDS,
  HHA_MANAGED_PATIENT_LINK_FIELDS,
  HHA_DERIVED_PATIENT_FIELDS,
  HHA_DERIVED_NURSE_FIELDS,
  HHA_MANAGED_CAREGIVER_FIELDS,
  HHA_MANAGED_CASE_MANAGER_FIELDS,
  HHA_MANAGED_NURSE_FIELDS,
  HHAX_SYNC_RESOURCES,
  HHAX_SYNC_RESOURCES_VALUES,
  HHAX_SYNC_LOCK_KEY_PREFIX,
  HHAX_NIGHTLY_CLAIM_KEY_PREFIX,
  HHAX_NIGHTLY_CLAIM_TTL_MS,
  HHAX_SYNC_QUEUED_KEY_PREFIX,
  HHAX_SYNC_QUEUED_TTL_MS,
  HHAX_SYNC_RUN_ERROR_IDS,
  HHA_SYNC_RUN_HTTP_ERROR_PREFIX,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_ZIP_LENGTH,
};
