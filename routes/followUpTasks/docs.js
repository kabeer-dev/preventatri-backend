const {
  ALLOWED_TASK_EVIDENCE_TYPES,
  MAX_TASK_EVIDENCE_FILES,
} = require('../../constants/file');

const {
  FOLLOW_UP_TASK_FLAG_TYPE_VALUES,
  FOLLOW_UP_TASK_FLAG_TYPES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TASK_PRIORITY_VALUES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES,
  FOLLOW_UP_TASK_COMPLETION_SOURCE_VALUES,
  FOLLOW_UP_TASK_SOURCE_VALUES,
  FOLLOW_UP_TASK_SORT_FIELDS_VALUES,
  FOLLOW_UP_TASK_EVENT_TYPES,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES,
  FOLLOW_UP_TASK_DEFAULT_TIME_ZONE,
  FOLLOW_UP_TASK_REMINDER_OFFSETS_MINUTES,
} = require('../../constants/followUpTasksConstants');

const {SYSTEM_ROLES_VALUES} = require('../../constants/usersConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// ==========================================
// REUSABLE SCHEMAS
// ==========================================

const TAGS = ['Follow-Up Tasks'];

const flagTypeDescription = Object.values(FOLLOW_UP_TASK_FLAG_TYPES)
  .map((f) => `${f.value} = ${f.label}`)
  .join(', ');

const eventTypeValues = Object.values(FOLLOW_UP_TASK_EVENT_TYPES).map(
  (e) => e.value
);

const careTeamRoleValues = Object.values(FOLLOW_UP_TASK_CARE_TEAM_ROLES).map(
  (r) => r.value
);

const uuid = ({description, example}) => ({
  type: 'string',
  format: 'uuid',
  description,
  example,
});

const dateTime = ({description, example = '2026-08-21T21:00:00.000Z'}) => ({
  type: 'string',
  format: 'date-time',
  description,
  example,
});

const personSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: uuid({description: 'User id'}),
    firstName: {type: 'string', nullable: true, example: 'Alice'},
    lastName: {type: 'string', nullable: true, example: 'Reyes'},
    email: {type: 'string', nullable: true, example: 'alice@example.com'},
  },
};

const assigneeSchema = {
  type: 'object',
  nullable: true,
  description: 'A care-team member (organization membership + identity)',
  properties: {
    userOrgId: uuid({description: 'UserOrganization id (the assignee key)'}),
    role: {type: 'string', enum: SYSTEM_ROLES_VALUES, example: 'nurse'},
    user: personSchema,
  },
};

const careTeamMemberSchema = {
  type: 'object',
  properties: {
    userOrgId: uuid({description: 'Use as assigneeUserOrganizationId'}),
    userId: uuid({description: 'User id'}),
    role: {type: 'string', enum: SYSTEM_ROLES_VALUES, example: 'nurse'},
    careTeamRole: {
      type: 'string',
      enum: careTeamRoleValues,
      description: 'Why this person is on the patient’s care team',
      example: 'PATIENT_PRIMARY_NURSE',
    },
    firstName: {type: 'string', nullable: true},
    lastName: {type: 'string', nullable: true},
    email: {type: 'string', nullable: true},
  },
};

const patientSchema = {
  type: 'object',
  description: 'Basic patient info returned on the task',
  properties: {
    id: uuid({description: 'Patient id'}),
    firstName: {type: 'string', example: 'Dorothy'},
    lastName: {type: 'string', example: 'Kline'},
    email: {type: 'string', nullable: true},
    phoneNo: {type: 'string', nullable: true},
    dateOfBirth: {type: 'string', format: 'date-time', nullable: true},
    gender: {type: 'string', nullable: true},
    county: {
      type: 'object',
      nullable: true,
      properties: {id: {type: 'string'}, name: {type: 'string'}},
    },
  },
};

const sourceSchema = {
  type: 'object',
  description:
    'Where the task came from: a supervisory visit, an alert (flag resolution) or standalone. A visit raised by an alert also carries that alert.',
  properties: {
    type: {type: 'string', enum: FOLLOW_UP_TASK_SOURCE_VALUES},
    alert: {
      type: 'object',
      nullable: true,
      properties: {
        id: uuid({description: 'SubmissionFlag id'}),
        flag: {type: 'string', example: 'RED'},
        category: {type: 'string'},
        reason: {type: 'integer'},
        description: {type: 'string'},
        status: {type: 'string'},
        createdAt: dateTime({description: 'When the flag was raised'}),
      },
    },
  },
};

