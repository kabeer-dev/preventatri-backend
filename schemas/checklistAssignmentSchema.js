const Yup = require('yup');

const {validatorUtils} = require('../utils');
const {commonPaginationSchema} = require('./commonSchema');

const {
  CHECKLIST_ASSIGNMENT_TYPES_VALUES,
  CHECKLIST_ASSIGNMENTS_SORT_FIELDS_VALUES,
} = require('../constants/checklistAssignmentConstants');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');
const {toDateOnlyUTC, todayUTC} = require('../utils/dateUtils');

module.exports.validateAssignmentCreateRequest = ({data}) => {
  const assignmentSchema = Yup.object().shape({
    checklistTemplateId: validatorUtils.uuidValidate({
      name: 'Checklist Template',
    }),

    patientId: validatorUtils.uuidValidate({name: 'Patient'}),

    caregiverProfileId: validatorUtils.uuidValidate({
      name: 'Caregiver Profile',
    }),

    startDate: Yup.date()
      .required('Start date is required')
      .typeError('Start date must be a valid date')
      .transform((value, originalValue) => {
        if (!originalValue) return value;

        return toDateOnlyUTC({date: originalValue});
      })
      .test('not-in-past', 'Start date cannot be in the past', (value) => {
        if (!value) return true;

        return value >= todayUTC().toJSDate();
      }),

    endDate: Yup.date()
      .required('End date is required')
      .typeError('End date must be a valid date')
      .transform((value, originalValue) => {
        if (!originalValue) return value;

        return toDateOnlyUTC({date: originalValue});
      })
      .min(Yup.ref('startDate'), 'End date must be after start date'),

    type: Yup.string()
      .oneOf(CHECKLIST_ASSIGNMENT_TYPES_VALUES, 'Invalid assignment type')
      .required('Assignment type is required'),

    notes: Yup.string().trim().max(5000).nullable(),
  });

  const createSchema = Yup.object().shape({
    assignments: Yup.array()
      .of(assignmentSchema)
      .min(1, 'At least one assignment is required')
      .required('Assignments array is required')
      .test(
        'no-duplicate-assignments',
        'Assignments for the same patient, caregiver, and checklist cannot have overlapping dates',
        (assignments) => {
          if (!assignments || assignments.length < 2) return true;

          for (let i = 0; i < assignments.length; i++) {
            for (let j = i + 1; j < assignments.length; j++) {
              const a = assignments[i];
              const b = assignments[j];

              const sameKey =
                a.checklistTemplateId === b.checklistTemplateId &&
                a.patientId === b.patientId &&
                a.caregiverProfileId === b.caregiverProfileId;

              if (!sameKey) continue;

              // Check for overlapping date ranges (a.start <= b.end && a.end >= b.start)
              const datesOverlap =
                a.startDate <= b.endDate && a.endDate >= b.startDate;

              if (datesOverlap) return false;
            }
          }

          return true;
        }
      ),
  });

  return validatorUtils.validate({schema: createSchema, data});
};

module.exports.validateAssignmentIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Checklist Assignment'}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

module.exports.validateDashboardQuery = ({data}) => {
  const dashboardSchema = Yup.object().shape({
    patientId: Yup.string().uuid('Invalid Patient id'),
    caregiverProfileId: Yup.string().uuid('Invalid Caregiver Profile id'),
  });

  return validatorUtils.validate({schema: dashboardSchema, data});
};

module.exports.validateListAssignmentsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: CHECKLIST_ASSIGNMENTS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape({
    patientId: Yup.string().uuid('Invalid Patient id'),
    caregiverProfileId: Yup.string().uuid('Invalid Caregiver Profile id'),
    checklistTemplateId: Yup.string().uuid('Invalid Checklist Template id'),
  });

  return validatorUtils.validate({schema: querySchema, data});
};
