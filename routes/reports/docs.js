const {
  REPORT_PATIENT_TRENDS,
  REPORT_PATIENT_TRENDS_VALUES,
} = require('../../constants/reportsConstants');
const {createSwaggerDocs} = require('../../utils/swaggerUtils');

const TAGS = ['Reports'];

const personParam = ({name, who}) => ({
  in: 'query',
  name,
  schema: {type: 'string', format: 'uuid'},
  description: `Only count records for this ${who}'s patients.`,
  required: false,
});

// Each narrows to that person's patients; combined with AND.
const personParams = [
  personParam({name: 'caregiverUserId', who: 'caregiver (User id)'}),
  personParam({name: 'caseManagerUserId', who: 'case manager (User id)'}),
  personParam({
    name: 'nurseUserId',
    who: 'nurse (User id, primary or secondary nurse)',
  }),
  {
    in: 'query',
    name: 'patientId',
    schema: {type: 'string', format: 'uuid'},
    description: 'Only count records for this patient.',
    required: false,
  },
];

const periodParams = [
  {
    in: 'query',
    name: 'from',
    schema: {type: 'string', format: 'date'},
    description:
      "First day of the period (inclusive, organization's day). Defaults to 29 days before to.",
    example: '2026-08-30',
    required: false,
  },
  {
    in: 'query',
    name: 'to',
    schema: {type: 'string', format: 'date'},
    description:
      "Last day of the period (inclusive, organization's day). Defaults to today. The span cannot exceed 366 days.",
    example: '2026-09-28',
    required: false,
  },
  {
    in: 'query',
    name: 'regionId',
    schema: {type: 'string', format: 'uuid'},
    description:
      "Only count records whose patient's current county is in this region. Empty means all regions.",
    required: false,
  },
].concat(personParams);

const kpiSchema = ({example}) => ({
  type: 'object',
  properties: {
    value: {type: 'number', nullable: true, example: example.value},
    previous: {type: 'number', nullable: true, example: example.previous},
    delta: {type: 'number', nullable: true, example: example.delta},
  },
});

const roleSchema = ({example}) => ({
  type: 'object',
  properties: {
    pct: {type: 'number', nullable: true, example: example.pct},
    part: {type: 'integer', example: example.part},
    total: {type: 'integer', example: example.total},
    people: {type: 'integer', example: example.people},
  },
});

const rangeSchema = {
  type: 'object',
  description: 'The resolved period in the organization time zone',
  properties: {
    from: {type: 'string', example: '2026-08-30'},
    to: {type: 'string', example: '2026-09-28'},
    grain: {type: 'string', enum: ['day', 'week', 'month'], example: 'week'},
    timeZone: {type: 'string', example: 'America/New_York'},
    spanDays: {type: 'integer', example: 30},
    buckets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: {type: 'string', example: '2026-08-24'},
          partial: {type: 'boolean', example: true},
        },
      },
    },
    previous: {
      type: 'object',
      properties: {
        from: {type: 'string', example: '2026-07-31'},
        to: {type: 'string', example: '2026-08-29'},
      },
    },
  },
};

const commonErrors = {
  400: {description: 'Bad Request - Invalid period or regionId'},
  401: {description: 'Unauthorized - Invalid or missing token'},
  403: {description: 'Forbidden - Admin only'},
};

