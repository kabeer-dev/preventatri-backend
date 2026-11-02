const Yup = require('yup');

const {validatorUtils, safeConcat} = require('../utils');
const {searchSchema} = require('./commonEntityValidations');
const {commonPaginationSchema} = require('./commonSchema');
const {followUpTaskFieldSchemas} = require('./followUpTasksSchema');
const {supervisoryVisitFieldSchemas} = require('./supervisoryVisitsSchema');

const {
  CHECKLIST_CHOICE_FIELD_TYPES_VALUES,
  CHECKLIST_FIELD_TYPES_VALUES,
  CHECKLIST_OPTION_FLAGS_VALUES,
  CHECKLIST_TEMPLATE_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_STATUS_FILTER_ALL,
  CHECKLIST_TEMPLATE_TARGET_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_TYPES,
  CHECKLIST_TEMPLATE_TYPES_VALUES,
  CHECKLIST_TEMPLATES_SORT_FIELDS_VALUES,
  CHECKLIST_SUBMISSION_STATUSES_VALUES,
  CHECKLIST_SUBMISSIONS_SORT_FIELDS_VALUES,
} = require('../constants/assessmentConstants');

const {
  ESCALATION_RESPONSE_ACTIONS_VALUES,
} = require('../constants/escalationConstants');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {ESCALATABLE_FLAGS} = require('../constants/riskCalcConstants');

// ==========================================
// CHECKLIST TEMPLATE SCHEMAS
// ==========================================

