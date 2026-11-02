const {
  ALLOWED_TASK_EVIDENCE_TYPES,
  MAX_TASK_EVIDENCE_FILES,
} = require('../../constants/file');

const {
  FOLLOW_UP_TASK_PRIORITY_VALUES,
} = require('../../constants/followUpTasksConstants');

const {
  SUPERVISORY_VISIT_STATUS_VALUES,
  SUPERVISORY_VISIT_TYPE_VALUES,
  SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
  SUPERVISORY_VISIT_COMPLETION_SOURCE_VALUES,
  SUPERVISORY_VISIT_SORT_FIELDS_VALUES,
  SUPERVISORY_VISIT_EVENT_TYPES,
  SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
  SUPERVISORY_VISIT_MAX_CAREGIVERS,
  SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
} = require('../../constants/supervisoryVisitsConstants');

const {SYSTEM_ROLES_VALUES} = require('../../constants/usersConstants');

const {
  WORK_ITEM_CARE_TEAM_ROLES,
  WORK_ITEM_DEFAULT_TIME_ZONE,
  WORK_ITEM_REMINDER_OFFSETS_MINUTES,
} = require('../../constants/workItemConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// ==========================================
// REUSABLE SCHEMAS
// ==========================================

const TAGS = ['Supervisory Visits'];

const eventTypeValues = Object.values(SUPERVISORY_VISIT_EVENT_TYPES).map(
  (e) => e.value
);

const careTeamRoleValues = Object.values(WORK_ITEM_CARE_TEAM_ROLES).map(
  (r) => r.value
);

const uuid = ({description, example}) => ({
  type: 'string',
  format: 'uuid',
  description,
  example,
});

const dateTime = ({description, example = '2026-08-21T13:00:00.000Z'}) => ({
  type: 'string',
  format: 'date-time',
  description,
  example,
});

const personSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: uuid({}),
    firstName: {type: 'string', nullable: true},
    lastName: {type: 'string', nullable: true},
    email: {type: 'string', nullable: true},
  },
};

const assigneeSchema = {
  type: 'object',
  nullable: true,
  description: 'A UserOrganization: who holds (or held) the visit',
  properties: {
    userOrgId: uuid({}),
    role: {type: 'string', enum: SYSTEM_ROLES_VALUES},
    user: personSchema,
  },
};

const careTeamMemberSchema = {
  type: 'object',
  properties: {
    userOrgId: uuid({description: 'Pass this as assigneeUserOrganizationId'}),
    userId: uuid({}),
    role: {type: 'string', enum: SYSTEM_ROLES_VALUES},
    careTeamRole: {
      type: 'string',
      enum: careTeamRoleValues,
      description: 'Why this person is on the care team',
    },
    firstName: {type: 'string', nullable: true},
    lastName: {type: 'string', nullable: true},
    email: {type: 'string', nullable: true},
  },
};

const patientSchema = {
  type: 'object',
  description: 'Basic patient info returned on the visit',
  properties: {
    id: uuid({}),
    firstName: {type: 'string', example: 'John'},
    lastName: {type: 'string', example: 'Smith'},
    email: {type: 'string', nullable: true},
    phoneNo: {type: 'string', nullable: true},
    address: {type: 'string', nullable: true},
    dateOfBirth: {type: 'string', format: 'date', nullable: true},
    gender: {type: 'string', nullable: true},
  },
};

const sourceSchema = {
  type: 'object',
  description:
    'ALERT when the visit was created by resolving a flag, else STANDALONE',
  properties: {
    type: {type: 'string', enum: ['ALERT', 'STANDALONE']},
    alert: {
      type: 'object',
      nullable: true,
      properties: {
        id: uuid({}),
        flag: {type: 'string', example: 'RED'},
        category: {type: 'string', nullable: true},
        reason: {type: 'string', nullable: true},
        description: {type: 'string', nullable: true},
        status: {type: 'string'},
        createdAt: dateTime({}),
      },
    },
  },
};

