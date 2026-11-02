const Yup = require('yup');

const {validatorUtils} = require('../utils');

const {
  searchSchema,
  reasonSchema,
  checklistAnswersSchema,
} = require('./commonEntityValidations');
const {commonPaginationSchema} = require('./commonSchema');

const {
  FOLLOW_UP_TASK_FLAG_TYPE_VALUES,
  FOLLOW_UP_TASK_SORT_FIELDS_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TASK_PRIORITY_VALUES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES,
  FOLLOW_UP_TASK_SOURCE_VALUES,
  FOLLOW_UP_TASK_TITLE_MAX_LENGTH,
  FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
  FOLLOW_UP_TASK_CANCEL_REASON_MAX_LENGTH,
} = require('../constants/followUpTasksConstants');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');
const {getCurrentTime} = require('../utils/dateUtils');

const answersSchema = checklistAnswersSchema();

const nullableText = ({fieldName, max}) =>
  Yup.string()
    .trim()
    .max(max, `${fieldName} must not exceed ${max} characters`)
    .nullable()
    .transform((value) => (value === '' ? null : value));

const titleSchema = () =>
  Yup.string()
    .trim()
    .min(1, 'Title is required')
    .max(
      FOLLOW_UP_TASK_TITLE_MAX_LENGTH,
      `Title must not exceed ${FOLLOW_UP_TASK_TITLE_MAX_LENGTH} characters`
    );

const prioritySchema = () =>
  Yup.string()
    .oneOf(
      FOLLOW_UP_TASK_PRIORITY_VALUES,
      `Priority must be one of: ${FOLLOW_UP_TASK_PRIORITY_VALUES.join(', ')}`
    )
    .nullable();

// A due instant (ISO date-time) that is still ahead of now.
const dueAtSchema = () =>
  Yup.date()
    .typeError('Due date must be a valid date-time')
    .test('in-future', 'Due date must be in the future', (value) => {
      if (!value) return true;

      return value > getCurrentTime();
    });

const descriptionSchema = () =>
  nullableText({fieldName: 'Description', max: FOLLOW_UP_TASK_TEXT_MAX_LENGTH});

const optionalUuid = ({name}) =>
  validatorUtils.uuidValidate({name, required: false}).nullable();

// Field rules shared with the resolve-a-flag body, which embeds a task.
module.exports.followUpTaskFieldSchemas = {
  titleSchema,
  descriptionSchema,
  prioritySchema,
  dueAtSchema,
};

module.exports.validateCreateTaskBody = ({data}) => {
  const schema = Yup.object().shape({
    patientId: validatorUtils.uuidValidate({name: 'Patient', required: true}),
    title: titleSchema().required('Title is required'),
    description: descriptionSchema(),
    priority: prioritySchema(),
    dueAt: dueAtSchema().required('Due date is required'),
    assigneeUserOrganizationId: optionalUuid({name: 'Assignee'}),
    checklistTemplateId: optionalUuid({name: 'Checklist Template'}),
    submissionFlagId: optionalUuid({name: 'Alert'}),
    supervisoryVisitId: optionalUuid({name: 'Supervisory visit'}),
    visitInstructions: nullableText({
      fieldName: 'Visit instructions',
      max: FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
    }),
    flagType: Yup.number()
      .integer('Flag type must be an integer')
      .oneOf(FOLLOW_UP_TASK_FLAG_TYPE_VALUES, 'Invalid flag type')
      .nullable(),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateUpdateTaskBody = ({data}) => {
  const schema = Yup.object()
    .shape({
      title: titleSchema(),
      description: descriptionSchema(),
      visitInstructions: nullableText({
        fieldName: 'Visit notes',
        max: FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
      }),
      priority: prioritySchema(),
      dueAt: dueAtSchema(),
      assigneeUserOrganizationId: optionalUuid({name: 'Assignee'}),
      checklistTemplateId: optionalUuid({name: 'Checklist Template'}),
    })
    .test('at-least-one', 'Nothing to update', (value) =>
      Object.values(value || {}).some((field) => field !== undefined)
    );

  return validatorUtils.validate({schema, data});
};

module.exports.validateTaskIdParams = ({data}) => {
  const schema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Follow-Up Task'}),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateCancelTaskBody = ({data}) => {
  const schema = Yup.object().shape({
    reason: reasonSchema({
      max: FOLLOW_UP_TASK_CANCEL_REASON_MAX_LENGTH,
      requiredMessage: 'A cancellation reason is required',
    }),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateCompleteTaskBody = ({data}) => {
  const schema = Yup.object().shape({
    outcome: Yup.string()
      .oneOf(
        FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES,
        `Outcome must be one of: ${FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES.join(', ')}`
      )
      .required('Outcome is required'),
    completionNotes: Yup.string()
      .trim()
      .min(1, 'Completion notes are required')
      .max(
        FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
        `Completion notes must not exceed ${FOLLOW_UP_TASK_TEXT_MAX_LENGTH} characters`
      )
      .required('Completion notes are required'),
    answers: answersSchema,
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateSubmitTaskBody = ({data}) => {
  const schema = Yup.object().shape({
    answers: answersSchema,

    caseManagerReply: Yup.string()
      .trim()
      .max(
        FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
        `Case manager reply must not exceed ${FOLLOW_UP_TASK_TEXT_MAX_LENGTH} characters`
      )
      .nullable(),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateAssigneesQuery = ({data}) => {
  const schema = Yup.object().shape({
    patientId: validatorUtils.uuidValidate({name: 'Patient', required: true}),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateListTasksQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: FOLLOW_UP_TASK_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const schema = paginationBase.shape({
    patientId: Yup.string().uuid('Invalid Patient id'),
    assigneeUserOrganizationId: Yup.string().uuid('Invalid Assignee id'),

    // Comma-separated so a tab can request several statuses at once.
    status: Yup.string().test(
      'valid-statuses',
      `Status must be one of: ${FOLLOW_UP_TASK_STATUS_VALUES.join(', ')}`,
      (value) =>
        !value ||
        value
          .split(',')
          .every((status) =>
            FOLLOW_UP_TASK_STATUS_VALUES.includes(status.trim())
          )
    ),
    priority: Yup.string().oneOf(
      FOLLOW_UP_TASK_PRIORITY_VALUES,
      `Priority must be one of: ${FOLLOW_UP_TASK_PRIORITY_VALUES.join(', ')}`
    ),
    source: Yup.string().oneOf(
      FOLLOW_UP_TASK_SOURCE_VALUES,
      `Source must be one of: ${FOLLOW_UP_TASK_SOURCE_VALUES.join(', ')}`
    ),
    flagType: validatorUtils.nullableEnumNumberValidate({
      name: 'Flag type',
      values: FOLLOW_UP_TASK_FLAG_TYPE_VALUES,
    }),
    dueFrom: Yup.date().typeError('dueFrom must be a valid date'),
    dueTo: Yup.date().typeError('dueTo must be a valid date'),
    search: searchSchema(),
  });

  return validatorUtils.validate({schema, data});
};