const fileSchema = {
  type: 'object',
  properties: {
    url: {type: 'string', description: 'Presigned S3 URL (expires)'},
    key: {type: 'string', description: 'S3 object key'},
    mimeType: {type: 'string', example: 'application/pdf'},
    originalName: {type: 'string', example: 'appointment-confirmation.pdf'},
  },
};

const eventSchema = {
  type: 'object',
  description: 'One history entry (newest first on details)',
  properties: {
    id: uuid({description: 'Event id'}),
    type: {type: 'string', enum: eventTypeValues, example: 'COMPLETED'},
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
    payload: {
      type: 'object',
      description:
        'Event-specific details: changedFields, offsetMinutes, outcome, reason, previous* snapshot on reopen',
    },
    createdAt: dateTime({description: 'When it happened'}),
  },
};

const metaSchema = {
  type: 'object',
  nullable: true,
  properties: {value: {type: 'string'}, label: {type: 'string'}},
};

const supervisoryVisitSchema = {
  type: 'object',
  nullable: true,
  description: 'The supervisory visit this task was created from',
  properties: {
    id: uuid({description: 'Supervisory visit id'}),
    visitType: {type: 'string', example: 'ROUTINE'},
    visitTypeMeta: metaSchema,
    visitTypeOther: {type: 'string', nullable: true},
    status: {type: 'string', example: 'SCHEDULED'},
    statusMeta: metaSchema,
    scheduledStartAt: dateTime({description: 'Visit window start'}),
    scheduledEndAt: dateTime({description: 'Visit window end'}),
    canOpen: {
      type: 'boolean',
      description:
        'Whether the caller may open the visit (details only; false on the list)',
    },
  },
};

const taskResponseSchema = {
  type: 'object',
  properties: {
    id: uuid({description: 'Follow-up task id'}),
    organizationId: {type: 'string'},
    patientId: uuid({description: 'Patient this task is for'}),
    patient: patientSchema,
    title: {
      type: 'string',
      example: 'Confirm PCP appointment booked within 24h',
    },
    description: {
      type: 'string',
      nullable: true,
      description: 'What done looks like',
    },
    priority: {type: 'string', enum: FOLLOW_UP_TASK_PRIORITY_VALUES},
    priorityMeta: metaSchema,
    status: {type: 'string', enum: FOLLOW_UP_TASK_STATUS_VALUES},
    statusMeta: metaSchema,
    isOverdue: {
      type: 'boolean',
      description:
        'True when status is OVERDUE, or the task is open and dueAt has passed (before the nightly sweep ran)',
    },
    dueAt: dateTime({
      description: `Due instant (UTC); shown in ${FOLLOW_UP_TASK_DEFAULT_TIME_ZONE}`,
    }),
    dueDeltaMinutes: {
      type: 'integer',
      nullable: true,
      description:
        'Minutes past due: positive = late (open) or completed late, negative = completed early. Null when cancelled.',
    },
    sentReminderOffsets: {
      type: 'array',
      items: {type: 'integer'},
      description: `Reminders already sent, in minutes before dueAt (policy is fixed: ${FOLLOW_UP_TASK_REMINDER_OFFSETS_MINUTES.join(', ')})`,
    },
    assigneeUserOrganizationId: uuid({description: 'Current assignee'}),
    assignee: assigneeSchema,
    originalAssignee: Object.assign({}, assigneeSchema, {
      description:
        'Who the nightly sweep took the task from (read from the ESCALATED_TO_ADMIN history event; details only)',
    }),
    source: sourceSchema,
    supervisoryVisitId: uuid({description: 'Source visit, nullable'}),
    supervisoryVisit: supervisoryVisitSchema,
    checklistTemplateId: uuid({description: 'Linked template, nullable'}),
    checklistTemplate: {
      type: 'object',
      nullable: true,
      description: 'Template with sections and questions (details only)',
    },
    visitInstructions: {type: 'string', nullable: true},
    flagType: {
      type: 'integer',
      nullable: true,
      enum: FOLLOW_UP_TASK_FLAG_TYPE_VALUES.concat([null]),
      description: flagTypeDescription,
    },
    flagMeta: metaSchema,
    completionOutcome: {
      type: 'string',
      nullable: true,
      enum: FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES.concat([null]),
    },
    completionOutcomeMeta: metaSchema,
    completionNotes: {type: 'string', nullable: true},
    completionFiles: {type: 'array', items: fileSchema},
    completionSource: {
      type: 'string',
      nullable: true,
      enum: FOLLOW_UP_TASK_COMPLETION_SOURCE_VALUES.concat([null]),
    },
    overdueAt: dateTime({description: 'When the sweep flipped it'}),
    completedAt: dateTime({description: 'When completed'}),
    completedByUser: personSchema,
    cancelReason: {type: 'string', nullable: true},
    cancelledAt: dateTime({description: 'When cancelled'}),
    cancelledByUser: personSchema,
    createdBy: uuid({description: 'Creator user id'}),
    createdByUser: personSchema,
    events: {
      type: 'array',
      items: eventSchema,
      description: 'History, newest first (details only)',
    },
    createdAt: dateTime({description: 'Created'}),
    updatedAt: dateTime({description: 'Last update'}),
  },
};

