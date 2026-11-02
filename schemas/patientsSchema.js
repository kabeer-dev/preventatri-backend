const Yup = require('yup');

const {validatorUtils, safeConcat, safeMerge} = require('../utils');

const {
  dateOfBirthSchema,
  notesSchema,
  commonListFiltersSchema,
  csvArraySchema,
} = require('./commonEntityValidations');
const commonPatientValidations = require('./commonPatientValidations');

const {
  commonSchema,
  commonPaginationSchema,
  commonUserSchema,
  commonUserUpdateSchema,
} = require('./commonSchema');

const {SYSTEM_ENTITIES} = require('../constants/aclConstants');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  PATIENTS_SORT_FIELDS_VALUES,
  PATIENT_STATUSES_VALUES,
  PATIENT_ARCHIVE_FILTERS,
  PATIENT_ARCHIVE_FILTERS_VALUES,
  PATIENT_SOURCES_VALUES,
  PATIENTS_LIST_API_VIEWS_VALUES,
} = require('../constants/patientsConstants');
const {ESCALATABLE_FLAGS} = require('../constants/riskCalcConstants');

const commonFieldsSchema = commonSchema();

// Shared test: when both primary and secondary nurse are set on a patient,
// they must reference different nurse profiles. Skips when either is missing
// so optional/nullable semantics still work.
const distinctPrimarySecondaryNursesTest = {
  name: 'distinct-primary-secondary-nurses',
  message: 'Primary and secondary nurse must be different for a patient',
  test: (value) => {
    const primary = value?.primaryNurseProfileId;
    const secondary = value?.secondaryNurseProfileId;

    if (!primary || !secondary) return true;

    return primary !== secondary;
  },
};

// ➕ Create Patient
module.exports.validatePatientCreateRequest = ({data}) => {
  const createSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: commonUserSchema,
        newObj: {
          // Required personal info
          dateOfBirth: dateOfBirthSchema({required: true}),
          gender: commonPatientValidations.genderSchema({required: true}),

          // Required location
          countyId: commonPatientValidations.countyIdSchema({required: true}),

          // Optional fields
          status: commonPatientValidations.patientStatusSchema({
            withDefault: true,
          }),
          address: commonPatientValidations.addressSchema(),
          city: Yup.string().max(100, 'City must not exceed 100 characters'),
          state: Yup.string().max(2, 'State must be a 2-character code'),
          zipCode: commonPatientValidations.zipCodeSchema(),
          email: commonFieldsSchema.email(),
          phoneNo: commonFieldsSchema.phoneNo().nullable(),
          emergencyContact: commonFieldsSchema
            .phoneNo({
              fieldName: 'Emergency contact phone number',
            })
            .nullable(),
          medicaidId: commonPatientValidations.medicaidIdSchema(),
          diagnoses: Yup.string().max(
            2000,
            'Diagnoses must not exceed 2000 characters'
          ),
          notes: notesSchema(),
          riskLevel: commonPatientValidations.riskLevelSchema(),

          // Optional caregiver assignments
          caregiverProfileIds:
            commonPatientValidations.caregiverProfileIdsSchema(),

          // Optional per-patient nurse assignments
          primaryNurseProfileId:
            commonPatientValidations.patientNurseProfileIdSchema({
              fieldLabel: 'Primary nurse',
            }),
          secondaryNurseProfileId:
            commonPatientValidations.patientNurseProfileIdSchema({
              fieldLabel: 'Secondary nurse',
            }),
        },
      })
    )
    .test(distinctPrimarySecondaryNursesTest);

  return validatorUtils.validate({schema: createSchema, data});
};

