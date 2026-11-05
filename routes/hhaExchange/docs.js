const {
  HHA_VISIT_FILTER_STATUSES_VALUES,
} = require('../../constants/hhaVisitsConstants');
const {createSwaggerDocs} = require('../../utils/swaggerUtils');

const HHA_VISIT_STATUS_ENUM = HHA_VISIT_FILTER_STATUSES_VALUES;

const HHA_VISIT_TYPE_ENUM = [
  'DAILY_FIXED',
  'DAILY_VARIABLE',
  'WEEKLY_VARIABLE',
  'NO_SCHEDULE',
];

const hhaVisitSchema = {
  type: 'object',
  description:
    'One imported HHAeXchange visit. In HHAeXchange a schedule and a visit are the same record, so the row carries both the planned window (scheduled*) and what actually happened (actual* / evv*). Standalone: the row keeps a patient / caregiver name snapshot, never PreventaTri foreign keys. The HHAeXchange ids themselves are internal to the import and are never returned.',
  properties: {
    id: {type: 'string', format: 'uuid'},
    organizationId: {type: 'string', format: 'uuid'},
    patientFirstName: {type: 'string', nullable: true},
    patientLastName: {type: 'string', nullable: true},
    caregiverFirstName: {type: 'string', nullable: true},
    caregiverLastName: {type: 'string', nullable: true},
    visitDate: {type: 'string', format: 'date'},
    visitType: {
      type: 'string',
      nullable: true,
      enum: HHA_VISIT_TYPE_ENUM,
      description:
        'How the visit was scheduled. Null when HHAeXchange sent a VisitType outside this list; the run summary reports it as an UNMAPPED_VISIT_TYPE exception.',
      example: 'DAILY_FIXED',
    },
    timeZone: {type: 'string', nullable: true, example: 'Eastern'},
    status: {type: 'string', enum: HHA_VISIT_STATUS_ENUM},
    scheduledStartAt: {type: 'string', format: 'date-time', nullable: true},
    scheduledEndAt: {type: 'string', format: 'date-time', nullable: true},
    scheduleDurationMinutes: {type: 'integer', nullable: true, example: 120},
    actualStartAt: {type: 'string', format: 'date-time', nullable: true},
    actualEndAt: {type: 'string', format: 'date-time', nullable: true},
    evvStartAt: {type: 'string', format: 'date-time', nullable: true},
    evvEndAt: {type: 'string', format: 'date-time', nullable: true},
    clockInEvvType: {type: 'string', nullable: true},
    clockOutEvvType: {type: 'string', nullable: true},
    isMissedVisit: {type: 'boolean'},
    missedReasonId: {type: 'integer', nullable: true},
    missedReason: {type: 'string', nullable: true},
    hhaDeletedAt: {type: 'string', format: 'date-time', nullable: true},
    hhaDeletedReason: {type: 'string', nullable: true},
    hhaModifiedDate: {type: 'string', format: 'date-time', nullable: true},
    hhaLastSyncedAt: {type: 'string', format: 'date-time', nullable: true},
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

const PAGE_PARAMETERS = [
  {
    name: 'page',
    in: 'query',
    schema: {type: 'integer', default: 1, minimum: 1},
  },
  {
    name: 'limit',
    in: 'query',
    schema: {type: 'integer', default: 25, minimum: 1, maximum: 100},
  },
];

const queryParam = ({name, description, schema = {type: 'string'}}) => ({
  name,
  in: 'query',
  description,
  schema,
});

const DATE_RANGE_PARAMETERS = [
  queryParam({name: 'dateFrom', schema: {type: 'string', format: 'date'}}),
  queryParam({name: 'dateTo', schema: {type: 'string', format: 'date'}}),
];

const ID_PARAMETER = {
  name: 'id',
  in: 'path',
  required: true,
  schema: {type: 'string', format: 'uuid'},
};

const COMMON_ERRORS = {
  401: {description: 'Unauthorized - Invalid or missing token'},
  403: {description: 'Forbidden - Admin permission required'},
};

const okResponse = ({description, properties}) =>
  Object.assign(
    {
      200: {
        description,
        content: {
          'application/json': {schema: {type: 'object', properties}},
        },
      },
    },
    COMMON_ERRORS
  );

const linkedRecordSchema = {
  type: 'object',
  nullable: true,
  description:
    'The PreventaTri record the HHA id points at, resolved at read time. kind: patient, nurse, caregiver, caseManager or visit.',
  properties: {
    kind: {type: 'string', example: 'nurse'},
    id: {type: 'string', format: 'uuid'},
    name: {type: 'string'},
  },
};

module.exports = {
  '/api/v1/integration/visits': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'List HHAeXchange visits imported into this organization',
      description:
        'Read-only page of the visits the sync stored. Served from PreventaTri, never proxied to HHAeXchange. ' +
        'A DELETED visit is kept and returned unless a narrower status filter excludes it. Admin only.',
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: {type: 'integer', default: 1, minimum: 1},
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'integer', default: 25, minimum: 1, maximum: 100},
        },
        {
          name: 'sortBy',
          in: 'query',
          schema: {
            type: 'string',
            enum: [
              'visitDate',
              'scheduledStartAt',
              'status',
              'patientLastName',
              'caregiverLastName',
              'hhaModifiedDate',
            ],
          },
        },
        {
          name: 'sortDir',
          in: 'query',
          schema: {type: 'string', enum: ['asc', 'desc']},
        },
        {
          name: 'search',
          in: 'query',
          description:
            'Case-insensitive substring of the patient or caregiver name.',
          schema: {type: 'string', maxLength: 100},
        },
        {
          name: 'status',
          in: 'query',
          schema: {type: 'string', enum: HHA_VISIT_STATUS_ENUM.concat(['all'])},
        },
        {
          name: 'visitType',
          in: 'query',
          description:
            '"all" (or omitted) also returns visits whose VisitType could not be mapped and is stored as null.',
          schema: {type: 'string', enum: HHA_VISIT_TYPE_ENUM.concat(['all'])},
        },
        {
          name: 'dateFrom',
          in: 'query',
          description: 'Inclusive lower bound on visitDate (yyyy-MM-dd).',
          schema: {type: 'string', format: 'date'},
        },
        {
          name: 'dateTo',
          in: 'query',
          description: 'Inclusive upper bound on visitDate (yyyy-MM-dd).',
          schema: {type: 'string', format: 'date'},
        },
      ],
      responses: {
        200: {
          description: 'A page of imported visits',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  hhaVisits: {type: 'array', items: hhaVisitSchema},
                  meta: {
                    type: 'object',
                    properties: {
                      page: {type: 'integer', example: 1},
                      limit: {type: 'integer', example: 25},
                      count: {type: 'integer', example: 6827},
                      totalPages: {type: 'integer', example: 274},
                    },
                  },
                  type: {type: 'string', example: 'HHA_VISITS_LIST_RETRIEVED'},
                },
              },
            },
          },
        },
        400: {description: 'Bad Request - invalid query parameters'},
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin permission required'},
      },
    }),
  },

  '/api/v1/integration/visits/{id}': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'One HHAeXchange visit imported into this organization',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ],
      responses: {
        200: {
          description: 'The visit',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  hhaVisit: hhaVisitSchema,
                  type: {type: 'string', example: 'HHA_VISIT_RETRIEVED'},
                },
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin permission required'},
        404: {description: 'Not Found (HHA_VISIT_NOT_FOUND)'},
      },
    }),
  },

  '/api/v1/integration/sync': {
    post: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary:
        'Start an import of patients, caregivers, nurses, case managers and visits',
      description:
        'Queues a full one-way import of every HHAeXchange resource into this organization — case managers, nurses, caregivers, patients and visits, in that order, so the people exist before patients link to them — in one pass. ' +
        'Returns 202 immediately: the run takes minutes and is performed by a background worker, so this response reports only that the run was accepted. ' +
        'The outcome is stored as a sync run (GET /integration/sync/runs) and announced by a `hha-sync:completed` socket event to every admin; poll nothing, GET /integration/sync/status only restores button state on load. ' +
        'Visits land in a standalone table served by GET /integration/visits; they are never linked to PreventaTri patients or caregivers. ' +
        'Shares the identical code path with the nightly scheduled run. ' +
        'HHAeXchange-owned fields are overwritten. On HHA patients that includes the primary nurse (NurseID; none in HHAeXchange clears it) and the case manager (the first coordinator); ' +
        'a patient county and a nurse primary region are derived from the ZIP and owned while it resolves. ' +
        'PreventaTri-owned fields are never touched ' +
        '(patients: email, riskLevel, notes, diagnoses, secondary nurse — ' +
        'nurses: secondary regions, licence state and expiry, on-call, notes — ' +
        'caregivers: relationshipToPatient, preferredContactMethod, notes, onCallIndicator, patient assignments — ' +
        'case managers: title, phone, regions, manual patients, preferred contact method, language, start date, notes). ' +
        'An id or coordinator name that matches nobody keeps the current link and is reported. ' +
        'A caregiver, nurse or case manager email follows HHAeXchange whenever HHAeXchange has a valid address that no other user here holds; when HHAeXchange has none, the stored email (placeholder or admin-set) is kept. ' +
        'Imported people are created UNVERIFIED with no invitation email, for an admin to review and invite. ' +
        'Resources are reconciled independently, so a caregiver-feed outage still leaves patients imported; the per-resource outcome is stored on the sync run, not returned here. ' +
        'A Redis lock allows one run at a time per organization across all replicas (runs for different organizations do not block each other), and a queued-slot marker rejects a second press from the same organization before the worker picks the job up. Admin only. No request body.',
      responses: {
        202: {
          description: 'Sync accepted and queued',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  runId: {
                    type: 'string',
                    format: 'uuid',
                    description:
                      'The sync run id; the socket event for this run carries it too.',
                  },
                  type: {type: 'string', example: 'HHA_SYNC_QUEUED'},
                },
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin permission required'},
        409: {
          description:
            'Conflict - a sync is already queued or running (HHA_SYNC_ALREADY_RUNNING)',
        },
        503: {
          description:
            'Service Unavailable - the run could not be queued (HHA_SYNC_ENQUEUE_FAILED). Nothing was imported and the request can be retried.',
        },
      },
    }),
  },

  '/api/v1/integration/sync/status': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Whether an HHAeXchange sync is queued or running',
      description:
        'For page load, not polling: the socket carries only the completion event, so a client that mounts mid-run would otherwise show an idle Sync button that immediately 409s. ' +
        'True while the run is queued and while it is in flight. Gated on the sync permission — whoever may start a run may ask about one. Admin only.',
      responses: {
        200: {
          description: 'The current sync state',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  isRunning: {type: 'boolean', example: true},
                  type: {
                    type: 'string',
                    example: 'HHA_SYNC_STATUS_RETRIEVED',
                  },
                },
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin permission required'},
      },
    }),
  },

  '/api/v1/integration/sync/runs': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'HHAeXchange sync run history',
      description:
        'Every nightly and manual run, newest first: trigger, who pressed Sync, start and end time, status (RUNNING, SUCCEEDED, WITH_EXCEPTIONS, PARTIAL, FAILED, ABANDONED) and per-resource counters. ' +
        'Counters only: exception details are served by /integration/sync/exceptions. Admin only.',
      parameters: PAGE_PARAMETERS.concat(
        [
          queryParam({name: 'status', description: 'A run status, or all'}),
          queryParam({
            name: 'trigger',
            description: 'SCHEDULED, MANUAL or all',
          }),
        ],
        DATE_RANGE_PARAMETERS
      ),
      responses: okResponse({
        description: 'A page of runs',
        properties: {
          syncRuns: {type: 'array', items: {type: 'object'}},
          meta: {type: 'object'},
          type: {type: 'string', example: 'HHA_SYNC_RUNS_LIST_RETRIEVED'},
        },
      }),
    }),
  },

  '/api/v1/integration/sync/runs/{id}': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'One HHAeXchange sync run',
      description:
        'The run with its per-resource counters, how many changes it recorded and how many exceptions it last reported. Admin only.',
      parameters: [ID_PARAMETER],
      responses: Object.assign(
        okResponse({
          description: 'The run',
          properties: {
            syncRun: {type: 'object'},
            type: {type: 'string', example: 'HHA_SYNC_RUN_RETRIEVED'},
          },
        }),
        {404: {description: 'Not Found (HHA_SYNC_RUN_NOT_FOUND)'}}
      ),
    }),
  },

  '/api/v1/integration/sync/changes': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Records the HHAeXchange sync created or changed',
      description:
        'One row per record a run created, updated, relinked, re-emailed, adopted, reclassified or saw deleted in HHAeXchange. ' +
        '`changes` is [{field, from, to}]. Rows recorded before 2026-10-02 may hold patient personal fields as [{field, redacted: true}] with no values. ' +
        'A link-change entry also carries fromLabel/toLabel: the county, nurse, case manager, region or user its ids name. Admin only.',
      parameters: PAGE_PARAMETERS.concat(
        [
          queryParam({name: 'runId', description: 'Only this run'}),
          queryParam({name: 'resource', description: 'A resource, or all'}),
          queryParam({name: 'action', description: 'A change action, or all'}),
          queryParam({name: 'hhaRecordId', description: 'One HHA record'}),
        ],
        DATE_RANGE_PARAMETERS
      ),
      responses: okResponse({
        description: 'A page of changes',
        properties: {
          syncChanges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                resource: {type: 'string'},
                action: {type: 'string'},
                hhaRecordId: {type: 'string'},
                changes: {type: 'array', items: {type: 'object'}},
                record: linkedRecordSchema,
                createdAt: {type: 'string', format: 'date-time'},
              },
            },
          },
          meta: {type: 'object'},
          type: {type: 'string', example: 'HHA_SYNC_CHANGES_LIST_RETRIEVED'},
        },
      }),
    }),
  },

  '/api/v1/integration/sync/exceptions': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'HHAeXchange sync exceptions worklist',
      description:
        'One row per problem per record, deduplicated across runs (`occurrences` counts the runs that raised it). ' +
        'Status: OPEN, RESOLVED, DISMISSED or AUTO_RESOLVED (a later clean run no longer raised it for a record it read). ' +
        '`relatedUser` is the other user in an email conflict, with the profile to open. `resolvedBy` is the admin who last resolved or dismissed it and stays after a reopen; `reopenedBy` is the admin who reopened it (null when a repeat in a later sync did). ' +
        'A per-person row (`*_INVITATION_PENDING`, `*_NOT_ACTIVE`) has no record: `relatedUser` is the nurse or case manager, `waitingPatientCount` the patients waiting for them and `invitationStatus` where their invitation stands. A conflict row carries `preventatriNurse` or `preventatriCaseManager`, who is on the patient now. Admin only.',
      parameters: PAGE_PARAMETERS.concat([
        queryParam({
          name: 'status',
          description: 'An exception status, or all',
        }),
        queryParam({name: 'type', description: 'An exception code, or all'}),
        queryParam({name: 'resource', description: 'A resource, or all'}),
        queryParam({name: 'runId', description: 'Last raised by this run'}),
      ]),
      responses: okResponse({
        description: 'A page of exceptions',
        properties: {
          syncExceptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                resource: {type: 'string'},
                type: {type: 'string', example: 'DUPLICATE_EMAIL'},
                hhaRecordId: {type: 'string', nullable: true},
                detail: {type: 'string', nullable: true},
                status: {type: 'string'},
                occurrences: {type: 'integer'},
                record: linkedRecordSchema,
                relatedUser: {type: 'object', nullable: true},
                waitingPatientCount: {type: 'integer'},
                invitationStatus: {type: 'string', nullable: true},
                preventatriNurse: {type: 'object', nullable: true},
                preventatriCaseManager: {type: 'object', nullable: true},
                resolvedBy: {type: 'object', nullable: true},
                reopenedBy: {type: 'object', nullable: true},
                lastSeenAt: {type: 'string', format: 'date-time'},
              },
            },
          },
          meta: {type: 'object'},
          type: {type: 'string', example: 'HHA_SYNC_EXCEPTIONS_LIST_RETRIEVED'},
        },
      }),
    }),
  },

  '/api/v1/integration/sync/exceptions/counts': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Open HHAeXchange sync exceptions by type',
      parameters: [],
      responses: okResponse({
        description: 'Open exception counts',
        properties: {
          total: {type: 'integer'},
          byType: {type: 'object', additionalProperties: {type: 'integer'}},
          type: {
            type: 'string',
            example: 'HHA_SYNC_EXCEPTION_COUNTS_RETRIEVED',
          },
        },
      }),
    }),
  },

  '/api/v1/integration/sync/exceptions/{id}': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Resolve, dismiss or reopen an HHAeXchange sync exception',
      description:
        'RESOLVED and DISMISSED record who and when, with an optional note. A RESOLVED exception reopens if a later run raises it again; a DISMISSED one stays dismissed. OPEN reopens it by hand. Admin only.',
      parameters: [ID_PARAMETER],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['OPEN', 'RESOLVED', 'DISMISSED'],
                },
                note: {type: 'string', maxLength: 500, nullable: true},
              },
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The updated exception',
          properties: {
            syncException: {type: 'object'},
            type: {type: 'string', example: 'HHA_SYNC_EXCEPTION_UPDATED'},
          },
        }),
        {
          400: {
            description:
              'Bad Request - invalid status or note; closing a PRIMARY_NURSE_CONFLICT here (HHA_PRIMARY_NURSE_CHOICE_REQUIRED); or reopening one with nothing left to choose (HHA_PRIMARY_NURSE_CONFLICT_NOT_REOPENABLE)',
          },
          404: {description: 'Not Found (HHA_SYNC_EXCEPTION_NOT_FOUND)'},
        }
      ),
    }),
  },

  '/api/v1/integration/sync/exceptions/{id}/county': {
    post: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Add a "county not set up" exception\'s county to a region',
      description:
        'For an OPEN COUNTY_NOT_IN_ORGANIZATION exception. Adds the county it names to the region, gives it to the patients already imported whose ZIP is in it, and resolves every open exception naming that county. Nurses get their region on the next sync. Admin only.',
      parameters: [ID_PARAMETER],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['regionId'],
              properties: {regionId: {type: 'string', format: 'uuid'}},
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The county and how many patients received it',
          properties: {
            exceptionCounty: {
              type: 'object',
              properties: {
                county: {type: 'object'},
                patientsUpdated: {type: 'integer', example: 3},
              },
            },
            type: {type: 'string', example: 'HHA_SYNC_EXCEPTION_COUNTY_ADDED'},
          },
        }),
        {
          404: {
            description:
              'Not Found - the exception (HHA_SYNC_EXCEPTION_NOT_FOUND) or the region',
          },
          409: {
            description:
              'Conflict - not an open county exception (HHA_COUNTY_EXCEPTION_NOT_ACTIONABLE), or a sync is running',
          },
        }
      ),
    }),
  },

  '/api/v1/integration/sync/email-conflicts': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'People sharing one HHAeXchange email',
      description:
        'One row per address HHAeXchange gives to more than one person, or that another user already logs in with. ' +
        'Member state: USES_EMAIL (logs in with it), NEEDS_EMAIL (imported on a placeholder login), ADMIN_SET (an admin typed a login email; the sync keeps it) or OTHER_EMAIL (kept an earlier login email). ' +
        '`needsAttention` is true while any member is NEEDS_EMAIL or OTHER_EMAIL. Admin only.',
      parameters: PAGE_PARAMETERS.concat([
        queryParam({
          name: 'status',
          description: 'needsAttention, resolved or all',
        }),
      ]),
      responses: okResponse({
        description: 'A page of shared addresses',
        properties: {
          emailConflicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: {type: 'string'},
                needsAttention: {type: 'boolean'},
                members: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      userId: {type: 'string', format: 'uuid'},
                      name: {type: 'string'},
                      loginEmail: {type: 'string'},
                      state: {type: 'string', example: 'NEEDS_EMAIL'},
                      isEditable: {type: 'boolean'},
                      profile: {type: 'object'},
                    },
                  },
                },
              },
            },
          },
          meta: {type: 'object'},
          type: {type: 'string', example: 'HHA_EMAIL_CONFLICTS_LIST_RETRIEVED'},
        },
      }),
    }),
  },

  '/api/v1/integration/sync/email-conflicts/users/{userId}': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Give a shared-email person a unique login email',
      description:
        'Allowed only while the login email is the sync placeholder or the HHAeXchange address is shared. The address is then kept by every later sync. Admin only.',
      parameters: [
        {
          name: 'userId',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {email: {type: 'string', format: 'email'}},
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The new login email',
          properties: {
            userId: {type: 'string', format: 'uuid'},
            email: {type: 'string'},
            type: {type: 'string', example: 'HHA_EMAIL_CONFLICT_USER_UPDATED'},
          },
        }),
        {
          400: {description: 'Bad Request (HHA_MANAGED_FIELD_READ_ONLY)'},
          404: {description: 'Not Found - user not in this organization'},
          409: {description: 'Conflict (HHA_EMAIL_IN_USE)'},
        }
      ),
    }),
  },

  '/api/v1/integration/sync/email-conflicts/pending/{id}': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Give a person who is not imported yet a login email',
      description:
        'A person whose HHAeXchange email belongs to someone else is not imported (member state NOT_IMPORTED). This saves the login email an admin gives them (state EMAIL_SAVED); the next sync imports them with it. Admin only.',
      parameters: [ID_PARAMETER],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {email: {type: 'string', format: 'email'}},
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The waiting person with the saved email',
          properties: {
            member: {type: 'object'},
            type: {type: 'string', example: 'HHA_PENDING_IMPORT_EMAIL_SAVED'},
          },
        }),
        {
          404: {description: 'Not Found - no longer waiting'},
          409: {description: 'Conflict (HHA_EMAIL_IN_USE)'},
        }
      ),
    }),
  },

  '/api/v1/integration/sync/coordinators': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'Patients with more than one HHAeXchange coordinator',
      description:
        'Each patient lists its HHAeXchange coordinators in HHA order. `isCaseManager` marks the one that is the case manager here; the others have no role in PreventaTri. ' +
        '`isChosen` is true once an admin picked one; until then the first coordinator is used. Admin only.',
      parameters: PAGE_PARAMETERS.concat([
        queryParam({
          name: 'choice',
          description: 'needsChoice, chosen or all',
        }),
      ]),
      responses: okResponse({
        description: 'A page of patients',
        properties: {
          coordinatorPatients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                patientId: {type: 'string', format: 'uuid'},
                hhaPatientId: {type: 'string', nullable: true},
                name: {type: 'string'},
                isChosen: {type: 'boolean'},
                coordinators: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      slot: {type: 'integer'},
                      name: {type: 'string'},
                      caseManagerProfileId: {
                        type: 'string',
                        format: 'uuid',
                        nullable: true,
                      },
                      isArchived: {type: 'boolean'},
                      isCaseManager: {type: 'boolean'},
                    },
                  },
                },
              },
            },
          },
          meta: {type: 'object'},
          type: {
            type: 'string',
            example: 'HHA_COORDINATOR_PATIENTS_LIST_RETRIEVED',
          },
        },
      }),
    }),
  },

  '/api/v1/integration/patients/{patientId}/primary-nurse': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary:
        'Settle a primary nurse conflict between PreventaTri and HHAeXchange',
      description:
        'For a patient with an open PRIMARY_NURSE_CONFLICT exception. HHA sets the nurse HHAeXchange names and locks the field again; PREVENTATRI keeps the admin pick and stays quiet until HHAeXchange names another nurse. Either choice closes the exception. Nothing is written to HHAeXchange. Admin only.',
      parameters: [
        {
          name: 'patientId',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['choice'],
              properties: {
                choice: {type: 'string', enum: ['PREVENTATRI', 'HHA']},
              },
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The primary nurse now on the patient',
          properties: {
            patientPrimaryNurse: {type: 'object'},
            type: {
              type: 'string',
              example: 'HHA_PATIENT_PRIMARY_NURSE_SELECTED',
            },
          },
        }),
        {
          404: {
            description:
              'Not Found - patient not in this organization, or no open conflict (HHA_PRIMARY_NURSE_CONFLICT_NOT_FOUND)',
          },
        }
      ),
    }),
  },
  '/api/v1/integration/patients/{patientId}/case-manager-conflict': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary:
        'Settle a case manager conflict between PreventaTri and HHAeXchange',
      description:
        'For a patient with an open CASE_MANAGER_CONFLICT exception. HHA puts the case manager HHAeXchange names on the patient and locks the field again; PREVENTATRI keeps the current one and stays quiet until HHAeXchange names another. Either choice closes the exception. Nothing is written to HHAeXchange. Admin only.',
      parameters: [
        {
          name: 'patientId',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['choice'],
              properties: {
                choice: {type: 'string', enum: ['PREVENTATRI', 'HHA']},
              },
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The case manager now on the patient',
          properties: {
            patientCaseManager: {type: 'object'},
            type: {
              type: 'string',
              example: 'HHA_PATIENT_CASE_MANAGER_CONFLICT_SETTLED',
            },
          },
        }),
        {
          404: {
            description:
              'Not Found - patient not in this organization, or no open conflict (HHA_CASE_MANAGER_CONFLICT_NOT_FOUND)',
          },
        }
      ),
    }),
  },
  '/api/v1/integration/sync/exceptions/{id}/patients': {
    get: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary: 'List the patients waiting for the person an exception names',
      description:
        'For a per-person exception (NURSE_INVITATION_PENDING, CASE_MANAGER_INVITATION_PENDING, NURSE_NOT_ACTIVE, CASE_MANAGER_NOT_ACTIVE): the patients HHAeXchange assigns that person, each with whoever holds it meanwhile. Empty for any other exception. Admin only.',
      parameters: PAGE_PARAMETERS.concat([
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ]),
      responses: okResponse({
        description: 'The waiting patients',
        properties: {
          waitingPatients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                patientId: {type: 'string', format: 'uuid'},
                hhaPatientId: {type: 'string', nullable: true},
                name: {type: 'string'},
                current: {type: 'object', nullable: true},
              },
            },
          },
          meta: {type: 'object'},
          type: {
            type: 'string',
            example: 'HHA_WAITING_PATIENTS_LIST_RETRIEVED',
          },
        },
      }),
    }),
  },
  '/api/v1/integration/patients/{patientId}/case-manager': {
    patch: createSwaggerDocs({
      tags: ['HHAeXchange'],
      summary:
        "Choose a patient's case manager from its HHAeXchange coordinators",
      description:
        'The pick must be one of the coordinators HHAeXchange lists on the patient, matched to an active case manager. Later syncs keep it while HHAeXchange still lists that coordinator. Admin only.',
      parameters: [
        {
          name: 'patientId',
          in: 'path',
          required: true,
          schema: {type: 'string', format: 'uuid'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['caseManagerProfileId'],
              properties: {
                caseManagerProfileId: {type: 'string', format: 'uuid'},
              },
            },
          },
        },
      },
      responses: Object.assign(
        okResponse({
          description: 'The patient with its coordinators',
          properties: {
            coordinatorPatient: {type: 'object'},
            type: {
              type: 'string',
              example: 'HHA_PATIENT_CASE_MANAGER_SELECTED',
            },
          },
        }),
        {
          400: {description: 'Bad Request (HHA_COORDINATOR_NOT_SELECTABLE)'},
          404: {description: 'Not Found - patient not in this organization'},
        }
      ),
    }),
  },
};