const paginationMeta = {
  type: 'object',
  properties: {
    page: {type: 'integer', example: 1},
    limit: {type: 'integer', example: 25},
    count: {type: 'integer', example: 10},
    totalPages: {type: 'integer', example: 1},
  },
};

const taskBody = ({description}) => ({
  description,
  type: 'object',
  properties: {task: taskResponseSchema},
});

const idParam = createIdPathParam({
  name: 'id',
  description: 'Follow-Up Task ID',
});

const commonErrors = {
  401: {description: 'Unauthorized — Invalid or missing token'},
  403: {
    description:
      'Forbidden — Role lacks the permission, or the caller is not allowed to act on this task',
  },
  404: {description: 'Not Found — Task does not exist or is out of scope'},
};

const taskFields = {
  title: {
    type: 'string',
    description: 'Short task title (1–200 chars)',
    example: 'Confirm PCP appointment booked within 24h',
  },
  description: {
    type: 'string',
    nullable: true,
    description: 'What done looks like (max 5000 chars)',
  },
  priority: {
    type: 'string',
    enum: FOLLOW_UP_TASK_PRIORITY_VALUES,
    description: 'Defaults to NORMAL',
  },
  dueAt: {
    type: 'string',
    format: 'date-time',
    description: 'Due instant (ISO 8601, must be in the future)',
    example: '2026-08-21T21:00:00.000Z',
  },
  assigneeUserOrganizationId: {
    type: 'string',
    format: 'uuid',
    description:
      'userOrgId from GET /follow-up-tasks/assignees. Must be on the patient’s care team. Nurses and case managers default to themselves; admins must choose.',
  },
  checklistTemplateId: {
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'Optional ACTIVE template of type FOLLOW_UP',
  },
  visitInstructions: {
    type: 'string',
    nullable: true,
    description: 'Optional visit notes for the assignee (max 5000 chars)',
  },
};

// ==========================================
// DOCS EXPORT
// ==========================================

