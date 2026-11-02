const {modelConstants} = require('../constants');

const {MAX_TASK_EVIDENCE_FILES} = require('../constants/file');

const {
  FOLLOW_UP_TASK_STATUSES,
  FOLLOW_UP_TASK_OPEN_STATUS_VALUES,

  // FOLLOW_UP_TASK_REOPENABLE_STATUS_VALUES,
  FOLLOW_UP_TASK_SORT_FIELDS,
  FOLLOW_UP_TASK_EVENT_TYPES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOMES,
  FOLLOW_UP_TASK_EVIDENCE_FIELD_NAME,
} = require('../constants/followUpTasksConstants');

const {
  NOTIFICATION_TEMPLATE_KEYS,
} = require('../constants/notificationConstants');

const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {
  GeneralErrorsFactories,
  FollowUpTasksErrorsFactories,
  FollowUpTasksResponsesFactories,
  PrismaFactory,
} = require('../factories');

const {
  FollowUpTasksServices,
  PatientCareTeamServices,
  PatientsServices,
  SupervisoryVisitsServices,
} = require('../services');

const {
  ensurePatientAssignedToCaseManager,
} = require('../utils/caseManagerPatientAccessUtils');

const {getCurrentTime} = require('../utils/dateUtils');

const {
  resolveFollowUpTaskActor,
  buildFollowUpTaskScopeClause,
  assertCanManageTask,
  assertCanActOnTask,

  // assertCanReopenTask,
  validateAssignee,
} = require('../utils/followUpTaskAccessUtils');

const {recordTaskEvent} = require('../utils/followUpTaskEventUtils');

const {
  notifyTaskEvent,
  getAssigneeUserId,
  getOriginalAssigneeUserId,
} = require('../utils/followUpTaskNotificationUtils');

const {
  prepareSubmissionPayload,
  uploadTaskEvidence,
  cleanupTaskEvidence,
} = require('../utils/followUpTaskUtils');

const {getListParams, buildOrderByClause} = require('../utils/general');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const {
  buildSupervisoryVisitScopeClause,
} = require('../utils/supervisoryVisitAccessUtils');

const {
  assertActiveFollowUpTemplate,
} = require('../utils/workItemTemplateUtils');

const EDITABLE_FIELDS = [
  'title',
  'description',
  'visitInstructions',
  'priority',
  'dueAt',
  'assigneeUserOrganizationId',
  'checklistTemplateId',
];

const isSameValue = ({a, b}) => {
  if (a instanceof Date || b instanceof Date)
    return new Date(a).getTime() === new Date(b).getTime();
  if (Array.isArray(a) || Array.isArray(b))
    return JSON.stringify(a || []) === JSON.stringify(b || []);

  return (a ?? null) === (b ?? null);
};

const ensureOpen = ({task}) => {
  if (!FOLLOW_UP_TASK_OPEN_STATUS_VALUES.includes(task.status))
    throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();
};

// The status an open task returns to after being un-overdued.
const resolveResumedStatus = ({dueAt}) => {
  if (new Date(dueAt) < getCurrentTime())
    return FOLLOW_UP_TASK_STATUSES.overdue.value;

  return FOLLOW_UP_TASK_STATUSES.pending.value;
};

async function loadTaskOrThrow({id, actor, details = false}) {
  const scopeClause = buildFollowUpTaskScopeClause({actor});

  const {success, doc: task} = details
    ? await FollowUpTasksServices.getTaskDetails({id, scopeClause})
    : await FollowUpTasksServices.getTaskById({id, scopeClause});

  if (!success || !task) throw FollowUpTasksErrorsFactories.notFoundErr();

  if (details) await attachVisitAccess({task, actor});

  return task;
}

// A task's assignee may not be allowed to open the visit it came from.
async function attachVisitAccess({task, actor}) {
  if (!task?.supervisoryVisit) return;

  const {doc: visit} = await SupervisoryVisitsServices.getVisitById({
    id: task.supervisoryVisit.id,
    scopeClause: buildSupervisoryVisitScopeClause({actor}),
  });

  task.supervisoryVisit.canOpen = Boolean(visit);
}

async function respondWithDetails({id, actor, respond}) {
  const {doc: task} = await FollowUpTasksServices.getTaskDetails({
    id,
    scopeClause: buildFollowUpTaskScopeClause({actor}),
  });

  await attachVisitAccess({task, actor});

  return respond({task});
}