module.exports = {
  '/api/v1/reports/overview': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Reports KPI row and Performance by role',
      description:
        'Alerts raised, SLA compliance (the admin dashboard rule: escalations resolved in the period without ever escalating), median time to resolve and assessments on time for the period, each with the previous period of equal length; overdue work now (ignores the period); alert status; and the four role rows. Every record is placed in a region by its patient current county. Admin only.',
      parameters: periodParams,
      responses: Object.assign(
        {
          200: {
            description: 'Report overview retrieved successfully',
            message: {example: 'Report overview retrieved successfully'},
            body: {
              type: 'object',
              properties: {
                range: rangeSchema,
                kpis: {
                  type: 'object',
                  properties: {
                    alertsRaised: kpiSchema({
                      example: {value: 318, previous: 306, delta: 12},
                    }),
                    slaCompliancePct: kpiSchema({
                      example: {value: 91.4, previous: 89.3, delta: 2.1},
                    }),
                    medianResolveSeconds: kpiSchema({
                      example: {value: 420, previous: 540, delta: -120},
                    }),
                    assessmentsOnTimePct: kpiSchema({
                      example: {value: 92.6, previous: 93, delta: -0.4},
                    }),
                  },
                },
                kpiDetails: {
                  type: 'object',
                  properties: {
                    red: {type: 'integer', example: 94},
                    yellow: {type: 'integer', example: 224},
                    timeouts: {
                      type: 'integer',
                      example: 27,
                      description: 'Resolved alerts outside SLA in the period',
                    },
                    p90ResolveSeconds: {
                      type: 'number',
                      nullable: true,
                      example: 2520,
                    },
                    medianAcceptSeconds: {
                      type: 'number',
                      nullable: true,
                      example: 95,
                      description:
                        'Median time from escalation start to acceptance',
                    },
                    missed: {type: 'integer', example: 34},
                    late: {type: 'integer', example: 53},
                  },
                },
                overdueNow: {
                  type: 'object',
                  properties: {
                    total: {type: 'integer', example: 9},
                    tasks: {type: 'integer', example: 6},
                    visits: {type: 'integer', example: 3},
                  },
                },
                alertStatus: {
                  type: 'object',
                  description:
                    'Red and yellow alerts raised in the period by current status; they add up to alertsRaised.',
                  properties: {
                    open: {type: 'integer', example: 12},
                    accepted: {type: 'integer', example: 5},
                    resolved: {type: 'integer', example: 298},
                    voided: {type: 'integer', example: 8},
                  },
                },
                roles: {
                  type: 'object',
                  properties: {
                    nurses: roleSchema({
                      example: {pct: 91.7, part: 248, total: 270, people: 7},
                    }),
                    caseManagers: roleSchema({
                      example: {pct: 89.3, part: 100, total: 112, people: 4},
                    }),
                    caregivers: roleSchema({
                      example: {
                        pct: 92.6,
                        part: 1868,
                        total: 2017,
                        people: 268,
                      },
                    }),
                    admins: roleSchema({
                      example: {pct: 96.3, part: 52, total: 54, people: 2},
                    }),
                  },
                },
                type: {type: 'string', example: 'REPORTS_OVERVIEW_RETRIEVED'},
              },
            },
          },
        },
        commonErrors
      ),
    }),
  },

  '/api/v1/reports/regions': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Reports region scorecard',
      description:
        'One row per active region in scope, placed by each patient current county. With no regionId, a row with regionId and regionName null ("Unassigned region") is added when it has any alert or active patient. Active patients and overdue work are live; the rest cover the period. Admin only.',
      parameters: periodParams,
      responses: Object.assign(
        {
          200: {
            description: 'Region scorecard retrieved successfully',
            message: {example: 'Region scorecard retrieved successfully'},
            body: {
              type: 'object',
              properties: {
                range: rangeSchema,
                regions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      regionId: {type: 'string', nullable: true},
                      regionName: {
                        type: 'string',
                        nullable: true,
                        example: 'Western',
                      },
                      activePatients: {type: 'integer', example: 142},
                      alerts: {type: 'integer', example: 104},
                      slaCompliancePct: {
                        type: 'number',
                        nullable: true,
                        example: 93.1,
                      },
                      medianResolveSeconds: {
                        type: 'number',
                        nullable: true,
                        example: 360,
                      },
                      medianAcceptSeconds: {
                        type: 'number',
                        nullable: true,
                        example: 80,
                      },
                      assessmentsOnTimePct: {
                        type: 'number',
                        nullable: true,
                        example: 94.2,
                      },
                      overdueNow: {type: 'integer', example: 2},
                    },
                  },
                },
                type: {type: 'string', example: 'REPORTS_REGIONS_RETRIEVED'},
              },
            },
          },
        },
        commonErrors
      ),
    }),
  },
  '/api/v1/reports/high-risk-patients': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Reports high-risk patients',
      description:
        'At most 10 active patients with an alert in the period or a worsening triage score, highest risk rank first (red alerts x 10, yellow x 3, 5 if worsening, overdue follow-ups x 2; ties by latest score). No pagination. Admin only.',
      parameters: periodParams,
      responses: Object.assign(
        {
          200: {
            description: 'High-risk patients retrieved successfully',
            message: {example: 'High-risk patients retrieved successfully'},
            body: {
              type: 'object',
              properties: {
                range: rangeSchema,
                patients: {
                  type: 'array',
                  maxItems: 10,
                  items: {
                    type: 'object',
                    properties: {
                      patientId: {type: 'string'},
                      firstName: {type: 'string', example: 'Dorothy'},
                      lastName: {type: 'string', example: 'Kline'},
                      countyName: {
                        type: 'string',
                        nullable: true,
                        example: 'Dauphin',
                      },
                      caseManager: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          firstName: {type: 'string', example: 'Maria'},
                          lastName: {type: 'string', example: 'Lopez'},
                        },
                      },
                      redAlerts: {type: 'integer', example: 4},
                      yellowAlerts: {type: 'integer', example: 2},
                      trend: {
                        type: 'string',
                        nullable: true,
                        enum: REPORT_PATIENT_TRENDS_VALUES,
                        example: REPORT_PATIENT_TRENDS.WORSENING,
                      },
                      overdueFollowUps: {type: 'integer', example: 2},
                      riskRank: {type: 'integer', example: 55},
                    },
                  },
                },
                type: {
                  type: 'string',
                  example: 'REPORTS_HIGH_RISK_PATIENTS_RETRIEVED',
                },
              },
            },
          },
        },
        commonErrors
      ),
    }),
  },
  '/api/v1/reports/work-items': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Reports follow-up tasks and supervisory visits',
      description:
        'Follow-up tasks created in the period (completed on time out of completed or overdue) with created and completed counts per bucket, where completed counts tasks completed in that bucket whenever created. Supervisory visits scheduled to start in the period, with filed on time, median review time and the status mix. overdueNow is live and ignores the period. Admin only.',
      parameters: periodParams,
      responses: Object.assign(
        {
          200: {
            description: 'Work items report retrieved successfully',
            message: {example: 'Work items report retrieved successfully'},
            body: {
              type: 'object',
              properties: {
                range: rangeSchema,
                followUps: {
                  type: 'object',
                  properties: {
                    created: {type: 'integer', example: 117},
                    completed: {type: 'integer', example: 112},
                    completedOnTimePct: {
                      type: 'number',
                      nullable: true,
                      example: 89.3,
                    },
                    overdueNow: {type: 'integer', example: 6},
                    trend: {
                      type: 'object',
                      properties: {
                        buckets: rangeSchema.properties.buckets,
                        created: {
                          type: 'array',
                          items: {type: 'integer'},
                          example: [27],
                        },
                        completed: {
                          type: 'array',
                          items: {type: 'integer'},
                          example: [24],
                        },
                      },
                    },
                  },
                },
                visits: {
                  type: 'object',
                  properties: {
                    scheduled: {type: 'integer', example: 44},
                    filed: {type: 'integer', example: 38},
                    filedOnTimePct: {
                      type: 'number',
                      nullable: true,
                      example: 84.2,
                    },
                    medianReviewSeconds: {
                      type: 'number',
                      nullable: true,
                      example: 21600,
                    },
                    overdueNow: {type: 'integer', example: 3},
                    statusMix: {
                      type: 'array',
                      description:
                        'Always the five statuses in this order, zero-filled',
                      items: {
                        type: 'object',
                        properties: {
                          status: {
                            type: 'string',
                            enum: [
                              'SCHEDULED',
                              'UNDER_REVIEW',
                              'APPROVED',
                              'OVERDUE',
                              'CANCELLED',
                            ],
                          },
                          count: {type: 'integer'},
                        },
                      },
                      example: [
                        {status: 'SCHEDULED', count: 4},
                        {status: 'UNDER_REVIEW', count: 5},
                        {status: 'APPROVED', count: 29},
                        {status: 'OVERDUE', count: 3},
                        {status: 'CANCELLED', count: 3},
                      ],
                    },
                    concernsNoted: {type: 'integer', example: 9},
                    correctionRequested: {type: 'integer', example: 5},
                  },
                },
                type: {type: 'string', example: 'REPORTS_WORK_ITEMS_RETRIEVED'},
              },
            },
          },
        },
        commonErrors
      ),
    }),
  },
  '/api/v1/reports/coverage': {
    get: createSwaggerDocs({
      tags: TAGS,
      summary: 'Reports coverage gaps',
      description:
        'Six live coverage gap counts (no records). Ignores the period. patientsWithoutCounty is null when a regionId is sent, since a patient without a county belongs to no region. Admin only.',
      parameters: periodParams.filter(({name}) => name === 'regionId'),
      responses: Object.assign(
        {
          200: {
            description: 'Coverage gaps retrieved successfully',
            message: {example: 'Coverage gaps retrieved successfully'},
            body: {
              type: 'object',
              properties: {
                asOf: {
                  type: 'string',
                  format: 'date-time',
                  example: '2026-09-28T18:52:00.000Z',
                },
                gaps: {
                  type: 'object',
                  properties: {
                    patientsWithoutCounty: {
                      type: 'integer',
                      nullable: true,
                      example: 1,
                    },
                    patientsWithoutPrimaryNurse: {type: 'integer', example: 4},
                    patientsWithoutCaseManager: {type: 'integer', example: 2},
                    patientsWithoutActiveChecklist: {
                      type: 'integer',
                      example: 3,
                    },
                    regionsWithoutPrimaryDefault: {type: 'integer', example: 1},
                    nursesLicenseExpiring: {type: 'integer', example: 2},
                  },
                },
                type: {type: 'string', example: 'REPORTS_COVERAGE_RETRIEVED'},
              },
            },
          },
        },
        commonErrors
      ),
    }),
  },
};
