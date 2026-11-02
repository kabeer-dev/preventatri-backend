const {safeConcat, safeMerge} = require('./general');

const {
  getAutoIncludeRelations,
  getModelDefaultFields,
} = require('./modelSchemaUtils');

const {modelConstants} = require('../constants');

const {HHA_LINK_ELIGIBILITY} = require('../constants/hhaExchangeConstants');

const {
  PATIENTS_LIST_API_FIELDS_OPTIONS,
} = require('../constants/patientsConstants');

const {
  LINK_ELIGIBILITY_SELECT,
  resolveLinkEligibility,
} = require('./hhaExchange/linkEligibilityUtils');

const nurseRefSelect = {
  select: {
    id: true,
    user: {select: {firstName: true, lastName: true}},
  },
};

const formatNurseRef = ({nurse}) =>
  nurse
    ? {
        id: nurse.id,
        user: nurse.user
          ? {firstName: nurse.user.firstName, lastName: nurse.user.lastName}
          : null,
      }
    : null;

const personRefSelect = {
  select: {
    id: true,
    user: {select: {id: true, firstName: true, lastName: true}},
  },
};

const formatPersonRef = ({profile}) =>
  profile
    ? {
        id: profile.id,
        user: profile.user
          ? {
              id: profile.user.id,
              firstName: profile.user.firstName,
              lastName: profile.user.lastName,
            }
          : null,
      }
    : null;

// case_manager_patients is unique on patientId: at most one row per patient.
const assignedCaseManagerSelect = {
  caseManagerPatients: {select: {caseManagerProfile: personRefSelect}},
};

// Every coordinator HHAeXchange lists on the patient; one is the case manager.
const hhaCoordinatorsSelect = {
  hhaSelectedCaseManagerProfileId: true,
  hhaCoordinators: {
    orderBy: {slot: 'asc'},
    select: {
      slot: true,
      hhaCoordinatorName: true,
      caseManagerProfileId: true,
      caseManagerProfile: {
        select: Object.assign({id: true}, LINK_ELIGIBILITY_SELECT),
      },
    },
  },
};

// Who HHAeXchange names on the patient but cannot be linked yet.
const hhaPendingPeopleSelect = {
  hhaPendingNurse: personRefSelect,
  hhaPendingCaseManager: personRefSelect,
};

// A caregiver is assigned by a direct link or by any non-deleted assessment.
const assignedCaregiversSelect = {
  caregiverPatients: {
    where: {caregiverProfile: {isDeleted: null}},
    select: {caregiverProfile: personRefSelect},
  },
  checklistAssignments: {
    where: {isDeleted: null, caregiverProfile: {isDeleted: null}},
    select: {caregiverProfile: personRefSelect},
  },
};

/** Undefined when the relation was not loaded, so the key is left out. */
const formatPendingPerson = ({profile}) =>
  profile === undefined ? undefined : formatPersonRef({profile});

/** Undefined when the relation was not loaded, so the key is left out. */
const formatAssignedCaseManager = ({patient}) =>
  patient.caseManagerPatients === undefined
    ? undefined
    : formatPersonRef({
        profile: patient.caseManagerPatients[0]?.caseManagerProfile,
      });

/**
 * HHA's coordinators with which one is the case manager here. Undefined when
 * the relation was not loaded, so the key is left out.
 */
const formatHhaCoordinators = ({patient}) => {
  if (patient.hhaCoordinators === undefined) return undefined;

  const caseManagerProfileId =
    patient.caseManagerPatients?.[0]?.caseManagerProfile?.id || null;

  return patient.hhaCoordinators.map((row) => ({
    slot: row.slot,
    name: row.hhaCoordinatorName,
    caseManagerProfileId: row.caseManagerProfileId || null,

    // An archived profile may come back null or with its deletion timestamp.
    isArchived:
      Boolean(row.caseManagerProfileId) &&
      (!row.caseManagerProfile || Boolean(row.caseManagerProfile.isDeleted)),

    // Only an active coordinator can be made the case manager.
    isActive:
      Boolean(row.caseManagerProfile) &&
      resolveLinkEligibility({profile: row.caseManagerProfile}) ===
        HHA_LINK_ELIGIBILITY.ELIGIBLE,
    isCaseManager:
      Boolean(row.caseManagerProfileId) &&
      row.caseManagerProfileId === caseManagerProfileId,
  }));
};

/**
 * Each caregiver once, whether linked directly or through assessments.
 * Undefined unless assessments were loaded: links alone would be partial.
 */
const formatAssignedCaregivers = ({patient}) => {
  if (patient.checklistAssignments === undefined) return undefined;

  const byId = new Map();

  (patient.caregiverPatients || [])
    .concat(patient.checklistAssignments)
    .forEach(({caregiverProfile}) => {
      if (caregiverProfile && !byId.has(caregiverProfile.id)) {
        byId.set(
          caregiverProfile.id,
          formatPersonRef({profile: caregiverProfile})
        );
      }
    });

  return Array.from(byId.values());
};

// Everyone looking after the patient: both nurses, the case manager and every
// assigned caregiver, as name-only references.
const patientCareTeamSelect = {
  primaryNurse: nurseRefSelect,
  secondaryNurse: nurseRefSelect,
  caseManagerPatients: assignedCaseManagerSelect.caseManagerPatients,
  caregiverPatients: assignedCaregiversSelect.caregiverPatients,
  checklistAssignments: assignedCaregiversSelect.checklistAssignments,
};