// 🔄 Update Patient
module.exports.validatePatientUpdateRequest = ({data}) => {
  const updateSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: commonUserUpdateSchema,
        newObj: {
          email: commonFieldsSchema.email().nullable(),
          phoneNo: commonFieldsSchema.phoneNo().nullable(),
          dateOfBirth: dateOfBirthSchema(),
          gender: commonPatientValidations.genderSchema(),

          countyId: commonPatientValidations.countyIdSchema(),
          status: commonPatientValidations.patientStatusSchema(),
          address: commonPatientValidations.addressSchema({nullable: true}),
          city: Yup.string()
            .max(100, 'City must not exceed 100 characters')
            .nullable(),
          state: Yup.string()
            .max(2, 'State must be a 2-character code')
            .nullable(),
          zipCode: commonPatientValidations.zipCodeSchema({nullable: true}),
          emergencyContact: commonFieldsSchema
            .phoneNo({
              fieldName: 'Emergency contact phone number',
            })
            .nullable(),
          medicaidId: commonPatientValidations.medicaidIdSchema({
            nullable: true,
          }),
          diagnoses: Yup.string().max(2000).nullable(),
          notes: notesSchema({nullable: true}),
          riskLevel: commonPatientValidations.riskLevelSchema({nullable: true}),

          // Optional per-patient nurse assignments
          primaryNurseProfileId:
            commonPatientValidations.patientNurseProfileIdSchema({
              fieldLabel: 'Primary nurse',
            }),
          secondaryNurseProfileId:
            commonPatientValidations.patientNurseProfileIdSchema({
              fieldLabel: 'Secondary nurse',
            }),

          // HHAeXchange patients only, while the case manager is editable.
          caseManagerProfileId:
            commonPatientValidations.patientNurseProfileIdSchema({
              fieldLabel: 'Case manager',
            }),
        },
      })
    )
    .test(distinctPrimarySecondaryNursesTest);

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🆔 Validate Patient ID Params
module.exports.validatePatientIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: SYSTEM_ENTITIES.patient.label}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 🕒 Patient Timeline Query Params (page + limit only)
module.exports.validatePatientTimelineQuery = ({data}) =>
  validatorUtils.validate({
    schema: commonPaginationSchema().shape({}),
    data,
  });

// 📋 List Patients Query Params
module.exports.validateListPatientsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: PATIENTS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape(
    safeMerge({
      originalObj: commonListFiltersSchema({
        statusSchema: Yup.string().oneOf(
          safeConcat({
            originalArray: PATIENT_STATUSES_VALUES,
            newArray: ['all'],
          }),
          `Status must be one of: ${PATIENT_STATUSES_VALUES.join(', ')}, all`
        ),
      }),
      newObj: {
        countyId: validatorUtils.uuidValidate({
          name: 'County',
          required: false,
        }),
        caregiverId: validatorUtils.uuidValidate({
          name: 'Caregiver',
          required: false,
        }),
        caseManagerProfileId: validatorUtils.uuidValidate({
          name: 'Case manager',
          required: false,
        }),

        // Archive view filter: active (default) hides soft-deleted patients,
        // all returns active + archived, archived returns only soft-deleted.
        archiveFilter: Yup.string()
          .oneOf(
            PATIENT_ARCHIVE_FILTERS_VALUES,
            `Archive filter must be one of: ${PATIENT_ARCHIVE_FILTERS_VALUES.join(', ')}`
          )
          .default(PATIENT_ARCHIVE_FILTERS.ACTIVE.value),

        // Optional response view: when set, only the fields configured for
        // that view in PATIENTS_LIST_API_FIELDS_OPTIONS are returned.
        view: Yup.string().oneOf(
          PATIENTS_LIST_API_VIEWS_VALUES,
          `View must be one of: ${PATIENTS_LIST_API_VIEWS_VALUES.join(', ')}`
        ),

        source: csvArraySchema({
          of: Yup.string().oneOf(
            PATIENT_SOURCES_VALUES,
            `Source must be one of: ${PATIENT_SOURCES_VALUES.join(', ')}`
          ),
        }),
        regionId: csvArraySchema({
          of: Yup.string().uuid('Invalid Region id'),
        }),

        // Care team: patients whose primary or secondary nurse is one of these.
        nurseProfileId: csvArraySchema({
          of: Yup.string().uuid('Invalid Nurse id'),
        }),

        // Risk tier: the severity of the patient's newest flag.
        lastFlag: csvArraySchema({
          of: Yup.string().oneOf(
            ESCALATABLE_FLAGS,
            `Last flag must be one of: ${ESCALATABLE_FLAGS.join(', ')}`
          ),
        }),
      },
    })
  );

  return validatorUtils.validate({schema: querySchema, data});
};
