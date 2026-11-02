const {modelConstants} = require('../constants');

const {MAX_TASK_EVIDENCE_FILES} = require('../constants/file');

const {
  NOTIFICATION_TEMPLATE_KEYS,
} = require('../constants/notificationConstants');

const {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
  SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,

  // SUPERVISORY_VISIT_REOPENABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_TYPES,
  SUPERVISORY_VISIT_SORT_FIELDS,
  SUPERVISORY_VISIT_EVENT_TYPES,
  SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
} = require('../constants/supervisoryVisitsConstants');

const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {
  WORK_ITEM_EVIDENCE_FIELD_NAME,
} = require('../constants/workItemConstants');

const {
  GeneralErrorsFactories,
  SupervisoryVisitsErrorsFactories,
  SupervisoryVisitsResponsesFactories,
  PrismaFactory,
} = require('../factories');

const {
  FollowUpTasksServices,
  PatientCareTeamServices,
  PatientsServices,
} = require('../services');
const SupervisoryVisitsServices = require('../services/supervisoryVisitsServices');

const {
  ensurePatientAssignedToCaseManager,
} = require('../utils/caseManagerPatientAccessUtils');

const {getCurrentTime} = require('../utils/dateUtils');
const {validateAssignee} = require('../utils/followUpTaskAccessUtils');
const {notifyTaskEvent} = require('../utils/followUpTaskNotificationUtils');
const {getListParams, buildOrderByClause} = require('../utils/general');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const {
  resolveSupervisoryVisitActor,
  buildSupervisoryVisitScopeClause,
  assertCanManageVisit,

  // assertCanReopenVisit,
  assertCanFileVisit,
  assertCanReviewVisit,
  approvesOnFiling,
  validateVisitAssignee,
  validateCaregiversPresent,
} = require('../utils/supervisoryVisitAccessUtils');

const {recordVisitEvent} = require('../utils/supervisoryVisitEventUtils');

const {
  notifyVisitEvent,
  getAssigneeUserId,
  getOriginalAssigneeUserId,
  getVisitCaregiverUserIds,
  getVisitReviewerUserIds,
} = require('../utils/supervisoryVisitNotificationUtils');

const {
  prepareVisitAnswers,
  uploadVisitEvidence,
  cleanupVisitEvidence,
} = require('../utils/supervisoryVisitUtils');

const {
  assertActiveFollowUpTemplate,
  assertActiveVisitTemplate,
} = require('../utils/workItemTemplateUtils');

const CAREGIVERS_FIELD = 'caregiverUserOrganizationIds';
const ASSIGNEE_FIELD = 'assigneeUserOrganizationId';

const EDITABLE_FIELDS = [
  'visitType',
  'visitTypeOther',
  'description',
  ASSIGNEE_FIELD,
  'checklistTemplateId',
  'scheduledStartAt',
  'scheduledEndAt',
  CAREGIVERS_FIELD,
];

const sortedIds = ({ids}) => Array.from(new Set(ids || [])).sort();

const isSameValue = ({a, b}) => {
  if (a instanceof Date || b instanceof Date)
    return new Date(a).getTime() === new Date(b).getTime();
  if (Array.isArray(a) || Array.isArray(b))
    return (
      JSON.stringify(sortedIds({ids: a})) ===
      JSON.stringify(sortedIds({ids: b}))
    );

  return (a ?? null) === (b ?? null);
};

const getCaregiverIds = ({visit}) =>
  (visit.caregivers || []).map((entry) => entry.userOrganizationId);

const ensureStatusIn = ({visit, statuses}) => {
  if (!statuses.includes(visit.status))
    throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();
};

const ensureWindow = ({scheduledStartAt, scheduledEndAt}) => {
  if (new Date(scheduledEndAt) <= new Date(scheduledStartAt))
    throw SupervisoryVisitsErrorsFactories.invalidScheduleErr();
};

async function loadVisitOrThrow({id, actor, details = false}) {
  const scopeClause = buildSupervisoryVisitScopeClause({actor});

  const {success, doc: visit} = details
    ? await SupervisoryVisitsServices.getVisitDetails({id, scopeClause})
    : await SupervisoryVisitsServices.getVisitById({id, scopeClause});

  if (!success || !visit) throw SupervisoryVisitsErrorsFactories.notFoundErr();

  return visit;
}

async function respondWithDetails({id, actor, respond}) {
  const {doc: visit} = await SupervisoryVisitsServices.getVisitDetails({
    id,
    scopeClause: buildSupervisoryVisitScopeClause({actor}),
  });

  return respond({visit});
}

