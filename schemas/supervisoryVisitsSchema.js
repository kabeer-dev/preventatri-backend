const Yup = require('yup');

const {validatorUtils} = require('../utils');

const {
  searchSchema,
  reasonSchema,
  checklistAnswersSchema,
} = require('./commonEntityValidations');
const {commonPaginationSchema} = require('./commonSchema');
const {followUpTaskFieldSchemas} = require('./followUpTasksSchema');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  SUPERVISORY_VISIT_SORT_FIELDS_VALUES,
  SUPERVISORY_VISIT_STATUS_VALUES,
  SUPERVISORY_VISIT_TYPES,
  SUPERVISORY_VISIT_TYPE_VALUES,
  SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
  SUPERVISORY_VISIT_MAX_CAREGIVERS,
  SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
  SUPERVISORY_VISIT_TYPE_OTHER_MAX_LENGTH,
  SUPERVISORY_VISIT_REVIEW_NOTE_MAX_LENGTH,
} = require('../constants/supervisoryVisitsConstants');

const {SYSTEM_ROLES_VALUES} = require('../constants/usersConstants');

const {
  WORK_ITEM_TEXT_MAX_LENGTH,
  WORK_ITEM_CANCEL_REASON_MAX_LENGTH,
} = require('../constants/workItemConstants');

const {getCurrentTime} = require('../utils/dateUtils');

const nullableText = ({fieldName, max}) =>
  Yup.string()
    .trim()
    .max(max, `${fieldName} must not exceed ${max} characters`)
    .nullable()
    .transform((value) => (value === '' ? null : value));

const optionalUuid = ({name}) =>
  validatorUtils.uuidValidate({name, required: false}).nullable();

const visitTypeSchema = () =>
  Yup.string().oneOf(
    SUPERVISORY_VISIT_TYPE_VALUES,
    `Visit type must be one of: ${SUPERVISORY_VISIT_TYPE_VALUES.join(', ')}`
  );

// Free text is only meaningful (and required) for the OTHER visit type.
const visitTypeOtherSchema = () =>
  nullableText({
    fieldName: 'Visit type description',
    max: SUPERVISORY_VISIT_TYPE_OTHER_MAX_LENGTH,
  }).when('visitType', {
    is: SUPERVISORY_VISIT_TYPES.other.value,
    then: (schema) => schema.required('Please describe the visit type'),
  });

const descriptionSchema = () =>
  nullableText({fieldName: 'Reason for visit', max: WORK_ITEM_TEXT_MAX_LENGTH});

// A start instant (ISO date-time) that is still ahead of now.
const scheduledStartAtSchema = () =>
  Yup.date()
    .typeError('Scheduled start must be a valid date-time')
    .test('in-future', 'Scheduled start must be in the future', (value) => {
      if (!value) return true;

      return value > getCurrentTime();
    });

// Checked against the start in the same body; the controller re-checks
// against the stored start when only one side of the window is edited.
const scheduledEndAtSchema = () =>
  Yup.date()
    .typeError('Scheduled end must be a valid date-time')
    .test(
      'after-start',
      'Scheduled end must be after the scheduled start',
      function (value) {
        const start = this.parent?.scheduledStartAt;
        if (!value || !start) return true;

        return value > start;
      }
    );

const caregiverIdsSchema = () =>
  Yup.array()
    .of(validatorUtils.uuidValidate({name: 'Caregiver'}))
    .max(
      SUPERVISORY_VISIT_MAX_CAREGIVERS,
      `At most ${SUPERVISORY_VISIT_MAX_CAREGIVERS} caregivers can be listed`
    )
    .test(
      'unique-caregivers',
      'Each caregiver can only be listed once',
      (ids) => !ids || new Set(ids).size === ids.length
    );

// A follow-up task queued while filing the visit: the same rules as creating
// one directly, with the assignee always explicit.
const queuedFollowUpSchema = () =>
  Yup.object().shape({
    title: followUpTaskFieldSchemas.titleSchema().required('Title is required'),
    description: followUpTaskFieldSchemas.descriptionSchema(),
    priority: followUpTaskFieldSchemas.prioritySchema(),
    dueAt: followUpTaskFieldSchemas
      .dueAtSchema()
      .required('Due date is required'),
    assigneeUserOrganizationId: validatorUtils.uuidValidate({
      name: 'Assignee',
      required: true,
    }),
    checklistTemplateId: optionalUuid({name: 'Checklist Template'}),
  });

// Field rules shared with the resolve-a-flag body, which embeds a visit.
module.exports.supervisoryVisitFieldSchemas = {
  visitTypeSchema,
  visitTypeOtherSchema,
  descriptionSchema,
  scheduledStartAtSchema,
  scheduledEndAtSchema,
  caregiverIdsSchema,
};

