const {modelConstants} = require('../constants');

const CaseManagersServices = require('./caseManagersServices');

const EscalationAuditServices = require('./escalationAuditServices');

const EscalationPolicyServices = require('./escalationPolicyServices');

const FollowUpTasksServices = require('./followUpTasksServices');

const NotificationsServices = require('./notificationsServices');

const NursesServices = require('./nursesServices');

const PatientCareTeamServices = require('./patientCareTeamServices');
const SupervisoryVisitsServices = require('./supervisoryVisitsServices');

const UsersServices = require('./usersServices');

const {
  ACCEPTABLE_ESCALATION_LEVELS,
  ESCALATION_LEVELS,
  NURSE_ESCALATION_LEVELS,
  ESCALATION_STATUSES,
  ESCALATION_ACTIONS,
  OPEN_ESCALATION_STATUSES,
} = require('../constants/escalationConstants');

const {
  FLAG_TYPE_TO_DEFAULT_PRIORITY,
} = require('../constants/followUpTasksConstants');

const {
  NOTIFICATION_TEMPLATE_KEYS,
  NOTIFICATION_DOCUMENT_TYPES,
  NOTIFICATION_CHANNELS,
} = require('../constants/notificationConstants');

const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
} = require('../constants/submissionFlagConstants');

const {
  SUPERVISORY_VISIT_TYPES,
  SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
  SUPERVISORY_VISIT_CAREGIVER_ROLES,
} = require('../constants/supervisoryVisitsConstants');
const {PrismaFactory} = require('../factories');

const NotificationsHelpers = require('../helpers/notificationsHelpers');

const {
  scheduleEscalationExpiry,
} = require('../lib/bullMQ/producers/scheduleEscalationExpiry');

const logger = require('../middleware/loggerMiddleware');

const {flagSubmissionEvidenceSelect} = require('../utils/assessmentsUtils');
const {getCurrentTime, normalizeToISO} = require('../utils/dateUtils');

const {
  computeEscalationExpiresAt,
  getCaseManagerOverseerChannels,
  getCaseManagerTierChannels,
  getChannelsByAssignee,
  getPolicyLevelCandidates,
  resolveEscalationPolicyState,
} = require('../utils/escalationPolicyUtils');

const {
  notifyNextAssignee,
  notifyPreviousAssignee,
} = require('../utils/escalationUtils');