// Everyone the assignee and caregivers should hear from on a lifecycle change.
const getParticipantUserIds = ({visit}) =>
  [getAssigneeUserId({visit}), visit.createdBy].concat(
    getVisitCaregiverUserIds({visit})
  );

// Queued follow-ups are validated before the visit transaction so a bad
// assignee never leaves a half-filed visit behind.
async function prepareQueuedFollowUps({followUps, visit, actor}) {
  if (followUps.length > SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS)
    throw SupervisoryVisitsErrorsFactories.tooManyQueuedFollowUpsErr({
      maxAllowed: SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
    });

  const prepared = [];

  for (const followUp of followUps) {
    const assignee = await validateAssignee({
      assigneeUserOrganizationId: followUp.assigneeUserOrganizationId,
      patientId: visit.patientId,
      organizationId: actor.organizationId,
    });

    if (followUp.checklistTemplateId)
      await assertActiveFollowUpTemplate({
        checklistTemplateId: followUp.checklistTemplateId,
        organizationId: actor.organizationId,
      });

    prepared.push({followUp, assignee});
  }

  return prepared;
}

module.exports = class SupervisoryVisitsController {
  // GET /supervisory-visits/assignees?patientId=&roles= -- the patient's care
  // team; `roles` narrows it (nurse pickers vs caregivers present).
  static async listAssignees(req, res, next) {
    const {patientId, roles} = req.query;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });

    const members = await PatientCareTeamServices.listAssigneesForActor({
      actor,
      patientId,
      roles: roles
        ? String(roles)
            .split(',')
            .map((role) => role.trim())
        : null,
    });

    return SupervisoryVisitsResponsesFactories.assigneesListed({
      assignees: members,
    });
  }

  static async createVisit(req, res, next) {
    const {
      patientId,
      visitType,
      visitTypeOther,
      description,
      checklistTemplateId,
      scheduledStartAt,
      scheduledEndAt,
      submissionFlagId,
      caregiverUserOrganizationIds = [],
    } = req.body;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });

    // Non-admins default to themselves; admins must pick someone.
    const assigneeUserOrganizationId =
      req.body.assigneeUserOrganizationId ||
      (actor.role === SYSTEM_ROLES.admin.value ? null : actor.userOrgId);

    if (!assigneeUserOrganizationId)
      throw GeneralErrorsFactories.badRequestErr({
        customMessage: 'assigneeUserOrganizationId is required',
      });

    const {doc: patient} = await PatientsServices.getPatientById({
      id: patientId,
    });

    if (!patient)
      throw GeneralErrorsFactories.badRequestErr({
        customMessage: 'Patient not found',
      });

    await ensurePatientAssignedToCaseManager({
      caseManagerProfileId: actor.caseManagerProfileId,
      patientId,
    });

    const assignee = await validateVisitAssignee({
      assigneeUserOrganizationId,
      patientId,
      organizationId: actor.organizationId,
    });

    const caregivers = await validateCaregiversPresent({
      caregiverUserOrganizationIds,
      patientId,
      organizationId: actor.organizationId,
    });

    await assertActiveVisitTemplate({
      checklistTemplateId,
      organizationId: actor.organizationId,
    });

    if (submissionFlagId) {
      const {doc: flag} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG,
        query: {id: submissionFlagId, patientId},
      });

      if (!flag)
        throw GeneralErrorsFactories.badRequestErr({
          customMessage: 'Linked alert not found for this patient',
        });
    }

    const {doc: existingVisit} =
      await SupervisoryVisitsServices.getVisitByUniqueKey({
        patientId,
        assigneeUserOrganizationId,
        scheduledStartAt,
      });

    if (existingVisit)
      throw SupervisoryVisitsErrorsFactories.duplicateVisitErr();

    const {doc: visit, error} = await SupervisoryVisitsServices.createVisit({
      organizationId: actor.organizationId,
      patientId,
      assigneeUserOrganizationId,
      checklistTemplateId,
      visitType,
      visitTypeOther:
        visitType === SUPERVISORY_VISIT_TYPES.other.value
          ? visitTypeOther
          : null,
      description,
      scheduledStartAt,
      scheduledEndAt,
      submissionFlagId,
      caregiverUserOrganizationIds,
      createdBy: actor.userId,
    });

    if (error) throw error;

    await notifyVisitEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_ASSIGNED,
      visit,
      recipientIds: [assignee.userId],
      performedBy: actor.userId,
    });

    await notifyVisitEvent({
      templateKey:
        NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CAREGIVER_LISTED,
      visit,
      recipientIds: caregivers.map((member) => member.userId),
      performedBy: actor.userId,
    });

    return respondWithDetails({
      id: visit.id,
      actor,
      respond: SupervisoryVisitsResponsesFactories.visitCreated,
    });
  }

  static async updateVisit(req, res, next) {
    const {id} = req.params;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });

    // Details: the caregiver list is needed to diff the new one against.
    const existing = await loadVisitOrThrow({id, actor, details: true});

    assertCanManageVisit({actor, visit: existing});
    ensureStatusIn({
      visit: existing,
      statuses: SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
    });

    const current = Object.assign({}, existing, {
      [CAREGIVERS_FIELD]: getCaregiverIds({visit: existing}),
    });

    const changes = {};
    for (const field of EDITABLE_FIELDS) {
      if (
        req.body[field] !== undefined &&
        !isSameValue({a: req.body[field], b: current[field]})
      )
        changes[field] = req.body[field];
    }

    const changedFields = Object.keys(changes);

    if (changedFields.length === 0)
      return respondWithDetails({
        id,
        actor,
        respond: SupervisoryVisitsResponsesFactories.visitUpdated,
      });

    const visitType = changes.visitType || existing.visitType;

    if (visitType !== SUPERVISORY_VISIT_TYPES.other.value)
      changes.visitTypeOther = null;
    else if (!(changes.visitTypeOther ?? existing.visitTypeOther))
      throw GeneralErrorsFactories.badRequestErr({
        customMessage: 'Please describe the visit type',
      });

    let assignee = null;

    if (changes[ASSIGNEE_FIELD])
      assignee = await validateVisitAssignee({
        assigneeUserOrganizationId: changes[ASSIGNEE_FIELD],
        patientId: existing.patientId,
        organizationId: actor.organizationId,
      });

    let caregivers = null;

    if (changes[CAREGIVERS_FIELD])
      caregivers = await validateCaregiversPresent({
        caregiverUserOrganizationIds: changes[CAREGIVERS_FIELD],
        patientId: existing.patientId,
        organizationId: actor.organizationId,
      });

    if (changes.checklistTemplateId)
      await assertActiveVisitTemplate({
        checklistTemplateId: changes.checklistTemplateId,
        organizationId: actor.organizationId,
      });

    const data = Object.assign({}, changes);
    delete data[CAREGIVERS_FIELD];

    if (changes.scheduledStartAt || changes.scheduledEndAt) {
      const scheduledStartAt =
        changes.scheduledStartAt || existing.scheduledStartAt;
      const scheduledEndAt = changes.scheduledEndAt || existing.scheduledEndAt;

      ensureWindow({scheduledStartAt, scheduledEndAt});

      // A new window restarts the reminder policy and clears OVERDUE.
      data.sentReminderOffsets = [];

      if (existing.status === SUPERVISORY_VISIT_STATUSES.overdue.value) {
        const toStatus = SupervisoryVisitsServices.resolveResumedStatus({
          scheduledEndAt,
        });

        if (toStatus !== existing.status) {
          data.status = toStatus;
          data.overdueAt = null;
        }
      }
    }

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await SupervisoryVisitsServices.updateVisit({
          id,
          data,
          tx,
        });

        if (!updated)
          throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

        if (caregivers)
          await SupervisoryVisitsServices.replaceCaregivers({
            visitId: id,
            caregiverUserOrganizationIds: changes[CAREGIVERS_FIELD],
            tx,
          });

        if (assignee)
          await recordVisitEvent({
            tx,
            visit: existing,
            type: SUPERVISORY_VISIT_EVENT_TYPES.reassigned.value,
            actorUserId: actor.userId,
            fromAssigneeUserOrganizationId: existing.assigneeUserOrganizationId,
            toAssigneeUserOrganizationId: assignee.userOrgId,
          });

        const otherFields = changedFields.filter(
          (field) => field !== ASSIGNEE_FIELD
        );

        if (otherFields.length)
          await recordVisitEvent({
            tx,
            visit: existing,
            type: SUPERVISORY_VISIT_EVENT_TYPES.edited.value,
            actorUserId: actor.userId,
            fromStatus: data.status ? existing.status : null,
            toStatus: data.status || null,
            payload: {changedFields: otherFields},
          });
      },
    });

    if (assignee) {
      await notifyVisitEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REASSIGNED,
        visit: existing,
        recipientIds: [assignee.userId],
        performedBy: actor.userId,
      });
      await notifyVisitEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_UNASSIGNED,
        visit: existing,
        recipientIds: [getAssigneeUserId({visit: existing})],
        performedBy: actor.userId,
      });
    } else {
      await notifyVisitEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_UPDATED,
        visit: existing,
        recipientIds: [getAssigneeUserId({visit: existing})],
        performedBy: actor.userId,
      });
    }

    if (caregivers) {
      const previousIds = new Set(getCaregiverIds({visit: existing}));

      await notifyVisitEvent({
        templateKey:
          NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CAREGIVER_LISTED,
        visit: existing,
        recipientIds: caregivers
          .filter((member) => !previousIds.has(member.userOrgId))
          .map((member) => member.userId),
        performedBy: actor.userId,
      });
    }

    return respondWithDetails({
      id,
      actor,
      respond: SupervisoryVisitsResponsesFactories.visitUpdated,
    });
  }

  static async cancelVisit(req, res, next) {
    const {id} = req.params;
    const {reason} = req.body;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });
    const existing = await loadVisitOrThrow({id, actor, details: true});

    assertCanManageVisit({actor, visit: existing});
    ensureStatusIn({
      visit: existing,
      statuses: SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES,
    });

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await SupervisoryVisitsServices.cancelVisit({
          id,
          cancelReason: reason,
          cancelledBy: actor.userId,
          tx,
        });

        if (!updated)
          throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

        await recordVisitEvent({
          tx,
          visit: existing,
          type: SUPERVISORY_VISIT_EVENT_TYPES.cancelled.value,
          actorUserId: actor.userId,
          fromStatus: existing.status,
          toStatus: SUPERVISORY_VISIT_STATUSES.cancelled.value,
          payload: {reason},
        });
      },
    });

    await notifyVisitEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CANCELLED,
      visit: existing,
      recipientIds: getParticipantUserIds({visit: existing}),
      performedBy: actor.userId,
    });

    return respondWithDetails({
      id,
      actor,
      respond: SupervisoryVisitsResponsesFactories.visitCancelled,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // static async reopenVisit(req, res, next) {
  //   const {id} = req.params;
  //
  //   const actor = await resolveSupervisoryVisitActor({
  //     token: req.extra.jwtToken,
  //   });
  //   const existing = await loadVisitOrThrow({id, actor, details: true});
  //
  //   assertCanReopenVisit({actor, visit: existing});
  //   ensureStatusIn({
  //     visit: existing,
  //     statuses: SUPERVISORY_VISIT_REOPENABLE_STATUS_VALUES,
  //   });
  //
  //   const toStatus = SupervisoryVisitsServices.resolveResumedStatus({
  //     scheduledEndAt: existing.scheduledEndAt,
  //   });
  //
  //   await wrapWithPrismaTransaction({
  //     fn: async (tx) => {
  //       const {updated} = await SupervisoryVisitsServices.reopenVisit({
  //         id,
  //         fromStatuses: SUPERVISORY_VISIT_REOPENABLE_STATUS_VALUES,
  //         toStatus,
  //         tx,
  //       });
  //
  //       if (!updated)
  //         throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();
  //
  //       await recordVisitEvent({
  //         tx,
  //         visit: existing,
  //         type: SUPERVISORY_VISIT_EVENT_TYPES.reopened.value,
  //         actorUserId: actor.userId,
  //         fromStatus: existing.status,
  //         toStatus,
  //         payload: {
  //           previousOutcome: existing.completionOutcome || null,
  //           previousNotes: existing.completionNotes || null,
  //           previousReviewNote: existing.reviewNote || null,
  //           previousCancelReason: existing.cancelReason || null,
  //         },
  //       });
  //     },
  //   });
  //
  //   await notifyVisitEvent({
  //     templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REOPENED,
  //     visit: existing,
  //     recipientIds: getParticipantUserIds({visit: existing}),
  //     performedBy: actor.userId,
  //   });
  //
  //   return respondWithDetails({
  //     id,
  //     actor,
  //     respond: SupervisoryVisitsResponsesFactories.visitReopened,
  //   });
  // }

  // PATCH /:id/complete -- the assignee files the visit: checklist answers,
  // outcome, findings, evidence and any follow-up tasks queued on the way.
  static async completeVisit(req, res, next) {
    const {id} = req.params;
    const {outcome, completionNotes, followUps = []} = req.body;
    const files = req.files || [];

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });

    const existing = await loadVisitOrThrow({id, actor, details: true});

    assertCanFileVisit({actor, visit: existing});
    ensureStatusIn({
      visit: existing,
      statuses: SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
    });

    const evidenceFiles = files.filter(
      (file) => file.fieldname === WORK_ITEM_EVIDENCE_FIELD_NAME
    );

    if (evidenceFiles.length > MAX_TASK_EVIDENCE_FILES)
      throw SupervisoryVisitsErrorsFactories.tooManyEvidenceFilesErr({
        maxAllowed: MAX_TASK_EVIDENCE_FILES,
      });

    const queued = await prepareQueuedFollowUps({
      followUps: followUps || [],
      visit: existing,
      actor,
    });

    // Validates the answers against the template, then uploads their photos.
    const checklist = await prepareVisitAnswers({
      visit: existing,
      body: req.body,
      files,
    });

    let evidence = [];
    const createdTasks = [];
    const isAutoApproved = approvesOnFiling({actor});

    // Events in one transaction share its start time, so each gets its own
    // millisecond: "filed" before "follow-ups created" before "approved".
    const filedAt = getCurrentTime();
    const eventTime = ({step}) => new Date(filedAt.getTime() + step);

    try {
      evidence = await uploadVisitEvidence({files: evidenceFiles, visitId: id});

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const {updated} = await SupervisoryVisitsServices.fileVisit({
            id,
            answers: checklist.answers,
            completionOutcome: outcome,
            completionNotes,
            completionFiles: evidence,
            completedBy: actor.userId,
            tx,
          });

          if (!updated)
            throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

          await recordVisitEvent({
            tx,
            visit: existing,
            type: SUPERVISORY_VISIT_EVENT_TYPES.filed.value,
            actorUserId: actor.userId,
            fromStatus: existing.status,
            toStatus: SUPERVISORY_VISIT_STATUSES.underReview.value,
            payload: {
              outcome,
              filesCount: evidence.length,
              wasOverdue:
                existing.status === SUPERVISORY_VISIT_STATUSES.overdue.value ||
                new Date(existing.scheduledEndAt) < filedAt,
            },
            createdAt: eventTime({step: 0}),
          });

          for (const {followUp} of queued) {
            const {doc: task, error} = await FollowUpTasksServices.createTask({
              organizationId: actor.organizationId,
              patientId: existing.patientId,
              assigneeUserOrganizationId: followUp.assigneeUserOrganizationId,
              title: followUp.title,
              description: followUp.description,
              priority: followUp.priority,
              dueAt: followUp.dueAt,
              checklistTemplateId: followUp.checklistTemplateId,
              submissionFlagId: existing.submissionFlagId,
              supervisoryVisitId: id,
              flagType: existing.flagType,
              createdBy: actor.userId,
              tx,
            });

            if (error) throw error;

            createdTasks.push(task);
          }

          if (createdTasks.length)
            await recordVisitEvent({
              tx,
              visit: existing,
              type: SUPERVISORY_VISIT_EVENT_TYPES.followUpsCreated.value,
              actorUserId: actor.userId,
              payload: {taskIds: createdTasks.map((task) => task.id)},
              createdAt: eventTime({step: 1}),
            });

          if (!isAutoApproved) return;

          const {updated: approved} =
            await SupervisoryVisitsServices.approveVisit({
              id,
              reviewedBy: actor.userId,
              tx,
            });

          if (!approved)
            throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

          await recordVisitEvent({
            tx,
            visit: existing,
            type: SUPERVISORY_VISIT_EVENT_TYPES.approved.value,
            actorUserId: actor.userId,
            fromStatus: SUPERVISORY_VISIT_STATUSES.underReview.value,
            toStatus: SUPERVISORY_VISIT_STATUSES.approved.value,
            payload: {note: null, autoApproved: true},
            createdAt: eventTime({step: 2}),
          });
        },
      });
    } catch (error) {
      await cleanupVisitEvidence({files: evidence});
      await checklist.cleanupOnError();
      throw error;
    }

    if (isAutoApproved) {
      // Nothing waits for review; the creator and (if escalated) the
      // original assignee hear it is approved.
      await notifyVisitEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_APPROVED,
        visit: existing,
        recipientIds: [
          existing.createdBy,
          getOriginalAssigneeUserId({visit: existing}),
        ],
        performedBy: actor.userId,
      });
    } else {
      // Reviewers (admins + the patient's case manager) and the creator hear
      // the visit is waiting; the filer is skipped.
      const reviewerIds = await getVisitReviewerUserIds({visit: existing});

      await notifyVisitEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_FILED,
        visit: existing,
        recipientIds: reviewerIds.concat(existing.createdBy),
        performedBy: actor.userId,
      });
    }

    for (const [index, task] of createdTasks.entries()) {
      await notifyTaskEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ASSIGNED,
        task,
        recipientIds: [queued[index].assignee.userId],
        performedBy: actor.userId,
      });
    }

    return respondWithDetails({
      id,
      actor,
      respond: isAutoApproved
        ? SupervisoryVisitsResponsesFactories.visitApproved
        : SupervisoryVisitsResponsesFactories.visitFiled,
    });
  }

  static async approveVisit(req, res, next) {
    const {id} = req.params;
    const {note} = req.body;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });
    const existing = await loadVisitOrThrow({id, actor, details: true});

    assertCanReviewVisit({actor, visit: existing});
    ensureStatusIn({
      visit: existing,
      statuses: SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,
    });

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await SupervisoryVisitsServices.approveVisit({
          id,
          reviewedBy: actor.userId,
          reviewNote: note,
          tx,
        });

        if (!updated)
          throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

        await recordVisitEvent({
          tx,
          visit: existing,
          type: SUPERVISORY_VISIT_EVENT_TYPES.approved.value,
          actorUserId: actor.userId,
          fromStatus: existing.status,
          toStatus: SUPERVISORY_VISIT_STATUSES.approved.value,
          payload: {note: note || null},
        });
      },
    });

    // The filer, the creator and (if escalated) the original assignee.
    await notifyVisitEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_APPROVED,
      visit: existing,
      recipientIds: [
        existing.completedBy,
        existing.createdBy,
        getOriginalAssigneeUserId({visit: existing}),
      ],
      performedBy: actor.userId,
    });

    return respondWithDetails({
      id,
      actor,
      respond: SupervisoryVisitsResponsesFactories.visitApproved,
    });
  }

  static async requestCorrection(req, res, next) {
    const {id} = req.params;
    const {reason} = req.body;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });
    const existing = await loadVisitOrThrow({id, actor, details: true});

    assertCanReviewVisit({actor, visit: existing});
    ensureStatusIn({
      visit: existing,
      statuses: SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,
    });

    const toStatus = SupervisoryVisitsServices.resolveResumedStatus({
      scheduledEndAt: existing.scheduledEndAt,
    });

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await SupervisoryVisitsServices.requestCorrection({
          id,
          toStatus,
          tx,
        });

        if (!updated)
          throw SupervisoryVisitsErrorsFactories.invalidStatusTransitionErr();

        await recordVisitEvent({
          tx,
          visit: existing,
          type: SUPERVISORY_VISIT_EVENT_TYPES.correctionRequested.value,
          actorUserId: actor.userId,
          fromStatus: existing.status,
          toStatus,
          payload: {reason},
        });
      },
    });

    await notifyVisitEvent({
      templateKey:
        NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CORRECTION_REQUESTED,
      visit: existing,
      recipientIds: [
        getAssigneeUserId({visit: existing}),
        existing.completedBy,
      ],
      performedBy: actor.userId,
      context: {reason},
    });

    return respondWithDetails({
      id,
      actor,
      respond: SupervisoryVisitsResponsesFactories.visitCorrectionRequested,
    });
  }

  static async getVisit(req, res, next) {
    const {id} = req.params;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });
    const visit = await loadVisitOrThrow({id, actor, details: true});

    return SupervisoryVisitsResponsesFactories.visitRetrieved({visit});
  }

  static async listVisits(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {
      patientId,
      assigneeUserId,
      assigneeUserOrganizationId,
      status,
      visitType,
      regionId,
      search,
      scheduledFrom,
      scheduledTo,
    } = req.query;

    const actor = await resolveSupervisoryVisitActor({
      token: req.extra.jwtToken,
    });

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: SUPERVISORY_VISIT_SORT_FIELDS,
    });

    const {
      success,
      docs: visits,
      error,
      count,
    } = await SupervisoryVisitsServices.listVisits({
      scopeClause: buildSupervisoryVisitScopeClause({actor}),
      patientId,
      assigneeUserId,
      assigneeUserOrganizationId,
      status,
      visitType,
      regionId,
      search,
      scheduledFrom,
      scheduledTo,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch supervisory visits',
      });

    return SupervisoryVisitsResponsesFactories.visitsListed({
      visits,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