const fileSchema = {
  type: 'object',
  properties: {
    url: {type: 'string'},
    key: {type: 'string'},
    mimeType: {type: 'string'},
    originalName: {type: 'string'},
  },
};

const eventSchema = {
  type: 'object',
  description: 'One history entry; SYSTEM rows come from the sweeps',
  properties: {
    id: uuid({}),
    type: {type: 'string', enum: eventTypeValues},
    typeMeta: {
      type: 'object',
      nullable: true,
      properties: {value: {type: 'string'}, label: {type: 'string'}},
    },
    actorType: {type: 'string', enum: ['USER', 'SYSTEM']},
    actor: personSchema,
    fromStatus: {type: 'string', nullable: true},
    toStatus: {type: 'string', nullable: true},
    fromAssignee: assigneeSchema,
    toAssignee: assigneeSchema,
    payload: {type: 'object', additionalProperties: true},
    createdAt: dateTime({}),
  },
};

const linkedTaskSchema = {
  type: 'object',
  description: 'A follow-up task spawned from this visit',
  properties: {
    id: uuid({}),
    title: {type: 'string'},
    status: {type: 'string'},
    priority: {type: 'string', enum: FOLLOW_UP_TASK_PRIORITY_VALUES},
    dueAt: dateTime({}),
    assignee: assigneeSchema,
  },
};

const metaSchema = {
  type: 'object',
  nullable: true,
  properties: {value: {type: 'string'}, label: {type: 'string'}},
};

const visitResponseSchema = {
  type: 'object',
  properties: {
    id: uuid({}),
    organizationId: uuid({}),
    patientId: uuid({}),
    patient: patientSchema,
    visitType: {type: 'string', enum: SUPERVISORY_VISIT_TYPE_VALUES},
    visitTypeMeta: metaSchema,
    visitTypeOther: {
      type: 'string',
      nullable: true,
      description: 'Free text when visitType is OTHER',
    },
    description: {type: 'string', nullable: true},
    status: {type: 'string', enum: SUPERVISORY_VISIT_STATUS_VALUES},
    statusMeta: metaSchema,
    isOverdue: {
      type: 'boolean',
      description: 'OVERDUE, or still open past scheduledEndAt',
    },
    scheduledStartAt: dateTime({
      description: `Start instant (UTC); shown in ${WORK_ITEM_DEFAULT_TIME_ZONE}`,
    }),
    scheduledEndAt: dateTime({description: 'End instant (UTC)'}),
    scheduleDeltaMinutes: {
      type: 'integer',
      nullable: true,
      description:
        'Minutes past scheduledEndAt (positive = late); null when closed',
    },
    sentReminderOffsets: {
      type: 'array',
      items: {type: 'integer'},
      description: `Reminders already sent, in minutes before scheduledStartAt (policy is fixed: ${WORK_ITEM_REMINDER_OFFSETS_MINUTES.join(', ')})`,
    },
    assigneeUserOrganizationId: uuid({}),
    assignee: assigneeSchema,
    originalAssignee: Object.assign({}, assigneeSchema, {
      description:
        'Who the nightly sweep took the visit from (details only; null when never escalated)',
    }),
    caregivers: {
      type: 'array',
      items: assigneeSchema,
      description: 'Caregivers present (details only)',
    },
    caregiversCount: {type: 'integer', nullable: true},
    source: sourceSchema,
    checklistTemplateId: uuid({}),
    checklistTemplate: {
      type: 'object',
      nullable: true,
      description: 'Template with sections and questions (details only)',
    },
    answers: {
      type: 'array',
      nullable: true,
      description: 'Filed checklist answers (details only)',
      items: {type: 'object', additionalProperties: true},
    },
    completionOutcome: {
      type: 'string',
      nullable: true,
      enum: SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
    },
    completionOutcomeMeta: metaSchema,
    completionNotes: {
      type: 'string',
      nullable: true,
      description: 'The filer’s findings',
    },
    completionFiles: {type: 'array', items: fileSchema},
    completionSource: {
      type: 'string',
      nullable: true,
      enum: SUPERVISORY_VISIT_COMPLETION_SOURCE_VALUES,
    },
    overdueAt: dateTime({description: 'When the sweep marked it overdue'}),
    completedAt: dateTime({description: 'When the visit was filed'}),
    completedBy: uuid({}),
    completedByUser: personSchema,
    reviewedAt: dateTime({description: 'When the visit was approved'}),
    reviewedBy: uuid({}),
    reviewedByUser: personSchema,
    reviewNote: {type: 'string', nullable: true},
    cancelReason: {type: 'string', nullable: true},
    cancelledAt: dateTime({}),
    cancelledBy: uuid({}),
    cancelledByUser: personSchema,
    followUpTasks: {
      type: 'array',
      items: linkedTaskSchema,
      description: 'Follow-up tasks spawned from this visit (details only)',
    },
    createdBy: uuid({}),
    createdByUser: personSchema,
    events: {
      type: 'array',
      items: eventSchema,
      description: 'History, newest first (details only)',
    },
    createdAt: dateTime({}),
    updatedAt: dateTime({}),
  },
};