module.exports.validateCreateVisitBody = ({data}) => {
  const schema = Yup.object().shape({
    patientId: validatorUtils.uuidValidate({name: 'Patient', required: true}),
    visitType: visitTypeSchema().required('Visit type is required'),
    visitTypeOther: visitTypeOtherSchema(),
    description: descriptionSchema(),
    assigneeUserOrganizationId: optionalUuid({name: 'Assignee'}),
    checklistTemplateId: validatorUtils.uuidValidate({
      name: 'Checklist Template',
      required: true,
    }),
    scheduledStartAt: scheduledStartAtSchema().required(
      'Scheduled start is required'
    ),
    scheduledEndAt: scheduledEndAtSchema().required(
      'Scheduled end is required'
    ),
    submissionFlagId: optionalUuid({name: 'Alert'}),
    caregiverUserOrganizationIds: caregiverIdsSchema(),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateUpdateVisitBody = ({data}) => {
  const schema = Yup.object()
    .shape({
      visitType: visitTypeSchema(),
      visitTypeOther: visitTypeOtherSchema(),
      description: descriptionSchema(),
      assigneeUserOrganizationId: optionalUuid({name: 'Assignee'}),
      checklistTemplateId: optionalUuid({name: 'Checklist Template'}),
      scheduledStartAt: scheduledStartAtSchema(),
      scheduledEndAt: scheduledEndAtSchema(),
      caregiverUserOrganizationIds: caregiverIdsSchema(),
    })
    .test('at-least-one', 'Nothing to update', (value) =>
      Object.values(value || {}).some((field) => field !== undefined)
    );

  return validatorUtils.validate({schema, data});
};

module.exports.validateVisitIdParams = ({data}) => {
  const schema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Supervisory Visit'}),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateCancelVisitBody = ({data}) => {
  const schema = Yup.object().shape({
    reason: reasonSchema({
      max: WORK_ITEM_CANCEL_REASON_MAX_LENGTH,
      requiredMessage: 'A cancellation reason is required',
    }),
  });

  return validatorUtils.validate({schema, data});
};

// Filing: outcome + findings + the checklist answers, plus any follow-up
// tasks the assignee queued while documenting the visit.
module.exports.validateCompleteVisitBody = ({data}) => {
  const schema = Yup.object().shape({
    outcome: Yup.string()
      .oneOf(
        SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
        `Outcome must be one of: ${SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES.join(', ')}`
      )
      .required('Outcome is required'),
    completionNotes: Yup.string()
      .trim()
      .min(1, 'Findings are required')
      .max(
        WORK_ITEM_TEXT_MAX_LENGTH,
        `Findings must not exceed ${WORK_ITEM_TEXT_MAX_LENGTH} characters`
      )
      .required('Findings are required'),
    answers: checklistAnswersSchema()
      .min(1, 'At least one answer is required')
      .required('Answers are required'),
    followUps: Yup.array()
      .of(queuedFollowUpSchema())
      .max(
        SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
        `At most ${SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS} follow-up tasks can be queued`
      )
      .nullable(),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateApproveVisitBody = ({data}) => {
  const schema = Yup.object().shape({
    note: nullableText({
      fieldName: 'Review note',
      max: SUPERVISORY_VISIT_REVIEW_NOTE_MAX_LENGTH,
    }),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateRequestCorrectionBody = ({data}) => {
  const schema = Yup.object().shape({
    reason: reasonSchema({
      max: SUPERVISORY_VISIT_REVIEW_NOTE_MAX_LENGTH,
      requiredMessage: 'Please say what needs to be corrected',
    }),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateAssigneesQuery = ({data}) => {
  const schema = Yup.object().shape({
    patientId: validatorUtils.uuidValidate({name: 'Patient', required: true}),

    // Comma-separated system roles to narrow the care team to.
    roles: Yup.string().test(
      'valid-roles',
      `Roles must be one of: ${SYSTEM_ROLES_VALUES.join(', ')}`,
      (value) =>
        !value ||
        value
          .split(',')
          .every((role) => SYSTEM_ROLES_VALUES.includes(role.trim()))
    ),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateListVisitsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: SUPERVISORY_VISIT_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const schema = paginationBase.shape({
    patientId: Yup.string().uuid('Invalid Patient id'),
    assigneeUserId: Yup.string().uuid('Invalid Assignee user id'),
    assigneeUserOrganizationId: Yup.string().uuid('Invalid Assignee id'),
    regionId: Yup.string().uuid('Invalid Region id'),

    // Comma-separated so a tab can request several statuses at once.
    status: Yup.string().test(
      'valid-statuses',
      `Status must be one of: ${SUPERVISORY_VISIT_STATUS_VALUES.join(', ')}`,
      (value) =>
        !value ||
        value
          .split(',')
          .every((status) =>
            SUPERVISORY_VISIT_STATUS_VALUES.includes(status.trim())
          )
    ),
    visitType: visitTypeSchema(),
    scheduledFrom: Yup.date().typeError('scheduledFrom must be a valid date'),
    scheduledTo: Yup.date().typeError('scheduledTo must be a valid date'),
    search: searchSchema(),
  });

  return validatorUtils.validate({schema, data});
};