module.exports = {
  '/api/v1/follow-up-tasks/assignees': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'List who a task for a patient can be assigned to',
      description:
        'The patient’s care team: primary/secondary nurse, the region’s default nurses, the case manager, caregivers linked to the patient and every org admin. Only these userOrgIds are accepted as assigneeUserOrganizationId.',
      parameters: [
        {
          in: 'query',
          name: 'patientId',
          required: true,
          schema: {type: 'string', format: 'uuid'},
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

  '/api/v1/follow-up-tasks': {
    post: createSwaggerDocs({
      tags: TAGS,
      summary: 'Create a follow-up task',
      description:
        'Creates a task for a patient assigned to a care-team member. The assignee is notified (in-app, email, SMS). A CREATED event is written to the task history. Duplicate = same patient, assignee, dueAt and template while open.',
      requestBody: {
        fields: Object.assign(
          {
            patientId: {
              type: 'string',
              format: 'uuid',
              description: 'Patient this task is for',
            },
            submissionFlagId: {
              type: 'string',
              format: 'uuid',
              nullable: true,
              description: 'Alert (SubmissionFlag) this task is linked to',
            },
            flagType: {
              type: 'integer',
              nullable: true,
              enum: FOLLOW_UP_TASK_FLAG_TYPE_VALUES,
              description: flagTypeDescription,
            },
          },
          taskFields
        ),
        required: ['patientId', 'title', 'dueAt'],
      },
      responses: {
        201: {
          description: 'Follow-up task created successfully',
          message: {description: 'Success message'},
          body: taskBody({description: 'Created task with details'}),
        },
        400: {
          description:
            'Bad Request — validation error, unknown patient / linked alert, missing assignee for an admin, or inactive template',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: {description: 'Not Found — template not found or not FOLLOW_UP'},
        409: {description: 'Conflict — duplicate open task'},
        422: {
          description:
            'Unprocessable Entity — assignee is not on the patient’s care team',
        },
      },
    }),

    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'List follow-up tasks',
      description:
        'Paginated list scoped by role: admins see the organization; case managers their own, created, and caseload tasks; nurses their own and created; caregivers only tasks assigned to them. List rows omit answers.',
      parameters: [
        {in: 'query', name: 'page', schema: {type: 'integer'}, example: 1},
        {in: 'query', name: 'limit', schema: {type: 'integer'}, example: 25},
        {
          in: 'query',
          name: 'sortBy',
          schema: {type: 'string', enum: FOLLOW_UP_TASK_SORT_FIELDS_VALUES},
          description: 'Default: createdAt',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Default: desc',
        },
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string'},
          description: `Comma-separated subset of: ${FOLLOW_UP_TASK_STATUS_VALUES.join(', ')}`,
          example: 'PENDING,OVERDUE',
        },
        {
          in: 'query',
          name: 'priority',
          schema: {type: 'string', enum: FOLLOW_UP_TASK_PRIORITY_VALUES},
        },
        {
          in: 'query',
          name: 'source',
          schema: {type: 'string', enum: FOLLOW_UP_TASK_SOURCE_VALUES},
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
          name: 'flagType',
          schema: {type: 'integer', enum: FOLLOW_UP_TASK_FLAG_TYPE_VALUES},
        },
        {
          in: 'query',
          name: 'dueFrom',
          schema: {type: 'string', format: 'date-time'},
        },
        {
          in: 'query',
          name: 'dueTo',
          schema: {type: 'string', format: 'date-time'},
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string'},
          description: 'Title, patient name or assignee name',
        },
      ],
      responses: {
        200: {
          description: 'Follow-up tasks retrieved successfully',
          message: {description: 'Success message'},
          body: {
            type: 'object',
            properties: {
              tasks: {type: 'array', items: taskResponseSchema},
              meta: paginationMeta,
            },
          },
        },
        401: commonErrors[401],
        403: commonErrors[403],
      },
    }),
  },

  '/api/v1/follow-up-tasks/{id}': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Get a follow-up task',
      description:
        'Full details: template with sections/questions, step completions, evidence, linked alert, and the history (events, newest first).',
      parameters: [idParam],
      responses: {
        200: {
          description: 'Follow-up task retrieved successfully',
          message: {description: 'Success message'},
          body: taskBody({description: 'Task details'}),
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
      },
    }),

    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Edit a follow-up task',
      description:
        'Open tasks only; admins, the creator, or a case manager — but once the task is assigned to an admin (escalated or by hand) only admins may edit it. Changing the assignee writes a REASSIGNED event and notifies both people; other changes write EDITED. A new dueAt resets the reminder policy and, on an OVERDUE task, returns it to PENDING. The checklist cannot change once a step was ticked.',
      parameters: [idParam],
      requestBody: {fields: taskFields, required: []},
      responses: {
        200: {
          description: 'Follow-up task updated successfully',
          message: {description: 'Success message'},
          body: taskBody({description: 'Updated task'}),
        },
        400: {
          description: 'Bad Request — validation error or nothing to update',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {
          description:
            'Conflict — task is not open, or the checklist cannot be changed after steps were completed',
        },
        422: {
          description: 'Unprocessable Entity — assignee not on the care team',
        },
      },
    }),
  },

  '/api/v1/follow-up-tasks/{id}/cancel': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Cancel a follow-up task',
      description:
        'Open → CANCELLED with a reason. Admins, the creator, or a case manager; a task assigned to an admin can only be cancelled by an admin. Assignee and creator are notified.',
      parameters: [idParam],
      requestBody: {
        fields: {
          reason: {type: 'string', description: 'Why (1–2000 chars)'},
        },
        required: ['reason'],
      },
      responses: {
        200: {
          description: 'Follow-up task cancelled',
          message: {description: 'Success message'},
          body: taskBody({description: 'Cancelled task'}),
        },
        400: {description: 'Bad Request — reason missing'},
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — task is not open'},
      },
    }),
  },

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // '/api/v1/follow-up-tasks/{id}/reopen': {
  //   patch: createSwaggerDocs({
  //     tags: TAGS,
  //     summary: 'Reopen a completed or cancelled task',
  //     description:
  //       'COMPLETED / CANCELLED → PENDING (OVERDUE if dueAt already passed). Admins, or a case manager unless the task is assigned to an admin. Outcome, notes and cancellation are cleared; the previous values are kept on the REOPENED event. Evidence files stay attached.',
  //     parameters: [idParam],
  //     responses: {
  //       200: {
  //         description: 'Follow-up task reopened',
  //         message: {description: 'Success message'},
  //         body: taskBody({description: 'Reopened task'}),
  //       },
  //       401: commonErrors[401],
  //       403: commonErrors[403],
  //       404: commonErrors[404],
  //       409: {description: 'Conflict — task is not completed or cancelled'},
  //     },
  //   }),
  // },

  '/api/v1/follow-up-tasks/{id}/complete': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Complete a follow-up task with an outcome',
      description: `Multipart. Current assignee only (an admin completes a task once it is escalated or reassigned to them). A task with a checklist also sends an \`answers\` JSON array, validated against its template, with photos as images_<questionId>. Open → COMPLETED with an outcome, required notes and up to ${MAX_TASK_EVIDENCE_FILES} evidence files under the \`files\` field (${ALLOWED_TASK_EVIDENCE_TYPES.join(', ')}). Completing an overdue task is allowed; the lateness is recorded on the COMPLETED event. The creator (and the original assignee of an escalated task) are notified.`,
      parameters: [idParam],
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          outcome: {
            type: 'string',
            enum: FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES,
            example: 'DONE_WITH_ISSUES',
          },
          completionNotes: {
            type: 'string',
            description:
              'What was done and what the outcome was (1–5000 chars)',
          },
          files: {
            type: 'string',
            format: 'binary',
            description: 'Optional evidence files (repeat the field)',
          },
          answers: {
            type: 'string',
            description:
              'JSON-encoded answers array; required when the task has a checklist',
          },
        },
        required: ['outcome', 'completionNotes'],
      },
      responses: {
        200: {
          description: 'Follow-up task marked as completed',
          message: {description: 'Success message'},
          body: taskBody({description: 'Completed task with evidence'}),
        },
        400: {
          description:
            'Bad Request — outcome, notes or checklist answers invalid',
        },
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — task is not open'},
        413: {description: 'Payload Too Large — a file exceeds the size limit'},
        415: {description: 'Unsupported Media Type — file type not allowed'},
        422: {
          description:
            'Unprocessable Entity — required checklist questions unanswered, an answer value is invalid, or too many evidence files',
        },
      },
    }),
  },

  '/api/v1/follow-up-tasks/{id}/submit': {
    patch: createSwaggerDocs({
      tags: TAGS,
      summary: 'Submit a follow-up task (legacy one-shot submission)',
      description:
        'Deprecated in favour of /complete, which takes the same answers. Multipart: template tasks send an `answers` JSON array (files as files_<questionId>); instruction-only tasks send `caseManagerReply` (files as replyFile / reply_*). Open → COMPLETED with outcome DONE.',
      parameters: [idParam],
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          answers: {type: 'string', description: 'JSON-encoded answers array'},
          caseManagerReply: {type: 'string', description: 'Free-text reply'},
          replyFile: {type: 'string', format: 'binary'},
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Follow-up task submitted and marked as completed',
          message: {description: 'Success message'},
          body: taskBody({description: 'Completed task'}),
        },
        400: {description: 'Bad Request — answers/reply validation error'},
        401: commonErrors[401],
        403: commonErrors[403],
        404: commonErrors[404],
        409: {description: 'Conflict — task is not open'},
        422: {description: 'Unprocessable Entity — reply required'},
      },
    }),
  },
};
