const {modelConstants} = require('../constants');

const {
  ESCALATION_STATUSES,
  ESCALATION_ACTIONS,
} = require('../constants/escalationConstants');
const {EMERGENCY_FLAG_DEFAULT_FLAGS} = require('../constants/redFlagConstants');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
  SUBMISSION_FLAG_TYPE,
} = require('../constants/submissionFlagConstants');
const {PrismaFactory} = require('../factories');
const {flagSubmissionEvidenceSelect} = require('../utils/assessmentsUtils');

const {
  buildCaregiverPatientAccessClause,
} = require('../utils/checklistAssignmentUtils');

const {getCurrentTime} = require('../utils/dateUtils');
const {buildNameSearchClause, safeMerge} = require('../utils/general');

const {
  buildNursePatientScopeClause,
} = require('../utils/nursePatientScopeUtils');
const {patientRecordSelect} = require('../utils/patientUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

// A nurse sees the flags of their patients, plus every flag escalated to them
// or accepted by them, even when the patient is outside their regions.
const buildNurseFlagScopeClauses = ({nurseScope}) => [
  {patient: buildNursePatientScopeClause({nurseScope})},
  {
    escalation: {
      OR: [
        {currentAssignee: {userId: nurseScope.userId}},
        {acknowledgedBy: {userId: nurseScope.userId}},
      ],
    },
  },
];

module.exports = class EmergencyFlagServices {
  static async getEmergencyFlagById({
    id,
    submittedBy,
    options = {},
    includeFullDetails = true,
  }) {
    try {
      const query = {id};
      if (submittedBy) query.submittedBy = submittedBy;

      const fieldsInclusion = includeFullDetails
        ? {include: ['images', 'audioNote', 'description']}
        : options.fieldsInclusion;

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.RED_FLAG,
        query,
        options,
        fieldsInclusion,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getEmergencyFlagDetails({
    id,
    submittedBy,
    caregiverUserId,
    nurseScope,
    caseManagerProfileId,
  }) {
    try {
      const query = {id};
      if (submittedBy) query.submittedBy = submittedBy;
      if (caregiverUserId) {
        query.patient = buildCaregiverPatientAccessClause({
          userId: caregiverUserId,
        });
      }
      if (nurseScope) {
        query.OR = buildNurseFlagScopeClauses({nurseScope});
      }
      if (caseManagerProfileId) {
        query.patient = {
          caseManagerPatients: {some: {caseManagerProfileId}},
        };
      }

      // Every viewer who can open the flag sees the full escalation chain, so
      // staff newly assigned to the patient see how earlier flags were handled.
      const eventsInclusion = {
        orderBy: {assignedAt: 'asc'},
        include: {
          assignee: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      };

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.RED_FLAG,
        query,
        fieldsInclusion: {
          include: {
            images: true,
            audioNote: true,
            description: true,
            patient: {select: patientRecordSelect},
            submitter: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                address: true,
                phoneNo: true,
              },
            },
            voider: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            submission: {select: flagSubmissionEvidenceSelect},
            escalation: {
              include: {
                events: eventsInclusion,

                // userId decides isAssignedToViewer; the name is shown as the
                // current owner on the resolution card.
                currentAssignee: {
                  select: {
                    userId: true,
                    user: {select: {firstName: true, lastName: true}},
                  },
                },
                acknowledgedBy: {
                  select: {
                    user: {select: {firstName: true, lastName: true}},
                  },
                },
                response: {
                  include: {
                    submitter: {
                      select: {
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async createEmergencyFlag({
    id,
    reason,
    description,
    images,
    audioNote,
    patientId,
    organizationId,
    submittedBy,
    tx,
  }) {
    try {
      return await PrismaFactory.create({
        model: modelConstants.MODELS.RED_FLAG,
        data: {
          id,
          reason,
          description,
          images,
          audioNote,
          patientId,
          organizationId,
          submittedBy,
          type: SUBMISSION_FLAG_TYPE.MANUAL,
          flag: RISK_SCORE_THRESHOLDS.RED.flag,
          category: RISK_SCORE_THRESHOLDS.RED.category,
        },
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async voidEmergencyFlag({id, voidReason, voidedBy}) {
    try {
      const now = getCurrentTime();

      // Fetch active/acknowledged escalation + its open event before the
      // transaction so we know what to cancel without nesting a read inside a write.
      // bypassExtraQueries omitted — let PrismaFactory inject ACL/org scoping.
      const {doc: escalation} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {
          submissionFlagId: id,
          status: {
            notIn: [
              ESCALATION_STATUSES.RESOLVED.value,
              ESCALATION_STATUSES.EXPIRED.value,
              ESCALATION_STATUSES.FAILED.value,
              ESCALATION_STATUSES.VOIDED.value,
            ],
          },
        },
        fieldsInclusion: {
          include: {
            events: {
              where: {endedAt: null},
              orderBy: {assignedAt: 'desc'},
              take: 1,
            },
          },
        },
      });

      const openEvent = escalation?.events?.[0] || null;

      const persist = async ({tx}) => {
        const {success: flagSuccess, error: flagError} =
          await PrismaFactory.updateOne({
            model: modelConstants.MODELS.RED_FLAG,
            query: {id, voidedAt: null},
            data: {
              voidReason,
              status: SUBMISSION_FLAG_STATUS.VOIDED,
              voidedAt: now,
              voidedBy,
            },
            options: {bypassExtraQueries: true},
            tx,
          });

        if (!flagSuccess) {
          throw flagError instanceof Error
            ? flagError
            : new Error(flagError?.message || 'Failed to void red flag');
        }

        if (!escalation) return {success: true, voidedAt: now};

        // CAS on escalation status — if the TTL worker already moved this to a
        // terminal state between prefetch and here, treat it as a no-op rather
        // than overwriting terminal state.
        const {
          success: escSuccess,
          error: escError,
          areDocumentsUpdated: escalationVoided,
        } = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {
            id: escalation.id,
            status: {
              notIn: [
                ESCALATION_STATUSES.RESOLVED.value,
                ESCALATION_STATUSES.EXPIRED.value,
                ESCALATION_STATUSES.FAILED.value,
                ESCALATION_STATUSES.VOIDED.value,
              ],
            },
          },
          data: {status: ESCALATION_STATUSES.VOIDED.value},
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!escSuccess) {
          throw escError instanceof Error
            ? escError
            : new Error(escError?.message || 'Failed to void escalation');
        }

        // Escalation was already terminal — skip event update.
        if (!escalationVoided)
          return {success: true, voidedAt: now, escalationVoided: false};

        if (openEvent) {
          const {success: eventSuccess, error: eventError} =
            await PrismaFactory.updateOne({
              model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
              query: {id: openEvent.id, endedAt: null},
              data: {action: ESCALATION_ACTIONS.VOIDED.value, endedAt: now},
              options: {bypassExtraQueries: true},
              tx,
            });

          if (!eventSuccess) {
            throw eventError instanceof Error
              ? eventError
              : new Error(
                  eventError?.message || 'Failed to close escalation event'
                );
          }
        }

        return {success: true, voidedAt: now, escalationVoided: true};
      };

      const result = await wrapWithPrismaTransaction({
        fn: (txClient) => persist({tx: txClient}),
      });

      // Surface the escalation id so the caller can fan-out "flag voided"
      // notifications to everyone who was alerted during its life — but only
      // when the CAS actually voided it here. If the TTL worker already moved
      // the escalation to a terminal state, this call didn't void it and the
      // assignees must not be told it was.
      return Object.assign({}, result, {
        escalationId: result.escalationVoided ? escalation?.id || null : null,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listEmergencyFlags({
    submittedBy,
    caregiverUserId,
    patientId,
    flag,
    status,
    regionIds,
    nurseScope,
    caseManagerProfileId,
    search,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      // Default to YELLOW + RED; GREEN flags are not surfaced on this endpoint.
      // When a specific `flag` colour is requested, narrow to that colour + its category.
      const query = {};
      const threshold = flag ? RISK_SCORE_THRESHOLDS[flag] : null;
      if (threshold) {
        query.flag = threshold.flag;
        query.category = threshold.category;
      } else {
        query.flag = {in: EMERGENCY_FLAG_DEFAULT_FLAGS};
      }
      if (submittedBy) query.submittedBy = submittedBy;
      if (caregiverUserId) {
        query.patient = buildCaregiverPatientAccessClause({
          userId: caregiverUserId,
        });
      }
      if (patientId) query.patientId = patientId;
      if (Array.isArray(status) && status.length > 0) {
        query.status = {in: status};
      }
      if (nurseScope) {
        query.OR = buildNurseFlagScopeClauses({nurseScope});
      }
      if (caseManagerProfileId) {
        query.patient = {
          caseManagerPatients: {some: {caseManagerProfileId}},
        };
      }
      if (regionIds?.length) {
        query.patient = safeMerge({
          originalObj: query.patient || {},
          newObj: {county: {regionId: {in: regionIds}}},
        });
      }

      const nameClause = buildNameSearchClause({
        name: search,
        fields: [
          'patient.firstName',
          'patient.lastName',
          'submitter.firstName',
          'submitter.lastName',
        ],
      });
      if (nameClause) {
        Object.assign(query, nameClause);
      }

      const effectiveSort = sort ?? {createdAt: 'desc'};

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: {sort: effectiveSort},
      });

      // The escalation is read only for when the flag was accepted (the list
      // timers stop there); it is flattened to acceptedAt below so the list
      // rows don't carry an escalation the response factory treats as detail.
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.RED_FLAG,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion || {
          include: {escalation: {select: {acknowledgedAt: true}}},
        },
      });

      const docs = (result.docs || []).map(({escalation, ...emergencyFlag}) =>
        Object.assign(emergencyFlag, {
          acceptedAt: escalation?.acknowledgedAt || null,
        })
      );

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.RED_FLAG,
        query,
      });

      // Not safeMerge: it concatenates arrays, which would return the rows
      // twice (the originals plus the flattened copies).
      return Object.assign(result, {
        docs,
        count: countResult.success ? countResult.count : 0,
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }
};