const paginationMeta = {
  type: 'object',
  properties: {
    page: {type: 'integer', example: 1},
    limit: {type: 'integer', example: 25},
    count: {type: 'integer', example: 42},
    totalPages: {type: 'integer', example: 2},
  },
};

const visitBody = ({description}) => ({
  description,
  type: 'object',
  properties: {visit: visitResponseSchema},
});

const idParam = createIdPathParam({
  name: 'id',
  description: 'Supervisory Visit ID',
});

const commonErrors = {
  401: {description: 'Unauthorized — Invalid or missing token'},
  403: {
    description:
      'Forbidden — Role lacks the permission, or the caller is not allowed to act on this visit',
  },
  404: {description: 'Not Found — Visit does not exist or is out of scope'},
};

const visitFields = {
  visitType: {
    type: 'string',
    enum: SUPERVISORY_VISIT_TYPE_VALUES,
    description: 'ROUTINE, TRIGGERED (by an alert) or OTHER',
  },
  visitTypeOther: {
    type: 'string',
    nullable: true,
    description: 'Required when visitType is OTHER (max 200 chars)',
  },
  description: {
    type: 'string',
    nullable: true,
    description: 'Reason for the visit (max 5000 chars)',
  },
  assigneeUserOrganizationId: {
    type: 'string',
    format: 'uuid',
    description: `userOrgId from GET /supervisory-visits/assignees with role in ${SUPERVISORY_VISIT_ASSIGNABLE_ROLES.join(', ')}. Nurses and case managers default to themselves; admins must choose.`,
  },
  checklistTemplateId: {
    type: 'string',
    format: 'uuid',
    description: 'Required ACTIVE template of type SUPERVISORY_VISIT',
  },
  scheduledStartAt: {
    type: 'string',
    format: 'date-time',
    description: 'Start instant (ISO 8601, must be in the future)',
    example: '2026-08-21T13:00:00.000Z',
  },
  scheduledEndAt: {
    type: 'string',
    format: 'date-time',
    description: 'End instant (ISO 8601, after the start)',
    example: '2026-08-21T14:00:00.000Z',
  },
  caregiverUserOrganizationIds: {
    type: 'array',
    items: {type: 'string', format: 'uuid'},
    description: `Caregivers present: userOrgIds with role caregiver from GET /supervisory-visits/assignees (max ${SUPERVISORY_VISIT_MAX_CAREGIVERS})`,
  },
};

const queuedFollowUpSchema = {
  type: 'object',
  description: 'A follow-up task to create when the visit is filed',
  properties: {
    title: {type: 'string', example: 'Caregiver training · fluid logging'},
    description: {type: 'string', nullable: true},
    priority: {type: 'string', enum: FOLLOW_UP_TASK_PRIORITY_VALUES},
    dueAt: dateTime({description: 'Must be in the future'}),
    assigneeUserOrganizationId: uuid({
      description: 'A member of the patient’s care team',
    }),
    checklistTemplateId: uuid({
      description: 'Optional ACTIVE template of type FOLLOW_UP',
    }),
  },
  required: ['title', 'dueAt', 'assigneeUserOrganizationId'],
};