const {patientRecordSelect} = require('../utils/patientUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

// Maps a submission flag color to the FollowUpTask / SupervisoryVisit `flagType`
// integer (0 RED, 1 YELLOW); any other color falls back to 2 (other/manual).
const FLAG_COLOR_TO_FLAG_TYPE = {RED: 0, YELLOW: 1};

module.exports = class EscalationServices {
  /**
   * Best-effort overseer notification: tell the patient's case manager that a
   * flag was assigned/escalated to a nurse, so they stay informed while it sits
   * below them. Only fires for nurse-level landings (the CM is the assignee at
   * CASE_MANAGER and gets the assignee copy instead; ADMIN has no CM overseer)
   * and never double-notifies the CM when they are the assignee. Channels follow
   * the escalation's policy `steps` (see getCaseManagerOverseerChannels).
   */
  static async notifyCaseManagerOverseer({
    levelValue,
    steps,
    assigneeUserId,
    patientId,
    organizationId,
    templateKey,
    context = {},
    performedBy = null,
    submissionFlagId = null,
  }) {
    if (!NURSE_ESCALATION_LEVELS.includes(levelValue)) return;

    const overseerChannels = getCaseManagerOverseerChannels({
      steps,
      levelValue,
    });

    // The admin turned off every channel the case manager could be told on here.
    if (overseerChannels.length === 0) return;

    // Truly best-effort: this runs after the escalation transition has already
    // committed, so a case-manager lookup/notify failure must never bubble up and
    // make startEscalation/escalateToNextLevel report a false failure (which would
    // trigger worker retries against an already-advanced row).
    try {
      const {userId: caseManagerUserId} =
        await CaseManagersServices.resolveCaseManagerForPatient({
          patientId,
          organizationId,
        });

      if (!caseManagerUserId || caseManagerUserId === assigneeUserId) return;

      await NotificationsServices.notifyFromTemplate({
        templateKey,
        context,
        recipientId: caseManagerUserId,
        organizationId,
        performedBy,
        documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
        documentId: submissionFlagId,
        patientId,
        channels: overseerChannels,

        // Only what the admin removed counts as a policy block; the tier rule's
        // own limit (e.g. in-app only for a primary nurse) is NOT_REQUESTED.
        policyBlockedChannels: NotificationsHelpers.getPolicyBlockedChannels({
          allowedChannels: getCaseManagerTierChannels({levelValue}),
          grantedChannels: overseerChannels,
        }),
      });
    } catch (error) {
      logger.error(
        `[Escalation] failed to notify case-manager overseer for patient ${patientId}: ${error?.message || error}`
      );
    }
  }

  /** Start an escalation at the first staffed level of the organization's active policy for the flag color, pinning that policy version to the row so later policy edits never affect it; creates the row + initial ASSIGNED event. */
  static async startEscalation({
    submissionFlagId,
    patientId,
    organizationId,
    performedBy = null,
  }) {
    try {
      // Idempotent: submissionFlagId is @unique — return the existing escalation instead of duplicating it on re-entry.
      const {doc: existingEscalation} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {submissionFlagId},
        options: {bypassExtraQueries: true},
      });

      if (existingEscalation) {
        return {
          success: true,
          escalation: existingEscalation,
          alreadyEscalated: true,
        };
      }

      // Look up the submission flag's color — TTLs differ between RED and YELLOW. SubmissionFlag is the source of truth (we don't denormalize `flag` onto the escalation row since submissionFlagId already FKs to it).
      const {doc: submissionFlag} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG,
        query: {id: submissionFlagId},
        options: {bypassExtraQueries: true},
      });

      const flag = submissionFlag?.flag || null;

      if (!flag) {
        logger.error(
          `[Escalation] aborting — submission flag ${submissionFlagId} missing or has no color`
        );

        return {
          success: false,
          error: 'Submission flag missing or has no color',
        };
      }

      // The flow (step order + minutes) this escalation will follow for its whole life.
      const {
        success: policyResolved,
        policy,
        error: policyError,
      } = await EscalationPolicyServices.getActivePolicy({
        organizationId,
        flag,
      });

      if (!policyResolved) {
        logger.error(
          `[Escalation] failed to load the ${flag} escalation policy for organization ${organizationId}: ${policyError?.message || policyError}`
        );

        return {success: false, error: policyError};
      }

      // Fetch the patient's region — needed for the region-level cascade steps and persisted on the escalation row.
      const {
        success: patientFetched,
        doc: patient,
        error: patientFetchError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id: patientId, organizationId},
        fieldsInclusion: {include: {county: {select: {regionId: true}}}},
        options: {bypassExtraQueries: true},
      });

      if (!patientFetched) {
        logger.error(
          `[Escalation] failed to fetch patient ${patientId}: ${patientFetchError?.message || patientFetchError}`
        );

        return {success: false, error: patientFetchError};
      }

      // findOne answers {success: true, doc: null} for a row that is not there,
      // so a missing patient reaches here looking exactly like one with no
      // region. Separated deliberately: a patient we cannot find is a failure,
      // and escalating one to an admin would write a row against a patient id
      // that does not resolve.
      if (!patient) {
        logger.error(
          `[Escalation] aborting — patient ${patientId} not found in organization ${organizationId}`
        );

        return {success: false, error: 'Patient could not be found'};
      }

      const regionId = patient?.county?.regionId || null;

      // Without a region the nurse and case-manager levels have nobody to
      // resolve against, so the flag goes straight to the admin rather than
      // nowhere. Warn, not error: this is a handled state, not a failure.
      if (!regionId) {
        logger.warn(
          `[Escalation] patient ${patientId} has no region — starting at ADMIN`
        );
      }

      // Cascade from the policy's first step down to its terminal ADMIN step, landing on the first staffed slot. ADMIN is the terminal fallback even when unstaffed (status flips to FAILED).
      const {
        success: cascadeResolved,
        stepIndex: startStepIndex,
        level: startLevel,
        userOrgId: assigneeUserOrgId,
        userId: assigneeUserId,
        error: cascadeError,
      } = await this.resolveCascadingAssignee({
        steps: policy.steps,
        fromStepIndex: regionId ? 0 : policy.steps.length - 1,
        regionId,
        patientId,
        organizationId,
      });

      if (!cascadeResolved) {
        logger.error(
          `[Escalation] failed to resolve a starting assignee for patient ${patientId}: ${cascadeError?.message || cascadeError}`
        );

        return {success: false, error: cascadeError};
      }

      const now = getCurrentTime();

      // TTL comes from the policy step; the terminal ADMIN step (ttlMinutes=null) returns null — the row never expires and is excluded from the expiry cron.
      const expiresAt = computeEscalationExpiresAt({
        ttlMinutes: policy.steps[startStepIndex].ttlMinutes,
        now,
      });

      const status = assigneeUserOrgId
        ? ESCALATION_STATUSES.ACTIVE.value
        : ESCALATION_STATUSES.FAILED.value;

      // A FAILED escalation notifies nobody and never reaches an inbox, so the
      // flag is effectively dropped. Distinct prefix so it can be alerted on.
      if (!assigneeUserOrgId) {
        logger.error(
          `[EscalationUnassigned] flag ${submissionFlagId} reached ${startLevel.value} with nobody to assign it to`
        );
      }

      // Create the escalation row + initial ASSIGNED event atomically (event failure rolls back the row).
      const persistEscalationAndEvent = async ({tx: txInner}) => {
        const {
          success: escalationSuccess,
          doc: escalationDoc,
          error: escalationError,
        } = await PrismaFactory.create({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          data: {
            submissionFlagId,
            patientId,
            organizationId,
            regionId,
            policyId: policy.id,
            currentStepIndex: startStepIndex,
            currentLevel: startLevel.value,
            currentAssigneeId: assigneeUserOrgId,
            assignedAt: now,
            expiresAt,
            status,
          },
          options: {bypassExtraQueries: true},
          tx: txInner,
        });

        if (!escalationSuccess || !escalationDoc) {
          throw escalationError instanceof Error
            ? escalationError
            : new Error(
                escalationError?.message || 'Failed to create escalation row'
              );
        }

        const {
          success: eventSuccess,
          doc: eventDoc,
          error: eventError,
        } = await PrismaFactory.create({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
          data: {
            escalationId: escalationDoc.id,
            level: startLevel.value,
            assigneeId: assigneeUserOrgId,
            assignedAt: now,
            action: ESCALATION_ACTIONS.ASSIGNED.value,
          },
          options: {bypassExtraQueries: true},
          tx: txInner,
        });

        if (!eventSuccess) {
          throw eventError instanceof Error
            ? eventError
            : new Error(
                eventError?.message || 'Failed to create escalation event row'
              );
        }

        return {escalation: escalationDoc, event: eventDoc};
      };

      let escalation;
      let event;

      try {
        ({escalation, event} = await wrapWithPrismaTransaction({
          fn: (txClient) => persistEscalationAndEvent({tx: txClient}),
        }));
      } catch (persistError) {
        logger.error(
          `[Escalation] failed to persist escalation+event atomically: ${persistError?.message || persistError}`
        );

        return {success: false, error: persistError};
      }

      // Precise-expiry job: fires the level advance at the exact TTL moment
      // instead of the next sweep tick. Best-effort — the per-minute sweep
      // still catches anything this misses.
      if (status === ESCALATION_STATUSES.ACTIVE.value && expiresAt) {
        await scheduleEscalationExpiry({
          escalationId: escalation.id,
          expiresAt,
        });
      }

      await EscalationAuditServices.logStarted({
        escalation,
        submissionFlag,
        performedBy,
      });

      await EscalationAuditServices.logAssigned({
        escalation,
        level: startLevel.value,
        assigneeUserOrgId,
        expiresAt,
      });

      if (assigneeUserId && status === ESCALATION_STATUSES.ACTIVE.value) {
        notifyNextAssignee({assigneeUserId});

        // Persist an in-app notification for the first assignee. performedBy is
        // the raising user for a manual red flag, or null (SYSTEM) for a flag
        // auto-raised by a checklist submission. Best-effort — createNotification
        // swallows its own errors, so it never affects the escalation result.
        await NotificationsServices.notifyFromTemplate({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ASSIGNED,
          context: {flag},
          recipientId: assigneeUserId,
          organizationId,
          performedBy,
          documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
          documentId: submissionFlagId,
          patientId,

          // Only the channels the admin chose for this step ("Notify via").
          channels: policy.steps[startStepIndex].channels,
          policyBlockedChannels: NotificationsHelpers.getPolicyBlockedChannels({
            grantedChannels: policy.steps[startStepIndex].channels,
          }),
        });

        // Keep the patient's case manager informed when the flag lands on a
        // nurse-level assignee.
        await this.notifyCaseManagerOverseer({
          levelValue: startLevel.value,
          steps: policy.steps,
          assigneeUserId,
          patientId,
          organizationId,
          templateKey:
            NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ASSIGNED_CASE_MANAGER,
          context: {flag},
          performedBy,
          submissionFlagId,
        });
      }

      return {success: true, escalation, event};
    } catch (error) {
      logger.error(`[Escalation] unexpected error: ${error?.message || error}`);

      return {success: false, error};
    }
  }

  /** Resolve the assignee for a level → {success, userOrgId, userId, error}. Every level dispatches here; the cascade decides whether to advance based on the result. */
  static async resolveAssigneeForLevel({
    level,
    regionId,
    patientId,
    organizationId,
    alreadyAssignedIds = new Set(),
    tx,
  }) {
    switch (level) {
      case ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value:
        return NursesServices.resolvePatientPrimaryNurse({
          patientId,
          organizationId,
          tx,
        });
      case ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value:
        return NursesServices.resolveRegionPrimaryNurse({
          regionId,
          organizationId,
          alreadyAssignedIds,
          tx,
        });
      case ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value:
        return NursesServices.resolvePatientSecondaryNurse({
          patientId,
          organizationId,
          tx,
        });
      case ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value:
        return NursesServices.resolveRegionSecondaryNurse({
          regionId,
          organizationId,
          alreadyAssignedIds,
          tx,
        });
      case ESCALATION_LEVELS.CASE_MANAGER.value:
        return CaseManagersServices.resolveCaseManagerForPatient({
          patientId,
          organizationId,
          tx,
        });
      case ESCALATION_LEVELS.ADMIN.value:
        return UsersServices.resolveAdminForOrganization({
          organizationId,
          tx,
        });
      default:
        return UsersServices.resolveAdminForOrganization({
          organizationId,
          tx,
        });
    }
  }

  /** Walk the policy `steps` forward from `fromStepIndex` — each step's levels in order (patient's nurse, then the region's) — to the first staffed level whose assignee isn't already in `alreadyAssignedIds`. With `afterLevel`, the walk starts after that level of step `fromStepIndex` (where an expiring escalation goes next). Returns {success, stepIndex, level, userOrgId, userId}; bubbles hard resolver errors, and returns the terminal ADMIN level (possibly with a null assignee) if nothing earlier is staffed. */
  static async resolveCascadingAssignee({
    steps,
    fromStepIndex,
    afterLevel = null,
    regionId,
    patientId,
    organizationId,
    alreadyAssignedIds = new Set(),
    tx,
  }) {
    const candidates =
      getPolicyLevelCandidates({steps, fromStepIndex, afterLevel}) || [];

    for (const [index, {stepIndex, level}] of candidates.entries()) {
      const {success, userOrgId, userId, error} =
        await this.resolveAssigneeForLevel({
          level: level.value,
          regionId,
          patientId,
          organizationId,
          alreadyAssignedIds,
          tx,
        });

      if (!success) {
        return {success: false, stepIndex, level, error};
      }

      const isTerminal = index === candidates.length - 1;

      // Skip slots filled by someone already notified earlier in this escalation (e.g., patient & region share the same primary nurse).
      const isDuplicate = userOrgId ? alreadyAssignedIds.has(userOrgId) : false;
      const isUsableAssignee = Boolean(userOrgId) && !isDuplicate;

      // Stop at the first usable assignee, or at the terminal level where there's no further fall-through.
      if (isUsableAssignee || isTerminal) {
        return {success: true, stepIndex, level, userOrgId, userId};
      }
    }

    return {success: false, stepIndex: null, level: null};
  }

  /** Resolve the caller's next assigned escalation to handle: the *oldest* ACTIVE RED if any are assigned, otherwise the *oldest* ACTIVE YELLOW. Also returns the per-color active counts (redCount / yellowCount) so the caller can surface remaining-flag badges for both severities. */
  static async getAssignedEscalation({
    userId,
    organizationId,
    flagType,
    patientId,
  }) {
    try {
      // currentAssigneeId stores a UserOrganization.id, not a User.id — resolve
      // the caller's active membership for this org before matching.
      const {
        success: userOrgSuccess,
        doc: userOrg,
        error: userOrgError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
      });

      // A lookup *failure* must not masquerade as an empty inbox — that would
      // hide real assigned work and can flip the RED-vs-YELLOW priority below.
      if (!userOrgSuccess) {
        return {
          success: false,
          doc: null,
          redCount: 0,
          yellowCount: 0,
          error: userOrgError,
        };
      }

      if (!userOrg) {
        return {success: true, doc: null, redCount: 0, yellowCount: 0};
      }

      // Skip escalations whose window has already closed: a past expiresAt means
      // the expiry cron is about to advance the row to the next level / assignee,
      // so it is no longer this caller's actionable work and must not be surfaced
      // (nor counted) as their "next to handle" flag. Rows with a null expiresAt
      // never expire (RED / ADMIN-terminal) and must be preserved — filtering
      // them out would hide red flags entirely.
      const notExpired = {
        OR: [{expiresAt: null}, {expiresAt: {gt: getCurrentTime()}}],
      };

      // Accepted flags stay the caller's work until resolved, so they count.
      const baseQuery = {
        organizationId,
        status: {in: OPEN_ESCALATION_STATUSES},
        currentAssigneeId: userOrg.id,

        AND: [notExpired],
      };

      // Scoping to one patient makes both the surfaced flag and the counts
      // about that patient. Without it, the oldest flag across all patients
      // wins, so a patient page could only ever match the first-raised flag.
      if (patientId) {
        baseQuery.patientId = patientId;
      }

      // Count each severity independently so the FE can show both badges
      // regardless of which color we surface as the "next to handle" flag.
      const redCountResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: Object.assign({}, baseQuery, {
          submissionFlag: {flag: RISK_SCORE_THRESHOLDS.RED.flag},
        }),
      });

      const yellowCountResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: Object.assign({}, baseQuery, {
          submissionFlag: {flag: RISK_SCORE_THRESHOLDS.YELLOW.flag},
        }),
      });

      // Same rule for the counts: a failed count is an error, not zero.
      if (!redCountResult.success || !yellowCountResult.success) {
        return {
          success: false,
          doc: null,
          redCount: 0,
          yellowCount: 0,
          error: redCountResult.error || yellowCountResult.error,
        };
      }

      const redCount = redCountResult.count;
      const yellowCount = yellowCountResult.count;

      // Severities in descending priority, each paired with its active count.
      // The "next to handle" flag is the highest-priority severity that still
      // has active work. Pinning a flagType narrows the search to that one
      // severity; otherwise RED outranks YELLOW.
      const flagPriority = [
        {flag: RISK_SCORE_THRESHOLDS.RED.flag, count: redCount},
        {flag: RISK_SCORE_THRESHOLDS.YELLOW.flag, count: yellowCount},
      ];

      const candidates = flagType
        ? flagPriority.filter((entry) => entry.flag === flagType)
        : flagPriority;

      const targetFlag =
        candidates.find((entry) => entry.count > 0)?.flag || null;

      if (!targetFlag) {
        return {success: true, doc: null, redCount, yellowCount};
      }

      // "Very first raised" — oldest assignedAt is the most overdue and the one
      // the caller should handle next. take:1 keeps the payload small; the FE
      // refreshes after acknowledging to fetch the next one.
      const findResult = await PrismaFactory.find({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: Object.assign({}, baseQuery, {
          submissionFlag: {flag: targetFlag},
        }),
        fieldsInclusion: {
          include: {
            patient: {select: {firstName: true, lastName: true}},
            submissionFlag: {
              select: {
                id: true,
                flag: true,
                reason: true,
                description: true,
                submitter: {select: {firstName: true, lastName: true}},
              },
            },
          },
        },
        options: {
          bypassExtraQueries: true,
          take: 1,

          // Flags still on a deadline come before accepted ones (the enum
          // sorts ACTIVE before ACKNOWLEDGED), so an accepted flag never hides
          // one that is about to escalate.
          sort: [{status: 'asc'}, {assignedAt: 'asc'}],
        },
      });

      if (!findResult.success) {
        return {
          success: false,
          doc: null,
          redCount,
          yellowCount,
          error: findResult.error,
        };
      }

      return {
        success: true,
        doc: findResult.docs?.[0] || null,
        redCount,
        yellowCount,
      };
    } catch (error) {
      return {success: false, doc: null, redCount: 0, yellowCount: 0, error};
    }
  }

  /** Load full submission details for an escalation. Always returns the submissionFlag's basic fields + patient + submitter; for AUTO flags also includes the linked ChecklistSubmission with template, sections, questions, and answers in one round-trip. Scoped to the *caller's* assigned escalation: org-scoping alone is not enough (PrismaFactory's ACL context only injects organizationId), so we additionally match currentAssigneeId to the caller's active UserOrganization. Non-assignees get a null doc (→ 404). */
  static async getEscalationSubmissionDetails({
    escalationId,
    organizationId,
    userId,
  }) {
    try {
      // currentAssigneeId stores a UserOrganization.id — resolve the caller's
      // active membership so we can restrict the lookup to their own escalation.
      const {
        success: userOrgSuccess,
        doc: userOrg,
        error: userOrgError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
      });

      if (!userOrgSuccess) {
        return {success: false, doc: null, error: userOrgError};
      }

      // No active membership → caller can't be the assignee → not found.
      if (!userOrg) {
        return {success: true, doc: null};
      }

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {
          id: escalationId,
          organizationId,
          currentAssigneeId: userOrg.id,
        },
        fieldsInclusion: {
          include: {
            patient: {select: patientRecordSelect},
            submissionFlag: {
              select: {
                id: true,
                type: true,
                flag: true,
                reason: true,
                description: true,
                images: true,
                audioNote: true,
                createdAt: true,
                submitter: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
                submission: {select: flagSubmissionEvidenceSelect},
              },
            },
          },
        },
        options: {bypassExtraQueries: true},
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Every distinct user who was ever assigned an escalation, across all of its
   * events. Each event.assigneeId is a UserOrganization id, so we hop through
   * assignee.userId to get the underlying user. Used to notify everyone who
   * handled the flag at resolution time — including region-nurse fallbacks that
   * never sit on the patient's primary/secondary nurse fields.
   *
   * `channelsByUserId` gives each of them the channels of the policy step(s)
   * they held, from the policy version the escalation is pinned to, so
   * resolve/void notices follow the admin's "Notify via" settings. Empty when
   * the escalation's policy can't be read — callers then use their default.
   *
   * @returns {Promise<{success, userIds, channelsByUserId, error}>}
   */
  static async getEscalationAssigneeUserIds({escalationId}) {
    try {
      const [eventsResult, escalationResult] = await Promise.all([
        PrismaFactory.find({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
          query: {escalationId, assigneeId: {not: null}},
          fieldsInclusion: {
            include: {assignee: {select: {userId: true}}},
          },
          options: {bypassExtraQueries: true},
        }),
        PrismaFactory.findOne({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {id: escalationId},
          fieldsInclusion: {
            include: {
              currentStepIndex: true,
              policy: {select: {steps: true}},
              submissionFlag: {select: {flag: true}},
            },
          },
          options: {bypassExtraQueries: true},
        }),
      ]);

      if (!eventsResult.success) {
        return {
          success: false,
          userIds: [],
          channelsByUserId: {},
          error: eventsResult.error,
        };
      }

      const events = (eventsResult.docs || []).map((event) => ({
        level: event.level,
        userId: event.assignee?.userId || null,
      }));

      const userIds = Array.from(
        new Set(events.map((event) => event.userId).filter(Boolean))
      );

      const escalation = escalationResult.doc;

      const policyState = escalation
        ? resolveEscalationPolicyState({
            escalation,
            flag: escalation.submissionFlag?.flag,
          })
        : null;

      const channelsByUserId = policyState
        ? getChannelsByAssignee({steps: policyState.steps, events})
        : {};

      return {success: true, userIds, channelsByUserId};
    } catch (error) {
      return {success: false, userIds: [], channelsByUserId: {}, error};
    }
  }

  /** The caller accepts their assigned escalation: it flips to ACKNOWLEDGED (shown as Accepted) and its deadline is cleared, so the expiry job and the sweep (both match ACTIVE only) never advance it again — it stays with the caller until they resolve it. The flag flips to ACCEPTED. The open event stays open: it ends when the flag is resolved or voided. Only the current assignee may accept, and never at ADMIN (the last step has no deadline to stop). Returns {success, doc} (doc=null with notAssignee, alreadyClosed, expired or notAcceptable; doc=null alone when not found). */
  static async acceptEscalation({escalationId, organizationId, userId}) {
    try {
      // currentAssigneeId stores a UserOrganization.id — resolve the caller's
      // active membership so only the assignee can accept.
      const {
        success: userOrgSuccess,
        doc: userOrg,
        error: userOrgError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
      });

      if (!userOrgSuccess) {
        return {success: false, doc: null, error: userOrgError};
      }

      if (!userOrg) {
        return {success: true, doc: null};
      }

      const {
        success: findSuccess,
        doc: escalation,
        error: findError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {id: escalationId, organizationId},
        options: {bypassExtraQueries: true},
      });

      if (!findSuccess) {
        return {success: false, doc: null, error: findError};
      }

      if (!escalation) {
        return {success: true, doc: null};
      }

      if (escalation.currentAssigneeId !== userOrg.id) {
        return {success: true, doc: null, notAssignee: true};
      }

      if (escalation.status !== ESCALATION_STATUSES.ACTIVE.value) {
        return {success: true, doc: null, alreadyClosed: true};
      }

      if (!ACCEPTABLE_ESCALATION_LEVELS.includes(escalation.currentLevel)) {
        return {success: true, doc: null, notAcceptable: true};
      }

      // The deadline already passed: the expiry job is about to hand it to the
      // next level, so it is no longer the caller's to take.
      if (escalation.expiresAt && escalation.expiresAt <= getCurrentTime()) {
        return {success: true, doc: null, expired: true};
      }

      const now = getCurrentTime();

      const persist = async ({tx}) => {
        // CAS on the assignment snapshot, so an expiry job that moved the row
        // between our read and here wins and this accept becomes a no-op.
        const {
          success: casSuccess,
          error: casError,
          areDocumentsUpdated: accepted,
        } = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {
            id: escalation.id,
            status: ESCALATION_STATUSES.ACTIVE.value,
            currentLevel: escalation.currentLevel,
            currentAssigneeId: userOrg.id,
            expiresAt: escalation.expiresAt,
          },
          data: {
            status: ESCALATION_STATUSES.ACKNOWLEDGED.value,
            acknowledgedAt: now,
            acknowledgedById: userOrg.id,
            expiresAt: null,
          },
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!casSuccess) {
          throw casError instanceof Error
            ? casError
            : new Error(casError?.message || 'Failed to accept escalation');
        }

        if (!accepted) return {accepted: false};

        const {success: flagSuccess, error: flagError} =
          await PrismaFactory.updateOne({
            model: modelConstants.MODELS.SUBMISSION_FLAG,
            query: {id: escalation.submissionFlagId},
            data: {status: SUBMISSION_FLAG_STATUS.ACCEPTED},
            options: {bypassExtraQueries: true},
            tx,
          });

        if (!flagSuccess) {
          throw flagError instanceof Error
            ? flagError
            : new Error(flagError?.message || 'Failed to accept flag');
        }

        return {accepted: true};
      };

      const {accepted} = await wrapWithPrismaTransaction({
        fn: (txClient) => persist({tx: txClient}),
      });

      if (!accepted) {
        return {success: true, doc: null, alreadyClosed: true};
      }

      await EscalationAuditServices.logAccepted({
        escalation,
        acceptedByUserId: userId,
        expiresAt: escalation.expiresAt,
      });

      return {
        success: true,
        doc: {
          id: escalation.id,
          submissionFlagId: escalation.submissionFlagId,
          patientId: escalation.patientId,
          status: ESCALATION_STATUSES.ACKNOWLEDGED.value,
          acknowledgedAt: now,
        },
      };
    } catch (error) {
      logger.error(
        `[Escalation] failed to accept escalation ${escalationId}: ${error?.message || error}`
      );

      return {success: false, doc: null, error};
    }
  }

  /** Resolve the caller's assigned escalation: record the resolution response (actions taken, notes, optional follow-up / supervisory-visit scheduling), flip the SubmissionFlag and SubmissionFlagEscalation to RESOLVED, and close the open event with a RESOLVED audit event — all atomically. Self-scoped: only the current assignee (currentAssigneeId → caller's active UserOrganization) may resolve. Returns {success, doc} (doc=null with alreadyResolved when not ACTIVE, doc=null with expired when the assignment window has elapsed, doc=null without either when not found/not assignee). */
  static async resolveEscalation({
    escalationId,
    organizationId,
    userId,
    actions,
    notes,
    attachments = [],
    hasFollowUp,
    followUpDate,
    followUpDescription,
    followUpTitle,
    followUpPriority,
    followUpChecklistTemplateId,
    followUpAssigneeUserOrganizationId,
    hasSupervisoryVisit,
    supervisoryVisitStartAt,
    supervisoryVisitEndAt,
    supervisoryVisitAssigneeUserOrganizationId,
    supervisoryVisitCaregiverUserOrganizationIds,
    supervisoryVisitChecklistTemplateId,
    supervisoryInstructions,
  }) {
    try {
      // currentAssigneeId stores a UserOrganization.id — resolve the caller's
      // active membership so only the assignee can resolve their escalation.
      const {
        success: userOrgSuccess,
        doc: userOrg,
        error: userOrgError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
      });

      if (!userOrgSuccess) {
        return {success: false, doc: null, error: userOrgError};
      }

      // No active membership → caller can't be the assignee → not found.
      if (!userOrg) {
        return {success: true, doc: null};
      }

      // Verify the escalation exists in this org before checking assignment.
      // A separate existence check lets us distinguish "not found" from "found
      // but caller is not the current assignee" so we can surface a clear error.
      const {
        success: existsSuccess,
        doc: escalationExists,
        error: existsError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {id: escalationId, organizationId},
        fieldsInclusion: {select: {id: true, currentAssigneeId: true}},
        options: {bypassExtraQueries: true},
      });

      if (!existsSuccess) {
        return {success: false, doc: null, error: existsError};
      }

      if (!escalationExists) {
        return {success: true, doc: null};
      }

      // Escalation exists — guard against a non-assignee attempting to resolve it.
      if (escalationExists.currentAssigneeId !== userOrg.id) {
        return {success: true, doc: null, notAssignee: true};
      }

      // Load the caller's assigned escalation along with its latest still-open
      // event (endedAt=null) so we can close it in the same transaction.
      const {
        success: escalationSuccess,
        doc: escalation,
        error: escalationError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {
          id: escalationId,
          organizationId,
          currentAssigneeId: userOrg.id,
        },
        fieldsInclusion: {
          include: {
            events: {
              where: {endedAt: null},
              orderBy: {assignedAt: 'desc'},
              take: 1,
            },

            // Flag color drives the flagType recorded on the created records.
            submissionFlag: {
              select: {
                flag: true,
              },
            },
          },
        },
        options: {bypassExtraQueries: true},
      });

      if (!escalationSuccess) {
        return {success: false, doc: null, error: escalationError};
      }

      if (!escalation) {
        return {success: true, doc: null};
      }

      // Only open (ACTIVE or accepted) escalations are resolvable; anything else
      // is already terminal.
      if (!OPEN_ESCALATION_STATUSES.includes(escalation.status)) {
        return {success: true, doc: null, alreadyResolved: true};
      }

      // Even while still ACTIVE, an escalation whose window has elapsed no longer
      // belongs to the current assignee: the expiry cron is due to advance it to
      // the next level. Block the now-stale assignee from resolving it so the
      // chain isn't short-circuited after their window closed. (RED/ADMIN rows
      // carry a far-future sentinel expiresAt, so they never trip this guard.)
      if (escalation.expiresAt && escalation.expiresAt <= getCurrentTime()) {
        return {success: true, doc: null, expired: true};
      }

      // A supervisory visit goes to the explicit care-team assignee (nurse,
      // admin or case manager) or, by default, the patient's case manager.
      // Follow-up tasks go to the explicit care-team assignee or, by default,
      // that same case manager. Resolve everything up front so we fail fast
      // before flipping anything.
      let supervisoryAssigneeUserOrgId = null;
      let supervisoryAssigneeUserId = null;
      let followUpAssigneeUserOrgId = null;
      let followUpAssigneeUserId = null;

      if (hasSupervisoryVisit) {
        if (supervisoryVisitAssigneeUserOrganizationId) {
          const {
            success: memberSuccess,
            members,
            error: memberError,
          } = await PatientCareTeamServices.resolveCareTeamMembers({
            userOrgIds: [supervisoryVisitAssigneeUserOrganizationId],
            patientId: escalation.patientId,
            organizationId,
            roles: SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
          });

          if (!memberSuccess) {
            return {success: false, doc: null, error: memberError};
          }

          if (!members[0]) {
            return {success: true, doc: null, visitAssigneeNotInCareTeam: true};
          }

          supervisoryAssigneeUserOrgId = members[0].userOrgId;
          supervisoryAssigneeUserId = members[0].userId;
        } else {
          const {
            success: cmSuccess,
            userOrgId: cmUserOrgId,
            userId: cmUserId,
            error: cmError,
          } = await CaseManagersServices.resolveCaseManagerForPatient({
            patientId: escalation.patientId,
            organizationId,
          });

          if (!cmSuccess) {
            return {success: false, doc: null, error: cmError};
          }

          if (!cmUserOrgId) {
            return {success: true, doc: null, missingCaseManager: true};
          }

          supervisoryAssigneeUserOrgId = cmUserOrgId;
          supervisoryAssigneeUserId = cmUserId;
        }

        if (supervisoryVisitCaregiverUserOrganizationIds?.length) {
          const {
            success: caregiverSuccess,
            missingIds,
            error: caregiverError,
          } = await PatientCareTeamServices.resolveCareTeamMembers({
            userOrgIds: supervisoryVisitCaregiverUserOrganizationIds,
            patientId: escalation.patientId,
            organizationId,
            roles: SUPERVISORY_VISIT_CAREGIVER_ROLES,
          });

          if (!caregiverSuccess) {
            return {success: false, doc: null, error: caregiverError};
          }

          if (missingIds.length) {
            return {
              success: true,
              doc: null,
              visitCaregiverNotInCareTeam: true,
            };
          }
        }
      }

      if (hasFollowUp) {
        if (followUpAssigneeUserOrganizationId) {
          const {
            success: memberSuccess,
            member,
            error: memberError,
          } = await PatientCareTeamServices.resolveCareTeamMember({
            userOrgId: followUpAssigneeUserOrganizationId,
            patientId: escalation.patientId,
            organizationId,
          });

          if (!memberSuccess) {
            return {success: false, doc: null, error: memberError};
          }

          if (!member) {
            return {success: true, doc: null, assigneeNotInCareTeam: true};
          }

          followUpAssigneeUserOrgId = member.userOrgId;
          followUpAssigneeUserId = member.userId;
        } else {
          const {
            success: cmSuccess,
            userOrgId: cmUserOrgId,
            userId: cmUserId,
            error: cmError,
          } = await CaseManagersServices.resolveCaseManagerForPatient({
            patientId: escalation.patientId,
            organizationId,
          });

          if (!cmSuccess) {
            return {success: false, doc: null, error: cmError};
          }

          if (!cmUserOrgId) {
            return {success: true, doc: null, missingFollowUpAssignee: true};
          }

          followUpAssigneeUserOrgId = cmUserOrgId;
          followUpAssigneeUserId = cmUserId;
        }
      }

      // flagType records the flag color for the case manager (0 RED, 1 YELLOW).
      const flagType =
        FLAG_COLOR_TO_FLAG_TYPE[escalation.submissionFlag?.flag] ?? 2;

      const now = getCurrentTime();
      const openEvent = escalation.events?.[0] || null;

      const persist = async ({tx}) => {
        // CAS on the full assignment snapshot (status + level + assignee): only
        // the worker that still sees this escalation ACTIVE, at the same level,
        // and assigned to this caller wins. If the expiry cron reassigned it
        // between our read and here, the predicate matches 0 rows and we bail as
        // already-resolved — preventing a stale assignee from resolving a
        // now-reassigned escalation (and closing the wrong event).
        const {
          success: casSuccess,
          error: casError,
          areDocumentsUpdated: flipped,
        } = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {
            id: escalation.id,
            status: escalation.status,
            currentLevel: escalation.currentLevel,
            currentAssigneeId: userOrg.id,
          },
          data: {status: ESCALATION_STATUSES.RESOLVED.value},
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!casSuccess) {
          throw casError instanceof Error
            ? casError
            : new Error(casError?.message || 'Failed to resolve escalation');
        }

        if (!flipped) {
          return {response: null, raced: true};
        }

        // Mark the underlying flag RESOLVED.
        const {success: flagSuccess, error: flagError} =
          await PrismaFactory.updateOne({
            model: modelConstants.MODELS.SUBMISSION_FLAG,
            query: {id: escalation.submissionFlagId},
            data: {status: SUBMISSION_FLAG_STATUS.RESOLVED},
            options: {bypassExtraQueries: true},
            tx,
          });

        if (!flagSuccess) {
          throw flagError instanceof Error
            ? flagError
            : new Error(
                flagError?.message || 'Failed to resolve submission flag'
              );
        }

        // Close the open event with the RESOLVED action — this single update IS
        // the resolution event (the assignee's holding period ends here), mirroring
        // expireTerminalEscalation. Guard on endedAt: null so we only ever close a
        // still-open event. Only when there's no open event to close (an anomaly
        // for an ACTIVE row) do we create a standalone RESOLVED event so the audit
        // trail isn't left empty.
        if (openEvent) {
          const {success: closeSuccess, error: closeError} =
            await PrismaFactory.updateOne({
              model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
              query: {id: openEvent.id, endedAt: null},
              data: {action: ESCALATION_ACTIONS.RESOLVED.value, endedAt: now},
              tx,
            });

          if (!closeSuccess) {
            throw closeError instanceof Error
              ? closeError
              : new Error(closeError?.message || 'Failed to close open event');
          }
        } else {
          const {success: eventSuccess, error: eventError} =
            await PrismaFactory.create({
              model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
              data: {
                escalationId: escalation.id,
                level: escalation.currentLevel,
                assigneeId: userOrg.id,
                assignedAt: now,
                endedAt: now,
                action: ESCALATION_ACTIONS.RESOLVED.value,
              },
              options: {bypassExtraQueries: true},
              tx,
            });

          if (!eventSuccess) {
            throw eventError instanceof Error
              ? eventError
              : new Error(
                  eventError?.message || 'Failed to create resolved event'
                );
          }
        }

        // Persist the resolution response itself.
        const {
          success: responseSuccess,
          doc: responseDoc,
          error: responseError,
        } = await PrismaFactory.create({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_RESPONSE,
          data: {
            escalationId: escalation.id,
            submissionFlagId: escalation.submissionFlagId,
            organizationId,
            actions,
            notes: notes || null,
            attachments: Array.isArray(attachments) ? attachments : [],
            hasFollowUp: Boolean(hasFollowUp),
            followUpDate: hasFollowUp
              ? normalizeToISO({date: followUpDate})
              : null,
            followUpDescription: hasFollowUp
              ? followUpDescription || null
              : null,
            hasSupervisoryVisit: Boolean(hasSupervisoryVisit),
            supervisoryVisitDate: hasSupervisoryVisit
              ? normalizeToISO({date: supervisoryVisitStartAt})
              : null,
            supervisoryInstructions: hasSupervisoryVisit
              ? supervisoryInstructions || null
              : null,
            submittedBy: userId,
          },
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!responseSuccess) {
          throw responseError instanceof Error
            ? responseError
            : new Error(
                responseError?.message || 'Failed to create escalation response'
              );
        }

        // Schedule the follow-up task, linked to the flag it closes.
        let followUpTaskId = null;
        let supervisoryVisitId = null;

        if (hasFollowUp) {
          const {
            success: followUpSuccess,
            doc: followUpTask,
            error: followUpError,
          } = await FollowUpTasksServices.createTask({
            organizationId,
            patientId: escalation.patientId,
            assigneeUserOrganizationId: followUpAssigneeUserOrgId,
            title: followUpTitle,
            description: followUpDescription,
            priority:
              followUpPriority || FLAG_TYPE_TO_DEFAULT_PRIORITY[flagType],
            dueAt: followUpDate,
            checklistTemplateId: followUpChecklistTemplateId || null,
            submissionFlagId: escalation.submissionFlagId,
            flagType,
            createdBy: userId,
            tx,
          });

          if (!followUpSuccess) {
            throw followUpError instanceof Error
              ? followUpError
              : new Error(
                  followUpError?.message || 'Failed to create follow-up task'
                );
          }

          followUpTaskId = followUpTask?.id || null;
        }

        // Schedule a supervisory visit triggered by this alert when requested.
        if (hasSupervisoryVisit) {
          const {
            success: visitSuccess,
            doc: visit,
            error: visitError,
          } = await SupervisoryVisitsServices.createVisit({
            organizationId,
            patientId: escalation.patientId,
            assigneeUserOrganizationId: supervisoryAssigneeUserOrgId,
            checklistTemplateId: supervisoryVisitChecklistTemplateId,
            visitType: SUPERVISORY_VISIT_TYPES.triggered.value,
            description: supervisoryInstructions,
            scheduledStartAt: supervisoryVisitStartAt,
            scheduledEndAt: supervisoryVisitEndAt,
            submissionFlagId: escalation.submissionFlagId,
            caregiverUserOrganizationIds:
              supervisoryVisitCaregiverUserOrganizationIds || [],
            flagType,
            createdBy: userId,
            tx,
          });

          if (!visitSuccess) {
            throw visitError instanceof Error
              ? visitError
              : new Error(
                  visitError?.message || 'Failed to create supervisory visit'
                );
          }

          supervisoryVisitId = visit?.id || null;
        }

        return {
          response: responseDoc,
          followUpTaskId,
          supervisoryVisitId,
          raced: false,
        };
      };

      const {response, followUpTaskId, supervisoryVisitId, raced} =
        await wrapWithPrismaTransaction({
          fn: (txClient) => persist({tx: txClient}),
        });

      if (raced) {
        return {success: true, doc: null, alreadyResolved: true};
      }

      // Expose patientId (notification fan-out to the care team), the flag id,
      // and the created task/visit ids so the controller can attach navigation
      // targets to the notifications without re-fetching anything.
      return {
        success: true,
        doc: response,
        patientId: escalation.patientId,
        submissionFlagId: escalation.submissionFlagId,
        flag: escalation.submissionFlag?.flag || null,
        followUpTaskId,
        followUpAssigneeUserId,
        supervisoryVisitId,
        supervisoryVisitAssigneeUserId: supervisoryAssigneeUserId,
      };
    } catch (error) {
      logger.error(
        `[Escalation] failed to resolve escalation ${escalationId}: ${error?.message || error}`
      );

      return {success: false, doc: null, error};
    }
  }

  /** Fetch ACTIVE, expired escalations below ADMIN, each with its latest still-open event (endedAt=null) for closing in one round-trip. */
  static async findExpiredEscalations() {
    const now = getCurrentTime();

    return PrismaFactory.find({
      model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
      query: {
        status: ESCALATION_STATUSES.ACTIVE.value,

        // ADMIN is listed for completeness, but ADMIN rows carry a null
        // expiresAt (terminal, no TTL) so the `expiresAt <= now` predicate below
        // naturally filters them out — null never matches lte.
        currentLevel: {
          in: [
            ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value,
            ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value,
            ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value,
            ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value,
            ESCALATION_LEVELS.CASE_MANAGER.value,
            ESCALATION_LEVELS.ADMIN.value,
          ],
        },
        expiresAt: {lte: now},
      },
      fieldsInclusion: {
        include: {
          events: {
            where: {endedAt: null},
            orderBy: {assignedAt: 'desc'},
            take: 1,
            include: {
              // Pull the prior assignee's userId so escalateToNextLevel can socket-notify them without an extra query.
              assignee: {select: {userId: true}},
            },
          },

          submissionFlag: {select: {flag: true}},

          // The pinned policy version + step position drive where it goes next.
          currentStepIndex: true,
          policy: {select: {steps: true}},
        },
      },
      options: {bypassExtraQueries: true},
    });
  }

  /** CAS-advance the escalation (only if still ACTIVE at its prior level), then close the old event and create the new one — all in `tx`. Returns {advanced:false} on a lost race, else {advanced:true, newEvent}. */
  static async persistEscalationTransition({
    escalation,
    previousEvent,
    nextLevel,
    nextStepIndex,
    assigneeUserOrgId,
    newStatus,
    now,
    newExpiresAt,
    tx,
  }) {
    // Compare-and-swap: only the worker that still sees the prior (ACTIVE, currentLevel) wins; a loser matches 0 rows and skips the rest.
    const {
      success: casSuccess,
      error: casError,
      areDocumentsUpdated: advanced,
    } = await PrismaFactory.updateMany({
      model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
      query: {
        id: escalation.id,
        status: ESCALATION_STATUSES.ACTIVE.value,
        currentLevel: escalation.currentLevel,
      },
      data: {
        currentLevel: nextLevel.value,
        currentStepIndex: nextStepIndex,
        currentAssigneeId: assigneeUserOrgId,
        assignedAt: now,
        expiresAt: newExpiresAt,
        status: newStatus,
      },
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!casSuccess) {
      throw casError instanceof Error
        ? casError
        : new Error(casError?.message || 'Failed to advance escalation row');
    }

    // Lost the race — another worker advanced it; bail as a no-op without touching events.
    if (!advanced) {
      return {advanced: false};
    }

    const {success: closePrevSuccess, error: closePrevError} =
      await PrismaFactory.updateOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
        query: {id: previousEvent.id},
        data: {
          action: ESCALATION_ACTIONS.ESCALATED.value,
          endedAt: now,
        },
        tx,
      });

    if (!closePrevSuccess) {
      throw closePrevError instanceof Error
        ? closePrevError
        : new Error(
            closePrevError?.message || 'Failed to close previous event'
          );
    }

    const {
      success: createEventSuccess,
      doc: newEvent,
      error: createEventError,
    } = await PrismaFactory.create({
      model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
      data: {
        escalationId: escalation.id,
        level: nextLevel.value,
        assigneeId: assigneeUserOrgId,
        assignedAt: now,
        action: ESCALATION_ACTIONS.ASSIGNED.value,
      },
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!createEventSuccess) {
      throw createEventError instanceof Error
        ? createEventError
        : new Error(
            createEventError?.message || 'Failed to create next-level event'
          );
    }

    return {advanced: true, newEvent};
  }

  /** Escalate one expired escalation to the next level of the policy version it is pinned to (skipping unstaffed/duplicate levels down to ADMIN), in a single transaction, notifying only after commit. Expiry moves to the next step: a patient's nurse who doesn't respond hands over to the next step, never to the region's nurse (the region's nurse is only used when the patient has no nurse for that tier). If the row is already on the last level, dispatches to expireTerminalEscalation instead. */
  static async escalateToNextLevel({escalation, previousEvent}) {
    try {
      const flag = escalation.submissionFlag?.flag || null;

      if (!flag) {
        // The cron's include should have populated this; if it didn't, we can't pick the flow. Bail loudly so the row is left for the next tick instead of silently advancing with a wrong expiresAt.
        return {
          success: false,
          error: new Error(
            `Escalation ${escalation.id} is missing submissionFlag.flag`
          ),
        };
      }

      // The flow this escalation was started on (never the organization's current
      // policy — a policy edit must not change flags already escalating).
      const policyState = resolveEscalationPolicyState({escalation, flag});

      if (!policyState || policyState.currentStepIndex < 0) {
        return {
          success: false,
          error: new Error(
            `Escalation ${escalation.id} (${escalation.currentLevel}) could not be placed on an escalation policy step`
          ),
        };
      }

      const {steps, currentStepIndex} = policyState;

      // Where the flow goes after the level it's on now: the following steps
      // (a patient's nurse who didn't respond is not followed by the region's
      // nurse of the same step).
      const remainingCandidates = getPolicyLevelCandidates({
        steps,
        fromStepIndex: currentStepIndex,
        afterLevel: escalation.currentLevel,
      });

      if (!remainingCandidates) {
        return {
          success: false,
          error: new Error(
            `Escalation ${escalation.id} is at ${escalation.currentLevel}, which is not a level of policy step ${currentStepIndex}`
          ),
        };
      }

      // Nothing after it → row is on the terminal ADMIN level. Defensive: ADMIN
      // rows carry a null expiresAt so findExpiredEscalations never surfaces them
      // here, but if one ever did we transition it to EXPIRED rather than advancing.
      if (remainingCandidates.length === 0) {
        return this.expireTerminalEscalation({escalation, previousEvent});
      }

      // Pull every prior assignee on this escalation so the cascade can skip
      // anyone already notified at an earlier level (e.g., the patient's primary
      // nurse and the region's primary nurse are the same person).
      const {docs: priorEvents = []} = await PrismaFactory.find({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
        query: {escalationId: escalation.id, assigneeId: {not: null}},
        options: {bypassExtraQueries: true},
      });

      const alreadyAssignedIds = new Set(
        priorEvents.map((event) => event.assigneeId).filter(Boolean)
      );

      // Fall through unstaffed + duplicate levels; `nextLevel` is the level we land on.
      const {
        success: assigneeResolved,
        stepIndex: landedStepIndex,
        level: nextLevel,
        userOrgId: assigneeUserOrgId,
        userId: assigneeUserId,
        error: assigneeResolveError,
      } = await this.resolveCascadingAssignee({
        steps,
        fromStepIndex: currentStepIndex,
        afterLevel: escalation.currentLevel,
        regionId: escalation.regionId,
        patientId: escalation.patientId,
        organizationId: escalation.organizationId,
        alreadyAssignedIds,
      });

      // Assignee lookup failed (transient DB error) — don't advance; leave the row for the next tick to retry.
      if (!assigneeResolved) {
        return {
          success: false,
          error:
            assigneeResolveError ||
            new Error(
              `Failed to resolve next assignee for escalation ${escalation.id}`
            ),
        };
      }

      const now = getCurrentTime();

      // TTL comes from the step we landed on; the terminal ADMIN step returns null, so the row never expires once it lands there.
      const newExpiresAt = computeEscalationExpiresAt({
        ttlMinutes: steps[landedStepIndex].ttlMinutes,
        now,
      });

      const newStatus = assigneeUserOrgId
        ? ESCALATION_STATUSES.ACTIVE.value
        : ESCALATION_STATUSES.FAILED.value;

      const {advanced} = await wrapWithPrismaTransaction({
        fn: (txClient) =>
          this.persistEscalationTransition({
            escalation,
            previousEvent,
            nextLevel,
            nextStepIndex: landedStepIndex,
            assigneeUserOrgId,
            newStatus,
            now,
            newExpiresAt,
            tx: txClient,
          }),
      });

      // Another worker already advanced this — benign no-op: don't notify or count it.
      if (!advanced) {
        return {success: true, skipped: true};
      }

      await EscalationAuditServices.logEscalated({
        escalation,
        previousEvent,
        nextLevel,
        assigneeUserOrgId,
        newStatus,
      });

      await EscalationAuditServices.logAssigned({
        escalation,
        level: nextLevel.value,
        assigneeUserOrgId,
        expiresAt: newExpiresAt,
      });

      // Precise-expiry job for the level we just landed on (null newExpiresAt
      // at terminal ADMIN is a no-op inside the producer). Best-effort — the
      // per-minute sweep still catches anything this misses.
      if (newStatus === ESCALATION_STATUSES.ACTIVE.value) {
        await scheduleEscalationExpiry({
          escalationId: escalation.id,
          expiresAt: newExpiresAt,
        });
      }

      // Two emits on a successful advance: tell the prior assignee the flag moved off them, and tell the new assignee one was raised. Order is informational only — sockets are best-effort.
      const previousAssigneeUserId = previousEvent.assignee?.userId || null;

      notifyPreviousAssignee({previousAssigneeUserId});

      if (assigneeUserId && newStatus === ESCALATION_STATUSES.ACTIVE.value) {
        notifyNextAssignee({assigneeUserId});
      }

      // Persist in-app notifications for the advance. Escalation is driven by the
      // TTL cron, so performedBy stays null (SYSTEM). Best-effort — each call
      // swallows its own errors and never affects the escalation result.
      if (previousAssigneeUserId) {
        await NotificationsServices.notifyFromTemplate({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_AWAY,
          context: {flag},
          recipientId: previousAssigneeUserId,
          organizationId: escalation.organizationId,
          documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
          documentId: escalation.submissionFlagId,
          patientId: escalation.patientId,

          // The channels of the step the previous assignee was on ("Notify via"),
          // minus SMS: they already got the assignment SMS, so the "escalated
          // away" message stays on in-app / email only.
          channels: steps[currentStepIndex].channels.filter(
            (channel) => channel !== NOTIFICATION_CHANNELS.SMS
          ),
          policyBlockedChannels: NotificationsHelpers.getPolicyBlockedChannels({
            grantedChannels: steps[currentStepIndex].channels,
          }),
        });
      }

      if (assigneeUserId && newStatus === ESCALATION_STATUSES.ACTIVE.value) {
        await NotificationsServices.notifyFromTemplate({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_TO_YOU,
          context: {flag},
          recipientId: assigneeUserId,
          organizationId: escalation.organizationId,
          documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
          documentId: escalation.submissionFlagId,
          patientId: escalation.patientId,

          // Only the channels the admin chose for the step it landed on ("Notify via").
          channels: steps[landedStepIndex].channels,
          policyBlockedChannels: NotificationsHelpers.getPolicyBlockedChannels({
            grantedChannels: steps[landedStepIndex].channels,
          }),
        });

        // Keep the patient's case manager informed while the flag is still on a
        // nurse-level assignee. Escalation is cron-driven → performedBy stays null.
        await this.notifyCaseManagerOverseer({
          levelValue: nextLevel.value,
          steps,
          assigneeUserId,
          patientId: escalation.patientId,
          organizationId: escalation.organizationId,
          templateKey:
            NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_CASE_MANAGER,

          // Pass the flag color so the CM email renders the real severity
          // (Yellow/Red) instead of falling back to the "Red" default.
          context: {flag},
          submissionFlagId: escalation.submissionFlagId,
        });
      }

      return {success: true};
    } catch (error) {
      return {success: false, error};
    }
  }

  /** Terminal-level expiry path — CAS-flips status ACTIVE→EXPIRED and closes the open event with action=EXPIRED. No socket emit (the admin is already notified; this is end-of-cycle). Defensive only: ADMIN rows carry a null expiresAt and are filtered out of findExpiredEscalations, so this is not reached on the normal cron path. */
  static async expireTerminalEscalation({escalation, previousEvent}) {
    try {
      const now = getCurrentTime();

      const transition = async ({tx: txInner}) => {
        // Compare-and-swap on status + currentLevel; the loser matches 0 rows and bails as a no-op.
        const {
          success: casSuccess,
          error: casError,
          areDocumentsUpdated: expired,
        } = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {
            id: escalation.id,
            status: ESCALATION_STATUSES.ACTIVE.value,
            currentLevel: escalation.currentLevel,
          },
          data: {status: ESCALATION_STATUSES.EXPIRED.value},
          options: {bypassExtraQueries: true},
          tx: txInner,
        });

        if (!casSuccess) {
          throw casError instanceof Error
            ? casError
            : new Error(
                casError?.message || 'Failed to expire terminal escalation row'
              );
        }

        if (!expired) {
          return {expired: false};
        }

        const {success: closeSuccess, error: closeError} =
          await PrismaFactory.updateOne({
            model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
            query: {id: previousEvent.id},
            data: {
              action: ESCALATION_ACTIONS.EXPIRED.value,
              endedAt: now,
            },
            tx: txInner,
          });

        if (!closeSuccess) {
          throw closeError instanceof Error
            ? closeError
            : new Error(
                closeError?.message ||
                  'Failed to close terminal escalation event'
              );
        }

        return {expired: true};
      };

      const {expired} = await wrapWithPrismaTransaction({
        fn: (txClient) => transition({tx: txClient}),
      });

      if (!expired) {
        return {success: true, skipped: true};
      }

      return {success: true};
    } catch (error) {
      return {success: false, error};
    }
  }

  /** Flip an ACTIVE, expired escalation with no open event to FAILED (CAS-gated) so it stops being re-fetched/skipped every tick. */
  static async failOrphanEscalation({escalation}) {
    const {success, error, areDocumentsUpdated} =
      await PrismaFactory.updateMany({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {id: escalation.id, status: ESCALATION_STATUSES.ACTIVE.value},
        data: {status: ESCALATION_STATUSES.FAILED.value},
        options: {bypassExtraQueries: true},
      });

    if (!success) {
      logger.error(
        `[Escalation] failed to mark orphan escalation ${escalation.id} as FAILED: ${error?.message || error}`
      );

      return;
    }

    // Only the worker that actually flipped it logs; the loser matches 0 rows and stays quiet.
    if (areDocumentsUpdated) {
      logger.error(
        `[Escalation] escalation ${escalation.id} (${escalation.currentLevel}) has no open event — marked FAILED to break the retry loop`
      );
    }
  }

  /** Find every expired escalation and bump each to its next level; one row's failure doesn't abort the batch. Returns {success, processed, error?}. */
  /**
   * Precise-expiry path: advance a single escalation the moment its TTL
   * lapses (driven by the delayed job scheduled at assignment time). The
   * query re-checks state at fire time — if the row was resolved, voided or
   * already advanced (its expiresAt moved into the future), nothing matches
   * and this is a benign no-op; the new level's own delayed job takes over.
   * The per-minute sweep remains the safety net for lost jobs.
   */
  static async processEscalationById({escalationId}) {
    try {
      if (!escalationId) {
        return {success: false, error: new Error('escalationId is required')};
      }

      const now = getCurrentTime();

      const {
        success: findSuccess,
        doc: escalation,
        error: findError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {
          id: escalationId,
          status: ESCALATION_STATUSES.ACTIVE.value,
          expiresAt: {lte: now},
        },
        fieldsInclusion: {
          include: {
            events: {
              where: {endedAt: null},
              orderBy: {assignedAt: 'desc'},
              take: 1,
              include: {
                assignee: {select: {userId: true}},
              },
            },

            submissionFlag: {select: {flag: true}},

            // The pinned policy version + step position drive where it goes next.
            currentStepIndex: true,
            policy: {select: {steps: true}},
          },
        },
        options: {bypassExtraQueries: true},
      });

      if (!findSuccess) {
        return {success: false, error: findError};
      }

      if (!escalation) {
        return {success: true, skipped: true};
      }

      const previousEvent = escalation.events?.[0];

      // Orphan row (no open event): mark it FAILED and report a clean skip —
      // failOrphanEscalation resolves to undefined, which would break the
      // worker's destructuring if returned directly.
      if (!previousEvent) {
        await this.failOrphanEscalation({escalation});

        return {success: true, skipped: true};
      }

      return this.escalateToNextLevel({escalation, previousEvent});
    } catch (error) {
      logger.error(
        `[Escalation] processEscalationById failed for ${escalationId}: ${error?.message || error}`
      );

      return {success: false, error};
    }
  }

  static async processEscalations() {
    try {
      const {
        success: findSuccess,
        docs: expired = [],
        error: findError,
      } = await this.findExpiredEscalations();

      if (!findSuccess) {
        return {success: false, processed: 0, error: findError};
      }

      if (expired.length === 0) {
        return {success: true, processed: 0};
      }

      let processed = 0;
      for (const escalation of expired) {
        const previousEvent = escalation.events?.[0];

        if (!previousEvent) {
          await this.failOrphanEscalation({escalation});
          continue;
        }

        const {
          success: escalateSuccess,
          skipped,
          error: escalateError,
        } = await this.escalateToNextLevel({
          escalation,
          previousEvent,
        });

        if (escalateSuccess) {
          if (!skipped) {
            processed += 1;
          }
        } else {
          logger.error(
            `[Escalation] failed to escalate ${escalation.id} (${escalation.currentLevel}): ${escalateError?.message || escalateError}`
          );
        }
      }

      return {success: true, processed};
    } catch (error) {
      logger.error(
        `[Escalation] processEscalations failed: ${error?.message || error}`
      );

      return {success: false, processed: 0, error};
    }
  }
};