const formatPatientCareTeam = ({patient}) => ({
  primaryNurse: formatNurseRef({nurse: patient.primaryNurse}),
  secondaryNurse: formatNurseRef({nurse: patient.secondaryNurse}),
  caseManager: formatAssignedCaseManager({patient}),
  assignedCaregivers: formatAssignedCaregivers({patient}),
});

// The patient record a flag review states beside the alert.
const patientRecordSelect = safeMerge({
  originalObj: {
    firstName: true,
    lastName: true,
    email: true,
    address: true,
    city: true,
    phoneNo: true,
    dateOfBirth: true,
    medicaidId: true,
    diagnoses: true,
    emergencyContact: true,
  },
  newObj: patientCareTeamSelect,
});

// Fields are named one by one so the raw care-team join rows never leak.
const formatPatientRecord = ({patient}) =>
  Object.assign(
    {
      firstName: patient.firstName,
      lastName: patient.lastName,
      email: patient.email,
      address: patient.address,
      city: patient.city,
      phoneNo: patient.phoneNo,
      dateOfBirth: patient.dateOfBirth,
      medicaidId: patient.medicaidId,
      diagnoses: patient.diagnoses,
      emergencyContact: patient.emergencyContact,
    },
    formatPatientCareTeam({patient})
  );

// Response keys of the patients list views that are not plain patient columns.
// `select` builds the Prisma select fragment for the key; `format` builds the
// response value from the fetched patient. Any key not listed here is treated
// as a plain column (select `{[key]: true}`, return `patient[key]`).
const PATIENTS_LIST_VIEW_FIELD_RESOLVERS = {
  county: {
    select: () => ({county: {select: {name: true}}}),
    format: ({patient}) =>
      patient.county ? {name: patient.county.name} : null,
  },
  region: {
    select: () => ({
      county: {select: {region: {select: {name: true}}}},
    }),
    format: ({patient}) =>
      patient.county?.region ? {name: patient.county.region.name} : null,
  },
  primaryNurse: {
    select: () => ({primaryNurse: nurseRefSelect}),
    format: ({patient}) => formatNurseRef({nurse: patient.primaryNurse}),
  },
  secondaryNurse: {
    select: () => ({secondaryNurse: nurseRefSelect}),
    format: ({patient}) => formatNurseRef({nurse: patient.secondaryNurse}),
  },
  caseManager: {
    select: () => assignedCaseManagerSelect,
    format: formatAssignedCaseManager,
  },
  assignedCaregivers: {
    select: () => assignedCaregiversSelect,
    format: formatAssignedCaregivers,
  },
  lastFlag: {
    select: ({lastFlagSelect}) => lastFlagSelect,
    format: ({patient}) => patient.submissionFlags?.[0]?.flag ?? null,
  },
  deletedAt: {
    select: () => ({isDeleted: true}),
    format: ({patient}) => patient.isDeleted || null,
  },
};

/**
 * Resolve the fields to return for a patients list `view` query param.
 * Matches the view against PATIENTS_LIST_API_FIELDS_OPTIONS and returns that
 * option's `fields`, or undefined when no view is given or it doesn't match
 * (meaning the full patient response should be returned).
 */
function getPatientsListViewFields({view}) {
  if (!view) return undefined;

  return Object.values(PATIENTS_LIST_API_FIELDS_OPTIONS).find(
    (option) => option.value === view
  )?.fields;
}

/**
 * Build the PrismaFactory `fieldsInclusion` for a patients list `view`, using
 * that view's fields from PATIENTS_LIST_API_FIELDS_OPTIONS.
 * The view's select goes in `include` (it overrides the default relation
 * templates), and every default field / auto-included relation the view
 * doesn't use goes in `exclude`, so only the view's fields are fetched.
 * `lastFlagSelect` picks the newest RED or YELLOW flag, built by the caller
 * since its filter depends on the requester.
 */
function buildPatientsListViewFieldsInclusion({view, lastFlagSelect}) {
  const fields = getPatientsListViewFields({view}) || [];

  const include = fields.reduce((selectObj, field) => {
    const resolver = PATIENTS_LIST_VIEW_FIELD_RESOLVERS[field];

    const fieldSelect = resolver
      ? resolver.select({lastFlagSelect})
      : {[field]: true};

    return safeMerge({originalObj: selectObj, newObj: fieldSelect, deep: true});
  }, {});

  const model = modelConstants.MODELS.PATIENT;

  const exclude = safeConcat({
    originalArray: getModelDefaultFields({model}),
    newArray: getAutoIncludeRelations({model}),
  }).filter((field) => !(field in include));

  return {include, exclude};
}

/**
 * Format fetched patients into a patients list `view`'s response shape,
 * returning only that view's fields for each patient.
 */
function formatPatientsListView({patients, view}) {
  const fields = getPatientsListViewFields({view}) || [];

  return patients.map((patient) =>
    Object.fromEntries(
      fields.map((field) => {
        const resolver = PATIENTS_LIST_VIEW_FIELD_RESOLVERS[field];

        return [
          field,
          resolver ? resolver.format({patient}) : (patient[field] ?? null),
        ];
      })
    )
  );
}

module.exports = {
  hhaCoordinatorsSelect,
  hhaPendingPeopleSelect,
  formatPendingPerson,
  formatHhaCoordinators,
  assignedCaseManagerSelect,
  buildPatientsListViewFieldsInclusion,
  formatAssignedCaregivers,
  formatAssignedCaseManager,
  formatPatientCareTeam,
  formatPatientRecord,
  formatPatientsListView,
  patientCareTeamSelect,
  patientRecordSelect,
};