// ==========================================
// DOCS EXPORT
// ==========================================

module.exports = {
  '/api/v1/supervisory-visits/assignees': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'List who a visit for a patient can involve',
      description:
        'The patient’s care team: primary/secondary nurse, the region’s default nurses, the case manager, caregivers linked to the patient and every org admin. Nurses, admins and case managers can be the assigned nurse; caregivers can be listed as present. `roles` narrows the list.',
      parameters: [
        {
          in: 'query',
          name: 'patientId',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
        {
          in: 'query',
          name: 'roles',
          schema: {type: 'string'},
          description: `Comma-separated subset of: ${SYSTEM_ROLES_VALUES.join(', ')}`,
          example: 'nurse,admin,case_manager',
        },
      ],
      responses: {
        200: {
          description: 'Care team retrieved',
          message: {description: 'Success message'},
          body: {
            type: 'object',
            properties: {
              assignees: {type: 'array', items: careTeamMemberSchema},
            },
          },
        },
        400: {description: 'Bad Request — patientId missing or unknown'},
        401: commonErrors[401],
        403: commonErrors[403],
      },
    }),
  },

  '/api/v1/supervisory-visits': {
    post: createSwaggerDocs({
      tags: TAGS,
      summary: 'Schedule a supervisory visit',
      description:
        'Schedules a visit for a patient with one assigned nurse (nurse, admin or case manager) and any caregivers present. The assignee and caregivers are notified. A CREATED event is written to the visit history. Duplicate = same patient, assignee and start while open.',
      requestBody: {
        fields: Object.assign(
          {
            patientId: {
              type: 'string',
              format: 'uuid',
              description: 'Patient this visit is for',
            },
            submissionFlagId: {
              type: 'string',
              format: 'uuid',
              nullable: true,
              description: 'Alert (SubmissionFlag) this visit is linked to',
            },
          },
          visitFields
        ),
        required: [
          'patientId',
          'visitType',
          'checklistTemplateId',
          'scheduledStartAt',
          'scheduledEndAt',
        ],
      },
      responses: {
        201: {
          description: 'Supervisory visit scheduled successfully',
          message: {description: 'Success message'},
          body: visitBody({description: 'Created visit with details'}),
        },
        400: {
          description:
            'Bad Request — validation error, unknown patient / linked alert, missing assignee for an admin, or inactive template',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: {
          description:
            'Not Found — template not found or not SUPERVISORY_VISIT',
        },
        409: {description: 'Conflict — duplicate open visit'},
        422: {
          description:
            'Unprocessable Entity — assignee or a caregiver is not on the patient’s care team',
        },
      },
    }),

    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'List supervisory visits',
      description:
        'Paginated list scoped by role: admins see the organization; case managers their own, created, and caseload visits; nurses their own and created; caregivers only visits they are listed on. List rows omit answers.',
      parameters: [
        {in: 'query', name: 'page', schema: {type: 'integer'}, example: 1},
        {in: 'query', name: 'limit', schema: {type: 'integer'}, example: 25},
        {
          in: 'query',
          name: 'sortBy',
          schema: {type: 'string', enum: SUPERVISORY_VISIT_SORT_FIELDS_VALUES},
          description: 'Default: scheduledStartAt',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Default: asc',
        },
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string'},
          description: `Comma-separated subset of: ${SUPERVISORY_VISIT_STATUS_VALUES.join(', ')}`,
          example: 'SCHEDULED,OVERDUE',
        },
        {
          in: 'query',
          name: 'visitType',
          schema: {type: 'string', enum: SUPERVISORY_VISIT_TYPE_VALUES},
        },
        {
          in: 'query',
          name: 'assigneeUserId',
          schema: {type: 'string', format: 'uuid'},
          description: 'The assigned nurse’s user id',
        },
        {
          in: 'query',
          name: 'assigneeUserOrganizationId',
          schema: {type: 'string', format: 'uuid'},
        },
        {
          in: 'query',
          name: 'patientId',
          schema: {type: 'string', format: 'uuid'},
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Patient’s county region',
        },
        {
          in: 'query',
          name: 'scheduledFrom',
          schema: {type: 'string', format: 'date-time'},
        },
        {
          in: 'query',
          name: 'scheduledTo',
          schema: {type: 'string', format: 'date-time'},
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string'},
          description: 'Patient name or assignee name',
        },
      ],
      responses: {
        200: {
          description: 'Supervisory visits retrieved successfully',
          message: {description: 'Success message'},
          body: {
            type: 'object',
            properties: {
              visits: {type: 'array', items: visitResponseSchema},
              meta: paginationMeta,
            },
          },
        },
        401: commonErrors[401],
        403: commonErrors[403],
      },
    }),
  },

  '/api/v1/supervisory-visits/{id}': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Get a supervisory visit',
      description:
        'Full details: template with sections/questions, filed answers, evidence, caregivers present, linked alert, follow-up tasks spawned from it, and the history (events, newest first).',
      parameters: [idParam],
      responses: {
        200: {
          description: 'Supervisory visit retrieved successfully',
          message: {description: 'Success message'},
          body: visitBody({description: 'Visit details'}),
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
      },
    }),

    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Edit a supervisory visit',
      description:
        'Open visits only; admins, the creator, or a case manager — but once the visit is assigned to an admin (escalated or by hand) only admins may edit it. Changing the assignee writes a REASSIGNED event and notifies both people; other changes write EDITED. A new window resets the reminder policy and, on an OVERDUE visit, returns it to SCHEDULED. Newly listed caregivers are notified.',
      parameters: [idParam],
      requestBody: {fields: visitFields, required: []},
      responses: {
        200: {
          description: 'Supervisory visit updated successfully',
          message: {description: 'Success message'},
          body: visitBody({description: 'Updated visit'}),
        },
        400: {
          description: 'Bad Request — validation error or nothing to update',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — visit is not open'},
        422: {
          description:
            'Unprocessable Entity — assignee / caregiver not on the care team, or the window ends before it starts',
        },
      },
    }),
  },

  '/api/v1/supervisory-visits/{id}/cancel': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Cancel a supervisory visit',
      description:
        'SCHEDULED / OVERDUE / UNDER_REVIEW → CANCELLED with a reason. Admins, the creator, or a case manager; a visit assigned to an admin can only be cancelled by an admin. Assignee, creator and caregivers are notified.',
      parameters: [idParam],
      requestBody: {
        fields: {
          reason: {type: 'string', description: 'Why (1–2000 chars)'},
        },
        required: ['reason'],
      },
      responses: {
        200: {
          description: 'Supervisory visit cancelled',
          message: {description: 'Success message'},
          body: visitBody({description: 'Cancelled visit'}),
        },
        400: {description: 'Bad Request — reason missing'},
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — visit is already approved or cancelled'},
      },
    }),
  },

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // '/api/v1/supervisory-visits/{id}/reopen': {
  //   patch: createSwaggerDocs({
  //     tags: TAGS,
  //     summary: 'Reopen an approved or cancelled visit',
  //     description:
  //       'APPROVED / CANCELLED → SCHEDULED (OVERDUE if the window already passed). Admins, or a case manager unless the visit is assigned to an admin. Outcome, findings, review and cancellation are cleared; the previous values are kept on the REOPENED event. Evidence files stay attached.',
  //     parameters: [idParam],
  //     responses: {
  //       200: {
  //         description: 'Supervisory visit reopened',
  //         message: {description: 'Success message'},
  //         body: visitBody({description: 'Reopened visit'}),
  //       },
  //       401: commonErrors[401],
  //       403: commonErrors[403],
  //       404: commonErrors[404],
  //       409: {description: 'Conflict — visit is not approved or cancelled'},
  //     },
  //   }),
  // },

  '/api/v1/supervisory-visits/{id}/complete': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'File a supervisory visit for review',
      description: `Multipart. Current assignee only (an admin files a visit once it is escalated or reassigned to them). Sends the \`answers\` JSON array, validated against the visit’s template, with photos as images_<questionId>; an outcome; the findings; up to ${MAX_TASK_EVIDENCE_FILES} evidence files under the \`files\` field (${ALLOWED_TASK_EVIDENCE_TYPES.join(', ')}); and optionally a \`followUps\` JSON array (max ${SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS}) of follow-up tasks to create atomically with the filing. SCHEDULED / OVERDUE → UNDER_REVIEW. Reviewers (admins and the patient’s case manager) and the creator are notified; each queued task’s assignee gets the usual assignment notice.`,
      parameters: [idParam],
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          outcome: {
            type: 'string',
            enum: SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
            example: 'CONCERNS_NOTED',
          },
          completionNotes: {
            type: 'string',
            description: 'Findings (1–5000 chars)',
          },
          answers: {
            type: 'string',
            description: 'JSON-encoded answers array (required)',
          },
          followUps: {
            type: 'string',
            description: `JSON-encoded array of ${JSON.stringify(Object.keys(queuedFollowUpSchema.properties))}`,
          },
          files: {
            type: 'string',
            format: 'binary',
            description: 'Optional evidence files (repeat the field)',
          },
        },
        required: ['outcome', 'completionNotes', 'answers'],
      },
      responses: {
        200: {
          description: 'Supervisory visit filed for review',
          message: {description: 'Success message'},
          body: visitBody({description: 'Filed visit with evidence'}),
        },
        400: {
          description:
            'Bad Request — outcome, findings, answers or queued follow-ups invalid',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — visit is not open'},
        413: {description: 'Payload Too Large — a file exceeds the size limit'},
        415: {description: 'Unsupported Media Type — file type not allowed'},
        422: {
          description:
            'Unprocessable Entity — required checklist questions unanswered, an answer value is invalid, too many evidence files or queued follow-ups, or a queued assignee is not on the care team',
        },
      },
    }),
  },

  '/api/v1/supervisory-visits/{id}/approve': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Approve a filed visit',
      description:
        'UNDER_REVIEW → APPROVED with an optional note. Admins and case managers, never the person who filed the visit. The filer, the creator and (if escalated) the original assignee are notified.',
      parameters: [idParam],
      requestBody: {
        fields: {
          note: {
            type: 'string',
            nullable: true,
            description: 'Optional review note (max 2000 chars)',
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Supervisory visit approved',
          message: {description: 'Success message'},
          body: visitBody({description: 'Approved visit'}),
        },
        401: commonErrors[401],
        403: {
          description:
            'Forbidden — Role lacks the permission, or the caller filed this visit',
        },
        404: commonErrors[404],
        409: {description: 'Conflict — visit is not under review'},
      },
    }),
  },

  '/api/v1/supervisory-visits/{id}/request-correction': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Send a filed visit back for correction',
      description:
        'UNDER_REVIEW → SCHEDULED (OVERDUE if the window already passed) with a reason. Admins and case managers, never the person who filed the visit. The answers, findings and evidence are kept so the assignee corrects rather than restarts. The assignee is notified.',
      parameters: [idParam],
      requestBody: {
        fields: {
          reason: {
            type: 'string',
            description: 'What needs to change (1–2000 chars)',
          },
        },
        required: ['reason'],
      },
      responses: {
        200: {
          description: 'Supervisory visit sent back for correction',
          message: {description: 'Success message'},
          body: visitBody({description: 'Visit back with its assignee'}),
        },
        400: {description: 'Bad Request — reason missing'},
        401: commonErrors[401],
        403: {
          description:
            'Forbidden — Role lacks the permission, or the caller filed this visit',
        },
        404: commonErrors[404],
        409: {description: 'Conflict — visit is not under review'},
      },
    }),
  },
};