module.exports.validateTemplateIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Checklist Template'}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// Usage stats are opt-in: reusing a template as a starting point skips them.
module.exports.validateGetTemplateQuery = ({data}) => {
  const querySchema = Yup.object().shape({
    includeUsage: Yup.boolean().default(false),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

module.exports.validateListTemplatesQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: CHECKLIST_TEMPLATES_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape({
    status: Yup.string().oneOf(
      safeConcat({
        originalArray: CHECKLIST_TEMPLATE_STATUSES_VALUES,
        newArray: [CHECKLIST_TEMPLATE_STATUS_FILTER_ALL],
      })
    ),
    type: Yup.string().oneOf(CHECKLIST_TEMPLATE_TYPES_VALUES),
    search: searchSchema(),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// Case-insensitive, since answers are matched to options by title.
const hasUniqueTitles = ({items}) => {
  if (!items) return true;

  // Blank titles are reported by the required rule, not as duplicates.
  const titles = items
    .map((item) => item?.title?.trim().toLowerCase())
    .filter(Boolean);

  return new Set(titles).size === titles.length;
};

// Blank item and answer text is allowed on a draft so a new row can be saved.
const titleRequiredOnPublish = ({message, max}) =>
  Yup.string()
    .trim()
    .max(max)
    .default('')
    .when('$publish', {
      is: true,
      then: (schema) => schema.required(message),
    });

// Context: $type is the template type, $publish is set only when a draft is
// published. Drafts may be incomplete, so counts and flags are enforced at publish.
const templateOptionSchema = Yup.object().shape({
  title: titleRequiredOnPublish({
    message: 'Option title is required',
    max: 250,
  }),
  flag: Yup.string()
    .nullable()
    .oneOf(
      safeConcat({
        originalArray: CHECKLIST_OPTION_FLAGS_VALUES,
        newArray: [null],
      })
    )
    .when(['$type', '$publish'], ([type, publish], schema) => {
      if (type && type !== CHECKLIST_TEMPLATE_TYPES.PATIENT.value)
        return schema.strip();

      return publish ? schema.required('Option flag is required') : schema;
    }),
});

const templateQuestionSchema = Yup.object().shape({
  title: titleRequiredOnPublish({
    message: 'Question title is required',
    max: 250,
  }),
  type: Yup.string()
    .oneOf(CHECKLIST_FIELD_TYPES_VALUES)
    .required('Question type is required'),
  required: Yup.boolean().default(false),
  placeholder: Yup.string().trim().max(50).nullable(),
  options: Yup.array()
    .of(templateOptionSchema)
    .transform((value) => value ?? [])
    .default([])
    .when(['type', '$publish'], ([questionType, publish], schema) =>
      publish && CHECKLIST_CHOICE_FIELD_TYPES_VALUES.includes(questionType)
        ? schema
            .min(1, 'Choice questions need at least one option')
            .test(
              'unique-option-titles',
              'Option titles must be unique within a question',
              (options) => hasUniqueTitles({items: options})
            )
        : schema
    ),
});

const templateSectionSchema = Yup.object().shape({
  title: Yup.string().trim().required('Section title is required').max(100),
  questions: Yup.array()
    .of(templateQuestionSchema)
    .default([])
    .when('$publish', {
      is: true,
      then: (schema) =>
        schema.min(1, 'Each section needs at least one question'),
    }),
});

const templateContentSchema = Yup.object().shape({
  title: Yup.string().trim().required('Template title is required'),
  description: Yup.string().trim().nullable(),

  // Unique titles are enforced even on drafts: the database rejects duplicates.
  sections: Yup.array()
    .of(templateSectionSchema)
    .default([])
    .test(
      'unique-section-titles',
      'Section titles must be unique within a checklist',
      (sections) => hasUniqueTitles({items: sections})
    )
    .when('$publish', {
      is: true,
      then: (schema) => schema.min(1, 'A checklist needs at least one section'),
    }),
});

module.exports.validateCreateTemplateBody = ({data}) => {
  const bodySchema = templateContentSchema.shape({
    type: Yup.string()
      .oneOf(CHECKLIST_TEMPLATE_TYPES_VALUES)
      .required('Template type is required'),
  });

  return validatorUtils.validate({
    schema: bodySchema,
    data,
    context: {type: data?.type, publish: false},
  });
};

// No type in the body: flags for non-patient types are dropped when the
// options are built from the stored template's type.
module.exports.validateUpdateTemplateBody = ({data}) =>
  validatorUtils.validate({
    schema: templateContentSchema,
    data,
    context: {publish: false},
  });

// Runs the publish rules against a stored template before it goes ACTIVE.
module.exports.validateTemplateCompleteness = ({template}) =>
  validatorUtils.validate({
    schema: templateContentSchema,
    data: template,
    context: {type: template.type, publish: true},
  });

module.exports.validateUpdateTemplateStatusBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    status: Yup.string()
      .oneOf(CHECKLIST_TEMPLATE_TARGET_STATUSES_VALUES)
      .required('Status is required'),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};

// ==========================================
// CHECKLIST SUBMISSION SCHEMAS
// ==========================================

const answerSchema = Yup.object().shape({
  questionId: validatorUtils.uuidValidate({name: 'Question'}),
  value: Yup.mixed().nullable(),
  comment: Yup.string().trim().max(2000).nullable(),
});

module.exports.validateSubmissionUpdateRequest = ({data}) => {
  const updateSchema = Yup.object().shape({
    answers: Yup.array()
      .of(answerSchema)
      .min(1, 'At least one answer is required')
      .required('Answers are required')
      .test(
        'unique-question-ids',
        'Each question can only be answered once',
        (answers) => {
          if (!answers) return true;
          const questionIds = answers.map((a) => a.questionId);

          return new Set(questionIds).size === questionIds.length;
        }
      ),

    visitNotes: Yup.string().trim().max(5000).nullable(),
  });

  return validatorUtils.validate({schema: updateSchema, data});
};

module.exports.validateAssignedEscalationQuery = ({data}) => {
  const querySchema = Yup.object().shape({
    type: Yup.string()
      .transform((value) => {
        if (typeof value !== 'string') return value;
        const normalized = value.trim().toUpperCase();

        return normalized || undefined;
      })
      .oneOf(
        ESCALATABLE_FLAGS,
        'Invalid flag type. Accepted values are RED or YELLOW.'
      )
      .notRequired(),
    patientId: validatorUtils.uuidValidate({name: 'Patient', required: false}),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

module.exports.validateEscalationIdParams = ({data}) => {
  const paramsSchema = Yup.object().shape({
    escalationId: validatorUtils.uuidValidate({name: 'Escalation'}),
  });

  return validatorUtils.validate({schema: paramsSchema, data});
};

module.exports.validateResolveEscalationBody = ({data}) => {
  const resolveSchema = Yup.object().shape({
    actions: Yup.array()
      .of(Yup.number().oneOf(ESCALATION_RESPONSE_ACTIONS_VALUES))
      .min(1, 'At least one action is required')
      .required('Actions are required')
      .test(
        'unique-actions',
        'Each action can only be selected once',
        (actions) => {
          if (!actions) return true;

          return new Set(actions).size === actions.length;
        }
      ),

    notes: Yup.string().trim().max(5000).required('Notes are required'),

    hasFollowUp: Yup.boolean().default(false),

    // Same rules as creating a task (POST /follow-up-tasks).
    followUpDate: followUpTaskFieldSchemas.dueAtSchema().when('hasFollowUp', {
      is: true,
      then: (schema) => schema.required('Follow-up date is required'),
      otherwise: (schema) => schema.nullable(),
    }),

    followUpDescription: followUpTaskFieldSchemas.descriptionSchema(),

    followUpTitle: followUpTaskFieldSchemas.titleSchema().when('hasFollowUp', {
      is: true,
      then: (schema) => schema.required('Follow-up title is required'),
      otherwise: (schema) => schema.nullable(),
    }),

    followUpPriority: followUpTaskFieldSchemas.prioritySchema(),

    // No default checklist on a flag-created task: only an explicit pick.
    followUpChecklistTemplateId: validatorUtils
      .uuidValidate({name: 'Follow-up checklist template', required: false})
      .nullable(),

    // Defaults to the patient's case manager when omitted.
    followUpAssigneeUserOrganizationId: validatorUtils
      .uuidValidate({name: 'Follow-up assignee', required: false})
      .nullable(),

    hasSupervisoryVisit: Yup.boolean().default(false),

    // Same rules as scheduling a visit (POST /supervisory-visits).
    supervisoryVisitStartAt: supervisoryVisitFieldSchemas
      .scheduledStartAtSchema()
      .when('hasSupervisoryVisit', {
        is: true,
        then: (schema) =>
          schema.required('Supervisory visit start is required'),
        otherwise: (schema) => schema.nullable(),
      }),

    supervisoryVisitEndAt: Yup.date()
      .typeError('Supervisory visit end must be a valid date-time')
      .when('hasSupervisoryVisit', {
        is: true,
        then: (schema) =>
          schema
            .required('Supervisory visit end is required')
            .test(
              'after-start',
              'Supervisory visit end must be after the start',
              function (value) {
                const start = this.parent?.supervisoryVisitStartAt;
                if (!value || !start) return true;

                return value > start;
              }
            ),
        otherwise: (schema) => schema.nullable(),
      }),

    // Defaults to the patient's case manager when omitted.
    supervisoryVisitAssigneeUserOrganizationId: validatorUtils
      .uuidValidate({name: 'Supervisory visit assignee', required: false})
      .nullable(),

    supervisoryVisitCaregiverUserOrganizationIds: supervisoryVisitFieldSchemas
      .caregiverIdsSchema()
      .nullable(),

    supervisoryVisitChecklistTemplateId: validatorUtils
      .uuidValidate({name: 'Supervisory visit checklist', required: false})
      .when('hasSupervisoryVisit', {
        is: true,
        then: (schema) =>
          schema.required('Supervisory visit checklist is required'),
        otherwise: (schema) => schema.nullable(),
      }),

    supervisoryInstructions: Yup.string()
      .trim()
      .max(2000)
      .when('hasSupervisoryVisit', {
        is: true,
        then: (schema) =>
          schema.required('Supervisory visit instructions are required'),
        otherwise: (schema) => schema.nullable(),
      }),
  });

  return validatorUtils.validate({schema: resolveSchema, data});
};

module.exports.validateSubmissionIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Checklist Submission'}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

module.exports.validateSkipSubmissionBody = ({data}) => {
  const skipSchema = Yup.object().shape({
    reason: Yup.string()
      .trim()
      .min(1, 'Skip reason is required')
      .max(1000)
      .required('Skip reason is required'),
  });

  return validatorUtils.validate({schema: skipSchema, data});
};

module.exports.validateVoidSubmissionBody = ({data}) => {
  const voidSchema = Yup.object().shape({
    voidReason: Yup.string()
      .trim()
      .min(1, 'Void reason is required')
      .max(1000)
      .required('Void reason is required'),
  });

  return validatorUtils.validate({schema: voidSchema, data});
};

module.exports.validateListSubmissionsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: CHECKLIST_SUBMISSIONS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape({
    status: Yup.array()
      .transform((value, originalValue) => {
        if (originalValue === undefined || originalValue === null) return [];
        if (Array.isArray(originalValue)) return originalValue;

        return String(originalValue)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      })
      .of(Yup.string().oneOf(CHECKLIST_SUBMISSION_STATUSES_VALUES)),
    patientId: Yup.string().uuid('Invalid Patient id'),
    submittedBy: Yup.string().uuid('Invalid User id'),
    search: searchSchema(),

    // Allow viewing submissions of archived patients (soft-deleted alongside
    // their patient). Sent by the FE only for an archived patient's detail page.
    includeDeleted: Yup.boolean().default(false),
  });

  return validatorUtils.validate({schema: querySchema, data});
};