module.exports = class FollowUpTasksController {
  // GET /follow-up-tasks/assignees?patientId= -- the patient's care team.
  static async listAssignees(req, res, next) {
    const {patientId} = req.query;
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});

    const members = await PatientCareTeamServices.listAssigneesForActor({
      actor,
      patientId,
    });

    return FollowUpTasksResponsesFactories.assigneesListed({
      assignees: members,
    });
  }

  static async createTask(req, res, next) {
    const {
      patientId,
      title,
      description,
      priority,
      dueAt,
      checklistTemplateId,
      submissionFlagId,
      supervisoryVisitId,
      visitInstructions,
      flagType,
    } = req.body;

    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});

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

    const assignee = await validateAssignee({
      assigneeUserOrganizationId,
      patientId,
      organizationId: actor.organizationId,
    });

    if (checklistTemplateId)
      await assertActiveFollowUpTemplate({
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

    if (supervisoryVisitId) {
      const {doc: visit} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUPERVISORY_VISIT,
        query: {id: supervisoryVisitId, patientId},
      });

      if (!visit)
        throw GeneralErrorsFactories.badRequestErr({
          customMessage: 'Linked supervisory visit not found for this patient',
        });
    }

    const {doc: existingTask} = await FollowUpTasksServices.getTaskByUniqueKey({
      patientId,
      assigneeUserOrganizationId,
      dueAt,
      checklistTemplateId,
    });

    if (existingTask) throw FollowUpTasksErrorsFactories.duplicateTaskErr();

    const {doc: task, error} = await FollowUpTasksServices.createTask({
      organizationId: actor.organizationId,
      patientId,
      assigneeUserOrganizationId,
      title,
      description,
      priority,
      dueAt,
      checklistTemplateId,
      submissionFlagId,
      supervisoryVisitId,
      visitInstructions,
      flagType,
      createdBy: actor.userId,
    });

    if (error) throw error;

    await notifyTaskEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ASSIGNED,
      task,
      recipientIds: [assignee.userId],
      performedBy: actor.userId,
    });

    return respondWithDetails({
      id: task.id,
      actor,
      respond: FollowUpTasksResponsesFactories.taskCreated,
    });
  }

  static async updateTask(req, res, next) {
    const {id} = req.params;
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});
    const existing = await loadTaskOrThrow({id, actor});

    assertCanManageTask({actor, task: existing});
    ensureOpen({task: existing});

    const changes = {};
    for (const field of EDITABLE_FIELDS) {
      if (
        req.body[field] !== undefined &&
        !isSameValue({a: req.body[field], b: existing[field]})
      )
        changes[field] = req.body[field];
    }

    const changedFields = Object.keys(changes);

    if (changedFields.length === 0)
      return respondWithDetails({
        id,
        actor,
        respond: FollowUpTasksResponsesFactories.taskUpdated,
      });

    let assignee = null;

    if (changes.assigneeUserOrganizationId)
      assignee = await validateAssignee({
        assigneeUserOrganizationId: changes.assigneeUserOrganizationId,
        patientId: existing.patientId,
        organizationId: actor.organizationId,
      });

    if (
      changedFields.includes('checklistTemplateId') &&
      changes.checklistTemplateId
    )
      await assertActiveFollowUpTemplate({
        checklistTemplateId: changes.checklistTemplateId,
        organizationId: actor.organizationId,
      });

    const data = Object.assign({}, changes);
    let toStatus = null;

    if (changes.dueAt) {
      // A new due time restarts the reminder policy and clears OVERDUE.
      data.sentReminderOffsets = [];

      if (existing.status === FOLLOW_UP_TASK_STATUSES.overdue.value) {
        toStatus = resolveResumedStatus({dueAt: changes.dueAt});
        if (toStatus !== existing.status) {
          data.status = toStatus;
          data.overdueAt = null;
        }
      }
    }

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await FollowUpTasksServices.updateTask({
          id,
          data,
          tx,
        });

        if (!updated)
          throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();

        if (assignee)
          await recordTaskEvent({
            tx,
            task: existing,
            type: FOLLOW_UP_TASK_EVENT_TYPES.reassigned.value,
            actorUserId: actor.userId,
            fromAssigneeUserOrganizationId: existing.assigneeUserOrganizationId,
            toAssigneeUserOrganizationId: assignee.userOrgId,
          });

        const otherFields = changedFields.filter(
          (field) => field !== 'assigneeUserOrganizationId'
        );

        if (otherFields.length)
          await recordTaskEvent({
            tx,
            task: existing,
            type: FOLLOW_UP_TASK_EVENT_TYPES.edited.value,
            actorUserId: actor.userId,
            fromStatus: data.status ? existing.status : null,
            toStatus: data.status || null,
            payload: {changedFields: otherFields},
          });
      },
    });

    if (assignee) {
      await notifyTaskEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REASSIGNED,
        task: existing,
        recipientIds: [assignee.userId],
        performedBy: actor.userId,
      });
      await notifyTaskEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_UNASSIGNED,
        task: existing,
        recipientIds: [getAssigneeUserId({task: existing})],
        performedBy: actor.userId,
      });
    } else {
      await notifyTaskEvent({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_UPDATED,
        task: existing,
        recipientIds: [getAssigneeUserId({task: existing})],
        performedBy: actor.userId,
      });
    }

    return respondWithDetails({
      id,
      actor,
      respond: FollowUpTasksResponsesFactories.taskUpdated,
    });
  }

  static async cancelTask(req, res, next) {
    const {id} = req.params;
    const {reason} = req.body;
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});
    const existing = await loadTaskOrThrow({id, actor});

    assertCanManageTask({actor, task: existing});
    ensureOpen({task: existing});

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {updated} = await FollowUpTasksServices.cancelTask({
          id,
          cancelReason: reason,
          cancelledBy: actor.userId,
          tx,
        });

        if (!updated)
          throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();

        await recordTaskEvent({
          tx,
          task: existing,
          type: FOLLOW_UP_TASK_EVENT_TYPES.cancelled.value,
          actorUserId: actor.userId,
          fromStatus: existing.status,
          toStatus: FOLLOW_UP_TASK_STATUSES.cancelled.value,
          payload: {reason},
        });
      },
    });

    await notifyTaskEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_CANCELLED,
      task: existing,
      recipientIds: [getAssigneeUserId({task: existing}), existing.createdBy],
      performedBy: actor.userId,
    });

    return respondWithDetails({
      id,
      actor,
      respond: FollowUpTasksResponsesFactories.taskCancelled,
    });
  }

  // PREVENT-772: reopen removed for now; uncomment to restore.
  // static async reopenTask(req, res, next) {
  //   const {id} = req.params;
  //   const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});
  //   const existing = await loadTaskOrThrow({id, actor});
  //
  //   assertCanReopenTask({actor, task: existing});
  //
  //   if (!FOLLOW_UP_TASK_REOPENABLE_STATUS_VALUES.includes(existing.status))
  //     throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();
  //
  //   const toStatus = resolveResumedStatus({dueAt: existing.dueAt});
  //
  //   await wrapWithPrismaTransaction({
  //     fn: async (tx) => {
  //       const {updated} = await FollowUpTasksServices.reopenTask({
  //         id,
  //         fromStatuses: FOLLOW_UP_TASK_REOPENABLE_STATUS_VALUES,
  //         toStatus,
  //         tx,
  //       });
  //
  //       if (!updated)
  //         throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();
  //
  //       await recordTaskEvent({
  //         tx,
  //         task: existing,
  //         type: FOLLOW_UP_TASK_EVENT_TYPES.reopened.value,
  //         actorUserId: actor.userId,
  //         fromStatus: existing.status,
  //         toStatus,
  //         payload: {
  //           previousOutcome: existing.completionOutcome || null,
  //           previousNotes: existing.completionNotes || null,
  //           previousCancelReason: existing.cancelReason || null,
  //         },
  //       });
  //     },
  //   });
  //
  //   await notifyTaskEvent({
  //     templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REOPENED,
  //     task: existing,
  //     recipientIds: [getAssigneeUserId({task: existing}), existing.createdBy],
  //     performedBy: actor.userId,
  //   });
  //
  //   return respondWithDetails({
  //     id,
  //     actor,
  //     respond: FollowUpTasksResponsesFactories.taskReopened,
  //   });
  // }

  // PATCH /:id/complete -- multipart: outcome + notes + optional evidence,
  // plus the checklist answers when the task has a checklist.
  static async completeTask(req, res, next) {
    const {id} = req.params;
    const {outcome, completionNotes} = req.body;
    const files = req.files || [];
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});

    // Details: the history tells us whether the sweep took this task away
    // from someone who should also hear it got done.
    const existing = await loadTaskOrThrow({id, actor, details: true});

    assertCanActOnTask({actor, task: existing});
    ensureOpen({task: existing});

    const evidenceFiles = files.filter(
      (file) => file.fieldname === FOLLOW_UP_TASK_EVIDENCE_FIELD_NAME
    );

    if (evidenceFiles.length > MAX_TASK_EVIDENCE_FILES)
      throw FollowUpTasksErrorsFactories.tooManyEvidenceFilesErr({
        maxAllowed: MAX_TASK_EVIDENCE_FILES,
      });

    // Validates the answers against the template, then uploads their photos.
    const checklist = existing.checklistTemplateId
      ? await prepareSubmissionPayload({
          task: existing,
          body: req.body,
          files,
          taskId: id,
        })
      : null;

    let evidence = [];

    try {
      evidence = await uploadTaskEvidence({files: evidenceFiles, taskId: id});

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const {updated} = await FollowUpTasksServices.completeTask({
            id,
            completionOutcome: outcome,
            completionNotes,
            completionFiles: evidence,
            answers: checklist ? checklist.answers : undefined,
            completedBy: actor.userId,
            tx,
          });

          if (!updated)
            throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();

          await recordTaskEvent({
            tx,
            task: existing,
            type: FOLLOW_UP_TASK_EVENT_TYPES.completed.value,
            actorUserId: actor.userId,
            fromStatus: existing.status,
            toStatus: FOLLOW_UP_TASK_STATUSES.completed.value,
            payload: {
              outcome,
              filesCount: evidence.length,
              wasOverdue:
                existing.status === FOLLOW_UP_TASK_STATUSES.overdue.value ||
                new Date(existing.dueAt) < getCurrentTime(),
            },
          });
        },
      });
    } catch (error) {
      await cleanupTaskEvidence({files: evidence});
      if (checklist) await checklist.cleanupOnError();
      throw error;
    }

    // The creator keeps their completion record even when they completed it
    // themselves; an escalated task also tells the original assignee.
    await notifyTaskEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_COMPLETED,
      task: existing,
      recipientIds: [
        existing.createdBy,
        getOriginalAssigneeUserId({task: existing}),
      ],
      performedBy: actor.userId,
      includeActor: true,
    });

    return respondWithDetails({
      id,
      actor,
      respond: FollowUpTasksResponsesFactories.taskCompleted,
    });
  }

  // Legacy one-shot checklist / reply submission (kept for API compatibility).
  static async submitTask(req, res, next) {
    const {id} = req.params;
    const files = req.files || [];
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});
    const existing = await loadTaskOrThrow({id, actor});

    assertCanActOnTask({actor, task: existing});
    ensureOpen({task: existing});

    let payload;

    try {
      payload = await prepareSubmissionPayload({
        task: existing,
        body: req.body,
        files,
        taskId: id,
      });

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const {updated} =
            payload.type === 'answers'
              ? await FollowUpTasksServices.submitTaskAnswers({
                  id,
                  answers: payload.answers,
                  completedBy: actor.userId,
                  tx,
                })
              : await FollowUpTasksServices.submitTaskReply({
                  id,
                  caseManagerReply: payload.caseManagerReply,
                  caseManagerReplyFiles: payload.caseManagerReplyFiles,
                  completedBy: actor.userId,
                  tx,
                });

          if (!updated)
            throw FollowUpTasksErrorsFactories.invalidStatusTransitionErr();

          await recordTaskEvent({
            tx,
            task: existing,
            type: FOLLOW_UP_TASK_EVENT_TYPES.completed.value,
            actorUserId: actor.userId,
            fromStatus: existing.status,
            toStatus: FOLLOW_UP_TASK_STATUSES.completed.value,
            payload: {
              outcome: FOLLOW_UP_TASK_COMPLETION_OUTCOMES.done.value,
              submission: payload.type,
            },
          });
        },
      });
    } catch (error) {
      if (payload && typeof payload.cleanupOnError === 'function')
        await payload.cleanupOnError();

      throw error;
    }

    await notifyTaskEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_COMPLETED,
      task: existing,
      recipientIds: [existing.createdBy],
      performedBy: actor.userId,
      includeActor: true,
    });

    return respondWithDetails({
      id,
      actor,
      respond: FollowUpTasksResponsesFactories.taskSubmitted,
    });
  }

  static async getTask(req, res, next) {
    const {id} = req.params;
    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});
    const task = await loadTaskOrThrow({id, actor, details: true});

    return FollowUpTasksResponsesFactories.taskRetrieved({task});
  }

  static async listTasks(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {
      patientId,
      assigneeUserOrganizationId,
      status,
      priority,
      source,
      flagType,
      search,
      dueFrom,
      dueTo,
    } = req.query;

    const actor = await resolveFollowUpTaskActor({token: req.extra.jwtToken});

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: FOLLOW_UP_TASK_SORT_FIELDS,
    });

    const {
      success,
      docs: tasks,
      error,
      count,
    } = await FollowUpTasksServices.listTasks({
      scopeClause: buildFollowUpTaskScopeClause({actor}),
      patientId,
      assigneeUserOrganizationId,
      status,
      priority,
      source,
      flagType,
      search,
      dueFrom,
      dueTo,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch follow-up tasks',
      });

    return FollowUpTasksResponsesFactories.tasksListed({
      tasks,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
