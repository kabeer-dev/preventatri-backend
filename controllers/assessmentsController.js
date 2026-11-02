const {
  CHECKLIST_TEMPLATES_SORT_FIELDS,
  CHECKLIST_TEMPLATE_PUBLISHED_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_STATUS_FILTER_ALL,
  CHECKLIST_TEMPLATE_STATUS_TRANSITIONS,
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_TYPES,
  CHECKLIST_SUBMISSIONS_SORT_FIELDS,
  CHECKLIST_SUBMISSION_STATUSES,
  SKIPPABLE_STATUSES,
  VOIDABLE_STATUSES,
} = require('../constants/assessmentConstants');

const {
  ESCALATION_RESPONSE_ACTIONS,
} = require('../constants/escalationConstants');
const {S3_DIRS} = require('../constants/file');

const {
  NOTIFICATION_TEMPLATE_KEYS,
  NOTIFICATION_DOCUMENT_TYPES,
} = require('../constants/notificationConstants');

const {ESCALATABLE_FLAGS} = require('../constants/riskCalcConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {
  GeneralErrorsFactories,
  AssessmentsErrorsFactories,
  AssessmentsResponsesFactories,
  ChecklistAssignmentErrorsFactories,
  FollowUpTasksErrorsFactories,
  SupervisoryVisitsErrorsFactories,
} = require('../factories');

const {
  scheduleStartEscalation,
} = require('../lib/bullMQ/producers/scheduleStartEscalation');

const logger = require('../middleware/loggerMiddleware');

const {validateTemplateCompleteness} = require('../schemas/assessmentsSchema');

const {
  AssessmentsServices,
  EscalationServices,
  PatientsServices,
  CaseManagersServices,
  NotificationsServices,
} = require('../services');
const EmergencyFlagServices = require('../services/emergencyFlagServices');

const {
  getAllQuestionsFromTemplate,
  getMissingRequiredQuestions,
  getInvalidQuestionIds,
  validateAnswerValues,
  groupImagesByQuestion,
  buildUpdateAnswersWithImages,
  getRemovedImageKeys,
  cleanupUploadedImages,
  cleanupRemovedImages,
  calculateSubmissionRisk,
} = require('../utils/assessmentsUtils');
const {resolveCaregiverProfileId} = require('../utils/caregiverScopingUtils');

const {
  resolveCaseManagerProfileId,
} = require('../utils/caseManagerScopingUtils');

const {
  buildCaregiverSubmissionVisibilityClause,
} = require('../utils/checklistAssignmentUtils');

const {getToday, getCurrentTime} = require('../utils/dateUtils');

const {
  uploadResolutionAttachments,
  cleanupResolutionAttachments,
} = require('../utils/escalationUtils');

const {
  getListParams,
  buildOrderByClause,
  withIdTieBreaker,
  isDocumentDuplicationError,
} = require('../utils/general');
const {resolveNurseScope} = require('../utils/nurseScopingUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const {
  assertActiveFollowUpTemplate,
  assertActiveVisitTemplate,
} = require('../utils/workItemTemplateUtils');

// Template types a role may see. Returns undefined for admins, who see all.
function resolveVisibleTemplateTypes({userRole}) {
  if (userRole === SYSTEM_ROLES.caregiver.value)
    return CHECKLIST_TEMPLATE_TYPES.PATIENT.value;

  if (userRole === SYSTEM_ROLES.case_manager.value) {
    return {
      in: [
        CHECKLIST_TEMPLATE_TYPES.FOLLOW_UP.value,
        CHECKLIST_TEMPLATE_TYPES.SUPERVISORY_VISIT.value,
      ],
    };
  }

  return undefined;
}

// Drafts are admin-only; other roles are held to published templates whatever
// status they ask for. Returns undefined when no status filter applies.
function resolveVisibleTemplateStatus({userRole, status}) {
  const requestedStatus =
    status === CHECKLIST_TEMPLATE_STATUS_FILTER_ALL ? undefined : status;

  if (userRole === SYSTEM_ROLES.admin.value) return requestedStatus;

  if (!requestedStatus)
    return {in: CHECKLIST_TEMPLATE_PUBLISHED_STATUSES_VALUES};

  return CHECKLIST_TEMPLATE_PUBLISHED_STATUSES_VALUES.includes(requestedStatus)
    ? requestedStatus
    : {in: []};
}

module.exports = class AssessmentsController {
  // ==========================================
  // CHECKLIST TEMPLATE ENDPOINTS
  // ==========================================

  static async getTemplate(req, res, next) {
    const {id} = req.params;
    const {includeUsage} = req.query;
    const token = req.extra.jwtToken;
    const userRole = token.user.currentActiveOrganization.role;

    const caregiverProfileId = await resolveCaregiverProfileId({token});

    const type = resolveVisibleTemplateTypes({userRole});

    const {success, doc: template} = await AssessmentsServices.getTemplateById({
      id,
      caregiverProfileId,
      type,
      status: resolveVisibleTemplateStatus({userRole}),
    });

    if (!success || !template) {
      throw AssessmentsErrorsFactories.templateNotFoundErr();
    }

    // Admin-only, and a draft has nothing using it yet.
    const shouldLoadUsage =
      includeUsage &&
      userRole === SYSTEM_ROLES.admin.value &&
      template.status !== CHECKLIST_TEMPLATE_STATUSES.DRAFT.value;

    if (!shouldLoadUsage) {
      return AssessmentsResponsesFactories.templateRetrieved({
        template,
        usage: null,
      });
    }

    const {
      success: isUsageLoaded,
      doc: usage,
      error: usageError,
    } = await AssessmentsServices.getTemplateUsage({
      id,
      organizationId: template.organizationId,
      type: template.type,
    });

    if (!isUsageLoaded || usageError) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to load checklist template usage',
      });
    }

    return AssessmentsResponsesFactories.templateRetrieved({template, usage});
  }

  static async listTemplates(req, res, next) {
    const {page, limit, skip, search, sortBy, sortDir} = getListParams({req});
    const {status, type: typeQuery} = req.query;
    const token = req.extra.jwtToken;
    const userRole = token.user.currentActiveOrganization.role;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: CHECKLIST_TEMPLATES_SORT_FIELDS,
    });

    const caregiverProfileId = await resolveCaregiverProfileId({token});

    // Admins see every type and may filter; the other roles are pinned to the
    // types they are allowed to work with.
    const type = resolveVisibleTemplateTypes({userRole}) || typeQuery;

    const {
      success,
      docs: templates,
      error,
      count,
    } = await AssessmentsServices.listTemplates({
      status: resolveVisibleTemplateStatus({userRole, status}),
      caregiverProfileId,
      type,
      search,
      skip,
      take: limit,
      sort: withIdTieBreaker({orderBy}),
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch checklist templates',
      });
    }

    return AssessmentsResponsesFactories.templatesListRetrieved({
      templates,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  static async createTemplate(req, res, next) {
    const {title, description, type, sections} = req.body;
    const token = req.extra.jwtToken;

    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {doc: duplicate} = await AssessmentsServices.getTemplateByTitle({
      title,
      organizationId,
    });

    if (duplicate) {
      throw AssessmentsErrorsFactories.templateTitleAlreadyExistsErr({title});
    }

    const {
      success,
      doc: template,
      error,
    } = await AssessmentsServices.createTemplate({
      title,
      description,
      type,
      sections,
      status: CHECKLIST_TEMPLATE_STATUSES.DRAFT.value,
      organizationId,
      createdBy: token.user.id,
    });

    // The title check above can lose a race with a concurrent save.
    if (isDocumentDuplicationError({error}))
      throw AssessmentsErrorsFactories.templateTitleAlreadyExistsErr({title});

    if (!success || error || !template) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to create checklist template',
      });
    }

    return AssessmentsResponsesFactories.templateCreated({template});
  }

  // Publishes a draft or archives an active template; nothing else is allowed.
  static async updateTemplateStatus(req, res, next) {
    const {id} = req.params;
    const {status} = req.body;
    const token = req.extra.jwtToken;

    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {doc: existingTemplate} = await AssessmentsServices.getTemplateById({
      id,
    });

    if (!existingTemplate) {
      throw AssessmentsErrorsFactories.templateNotFoundErr();
    }

    const fromStatus = CHECKLIST_TEMPLATE_STATUS_TRANSITIONS[status];

    if (existingTemplate.status !== fromStatus) {
      throw AssessmentsErrorsFactories.templateStatusTransitionNotAllowedErr({
        from: existingTemplate.status,
        to: status,
      });
    }

    const isTransitioned = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {success, error, areDocumentsUpdated} =
          await AssessmentsServices.transitionTemplateStatus({
            id,
            organizationId,
            fromStatus,
            toStatus: status,
            tx,
          });

        if (!success || error) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to update checklist template status',
          });
        }

        if (!areDocumentsUpdated) return false;

        if (status !== CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value) return true;

        // Checked after the row is locked so a draft save racing the publish
        // can't put unchecked content live.
        const {doc: lockedTemplate} = await AssessmentsServices.getTemplateById(
          {id, tx}
        );

        const {errors} = await validateTemplateCompleteness({
          template: lockedTemplate,
        });

        if (errors) {
          throw AssessmentsErrorsFactories.templateIncompleteErr({
            customMessage: errors,
          });
        }

        return true;
      },
    });

    if (!isTransitioned) {
      throw AssessmentsErrorsFactories.templateStatusTransitionNotAllowedErr();
    }

    const {doc: template} = await AssessmentsServices.getTemplateById({id});

    return AssessmentsResponsesFactories.templateStatusUpdated({template});
  }

  // Replaces a draft's title, description and full section tree.
  static async updateTemplate(req, res, next) {
    const {id} = req.params;
    const {title, description, sections} = req.body;
    const token = req.extra.jwtToken;

    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {doc: existingTemplate} = await AssessmentsServices.getTemplateById({
      id,
    });

    if (!existingTemplate) {
      throw AssessmentsErrorsFactories.templateNotFoundErr();
    }

    if (existingTemplate.status !== CHECKLIST_TEMPLATE_STATUSES.DRAFT.value) {
      throw AssessmentsErrorsFactories.templateNotEditableErr();
    }

    const {doc: duplicate} = await AssessmentsServices.getTemplateByTitle({
      title,
      organizationId,
      excludeId: id,
    });

    if (duplicate) {
      throw AssessmentsErrorsFactories.templateTitleAlreadyExistsErr({title});
    }

    const isReplaced = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {success, error, isDraft} =
          await AssessmentsServices.replaceDraftTemplateContent({
            id,
            organizationId,
            title,
            description,
            sections,
            type: existingTemplate.type,
            tx,
          });

        if (isDocumentDuplicationError({error}))
          throw AssessmentsErrorsFactories.templateTitleAlreadyExistsErr({
            title,
          });

        if (!success || error) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to update checklist template',
          });
        }

        return isDraft;
      },
    });

    // Published between the status check and the write.
    if (!isReplaced) {
      throw AssessmentsErrorsFactories.templateNotEditableErr();
    }

    const {doc: template} = await AssessmentsServices.getTemplateById({id});

    return AssessmentsResponsesFactories.templateUpdated({template});
  }

  static async deleteTemplate(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;

    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {doc: existingTemplate} = await AssessmentsServices.getTemplateById({
      id,
    });

    if (!existingTemplate) {
      throw AssessmentsErrorsFactories.templateNotFoundErr();
    }

    if (existingTemplate.status !== CHECKLIST_TEMPLATE_STATUSES.DRAFT.value) {
      throw AssessmentsErrorsFactories.templateNotEditableErr();
    }

    const {success, error, isDocumentDeleted} =
      await AssessmentsServices.deleteDraftTemplate({id, organizationId});

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to delete checklist template',
      });
    }

    if (!isDocumentDeleted) {
      throw AssessmentsErrorsFactories.templateNotEditableErr();
    }

    return AssessmentsResponsesFactories.templateDeleted();
  }

  // ==========================================
  // CHECKLIST SUBMISSION ENDPOINTS
  // ==========================================

  static async submitSubmission(req, res, next) {
    const {id} = req.params;
    const {answers, visitNotes} = req.body;
    const files = req.files || [];

    const token = req.extra.jwtToken;

    // Scope to caregiver own submissions
    const assigneeId = token.user.id;

    // 1. Fetch existing submission (only PENDING or LATE are submittable)
    const {doc: existingSubmission} =
      await AssessmentsServices.getSubmissionById({
        id,
        assigneeId,
        statuses: [
          CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
          CHECKLIST_SUBMISSION_STATUSES.LATE.value,
        ],
      });

    if (!existingSubmission)
      throw AssessmentsErrorsFactories.submissionNotFoundErr({
        customMessage: 'Submission not found or cannot be updated',
      });

    if (existingSubmission.deadline) {
      const today = getToday();
      const deadline = existingSubmission.deadline;
      if (today && deadline && today > deadline) {
        throw ChecklistAssignmentErrorsFactories.submissionGraceExpiredErr();
      }
    }

    // 3. Fetch the template to validate answers against
    const {doc: template} = await AssessmentsServices.getTemplateById({
      id: existingSubmission.checklistTemplateId,
    });

    if (!template) throw AssessmentsErrorsFactories.templateNotFoundErr();

    const allQuestions = getAllQuestionsFromTemplate({template});
    const answeredQuestionIds = answers.map((a) => a.questionId);

    const missingRequired = getMissingRequiredQuestions({
      allQuestions,
      answeredQuestionIds,
    });

    if (missingRequired.length > 0)
      throw AssessmentsErrorsFactories.requiredQuestionsUnansweredErr({
        missingQuestions: missingRequired.map((q) => ({
          id: q.id,
          title: q.title,
        })),
      });

    const invalidIds = getInvalidQuestionIds({
      allQuestions,
      answeredQuestionIds,
    });

    if (invalidIds.length > 0)
      throw AssessmentsErrorsFactories.invalidFieldsErr({
        customMessage: 'Some question IDs do not belong to this template',
      });

    const invalidAnswers = validateAnswerValues({allQuestions, answers});

    if (invalidAnswers.length > 0)
      throw AssessmentsErrorsFactories.invalidAnswerValuesErr({invalidAnswers});

    // 5. Group new file uploads by questionId
    const {imageFilesByQuestion} = groupImagesByQuestion({
      files,
      answeredQuestionIds,
    });

    // 6. Determine which old images are being replaced (only for questions with new uploads)
    const existingAnswers = existingSubmission.answers || [];

    const removedImageKeys = getRemovedImageKeys({
      existingAnswers,
      imageFilesByQuestion,
    });

    // 7. Upload new files and build answers (keep existing images when no new upload)
    const fileDir = `${S3_DIRS.submissions}/${id}`;

    const answersWithFiles = await buildUpdateAnswersWithImages({
      answers,
      existingAnswers,
      imageFilesByQuestion,
      fileDir,
    });

    // 7. Update the submission
    const updateData = {
      id,
      visitNotes: visitNotes || null,
      answers: answersWithFiles,
    };

    updateData.status = CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value;
    updateData.submittedAt = getCurrentTime();

    const {success, error} =
      await AssessmentsServices.updateSubmission(updateData);

    if (!success || error) {
      // Cleanup only newly uploaded files on failure
      cleanupUploadedImages({answersWithFiles});
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update checklist submission',
      });
    }

    // 8. Delete removed images from S3 after successful DB update
    cleanupRemovedImages({removedImageKeys});

    // 9. Calculate and persist risk score
    const riskResult = calculateSubmissionRisk({
      answers: answersWithFiles,
      template,
    });

    const {
      success: riskSuccess,
      doc: submissionFlag,
      error: riskError,
    } = await AssessmentsServices.upsertSubmissionRisk({
      submissionId: id,
      patientId: existingSubmission.patientId,
      organizationId: existingSubmission.organizationId,
      submittedBy: assigneeId,
      riskResult,
    });

    if (!riskSuccess || riskError) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to persist risk score for checklist submission',
      });
    }

    // 9b. If the submission flag is RED or YELLOW, enqueue the escalation chain
    // (starts at the first step of the organization's escalation policy for the
    // flag color). The worker drives the cascade with retry/backoff; step order
    // and TTLs come from that policy — see EscalationPolicyServices. Only an
    // enqueue failure (Redis unreachable) surfaces as 500 here.

    if (ESCALATABLE_FLAGS.includes(riskResult?.flag) && submissionFlag) {
      const {success: escalationEnqueued, error: escalationEnqueueError} =
        await scheduleStartEscalation({
          submissionFlagId: submissionFlag.id,
          patientId: existingSubmission.patientId,
          organizationId: existingSubmission.organizationId,

          // Auto-raised by a checklist submission — attributed to SYSTEM
          // (performedBy omitted/null).
          performedBy: null,
        });

      if (!escalationEnqueued) {
        logger.error(
          `[AssessmentsController] Failed to enqueue escalation for ${riskResult?.flag} flag ${submissionFlag.id} on submission ${id}: ${escalationEnqueueError?.message || escalationEnqueueError}`
        );
        throw GeneralErrorsFactories.internalErr({
          customMessage:
            escalationEnqueueError?.message ||
            'Failed to enqueue escalation for submission flag',
        });
      }
    }

    // 10. Fetch and return updated submission
    const {doc: fullSubmission} = await AssessmentsServices.getSubmissionById({
      id,
    });

    return AssessmentsResponsesFactories.submissionUpdated({
      submission: fullSubmission,
    });
  }

  static async voidSubmission(req, res, next) {
    const {id} = req.params;
    const {voidReason} = req.body;

    // 1. Fetch existing submission (only voidable statuses)
    const {doc: existingSubmission} =
      await AssessmentsServices.getSubmissionById({
        id,
        statuses: VOIDABLE_STATUSES,
      });

    if (!existingSubmission)
      throw AssessmentsErrorsFactories.submissionNotFoundErr({
        customMessage: 'Submission not found or cannot be voided',
      });

    // 2. Void the submission
    const {success, error} = await AssessmentsServices.voidSubmission({
      id,
      voidReason,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to void checklist submission',
      });
    }

    // 3. Fetch and return updated submission
    const {doc: updatedSubmission} =
      await AssessmentsServices.getSubmissionById({id});

    return AssessmentsResponsesFactories.submissionVoided({
      submission: updatedSubmission,
    });
  }

  static async skipSubmission(req, res, next) {
    const {id} = req.params;
    const {reason} = req.body;

    // 1. Fetch existing submission (only skippable statuses)
    const {doc: existingSubmission} =
      await AssessmentsServices.getSubmissionById({
        id,
        statuses: SKIPPABLE_STATUSES,
      });

    if (!existingSubmission)
      throw AssessmentsErrorsFactories.submissionNotFoundErr({
        customMessage: 'Submission not found or cannot be skipped',
      });

    // 3. Update status to SKIPPED with reason
    const {success, error} = await AssessmentsServices.skipSubmission({
      id,
      reason,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to skip checklist submission',
      });
    }

    // 4. Return updated submission
    const {doc: updatedSubmission} =
      await AssessmentsServices.getSubmissionById({id});

    return AssessmentsResponsesFactories.submissionSkipped({
      submission: updatedSubmission,
    });
  }

  static async getSubmission(req, res, next) {
    const {id} = req.params;

    const token = req.extra.jwtToken;
    const userRole = token.user.currentActiveOrganization.role;

    // Caregivers: own or finished submissions, only while still assigned to the patient.
    const caregiverUserId =
      userRole === SYSTEM_ROLES.caregiver.value ? token.user.id : undefined;

    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {success, doc: submission} =
      await AssessmentsServices.getSubmissionDetails({
        id,
        caregiverUserId,
        nurseScope,
        caseManagerProfileId,
        visibilityClause: caregiverUserId
          ? buildCaregiverSubmissionVisibilityClause({userId: caregiverUserId})
          : undefined,
      });

    if (!success || !submission) {
      throw AssessmentsErrorsFactories.submissionNotFoundErr();
    }

    return AssessmentsResponsesFactories.submissionRetrieved({
      submission,
      hideAssigneeContact: Boolean(
        caregiverUserId && submission.assigneeId !== caregiverUserId
      ),
    });
  }

  static async listSubmissions(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {status, patientId, submittedBy, search, includeDeleted} = req.query;

    const token = req.extra.jwtToken;

    const userRole = token.user.currentActiveOrganization.role;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: CHECKLIST_SUBMISSIONS_SORT_FIELDS,
    });

    // Caregivers: own submissions on patients they are still assigned to, plus
    // the finished ones on a patient's history page; others may filter by submittedBy.
    const caregiverUserId =
      userRole === SYSTEM_ROLES.caregiver.value ? token.user.id : undefined;

    const isCaregiverPatientHistory = Boolean(caregiverUserId && patientId);

    const ownSubmissionsOnly = isCaregiverPatientHistory
      ? undefined
      : caregiverUserId;

    const assigneeId = caregiverUserId ? ownSubmissionsOnly : submittedBy;

    const visibilityClause = isCaregiverPatientHistory
      ? buildCaregiverSubmissionVisibilityClause({userId: caregiverUserId})
      : undefined;

    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {
      success,
      docs: submissions,
      error,
      count,
    } = await AssessmentsServices.listSubmissions({
      status,
      patientId,
      assigneeId,
      caregiverUserId,
      nurseScope,
      caseManagerProfileId,
      visibilityClause,
      search,

      // Allow viewing submissions of archived patients (soft-deleted with the
      // patient). Validated/coerced to a boolean by the query schema; only sent
      // by the FE for an archived patient's detail page.
      includeDeleted,
      skip,
      take: limit,
      sort: orderBy,
      options: {
        fieldsInclusion: {
          exclude: ['answers'],
        },
      },
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch checklist submissions',
      });
    }

    return AssessmentsResponsesFactories.submissionsListRetrieved({
      submissions,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  // GET /escalations/assigned — returns the caller's next assigned escalation to
  // handle: the oldest ACTIVE RED if any are assigned, otherwise the oldest
  // ACTIVE YELLOW. Also returns remaining-flag counts for both severities.
  // Self-scoped: only rows whose currentAssigneeId resolves to the authenticated
  // user's active UserOrganization are ever returned.
  static async getAssignedEscalation(req, res, next) {
    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // `type` is validated and normalized (trimmed/uppercased to RED|YELLOW or
    // undefined) by validateAssignedEscalationQuery in the route middleware.
    // `patientId` narrows the lookup to one patient (patient details page).
    const {type: flagType, patientId} = req.query;

    const {
      success,
      doc: escalation,
      redCount,
      yellowCount,
      error,
    } = await EscalationServices.getAssignedEscalation({
      userId,
      organizationId,
      flagType,
      patientId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch assigned escalations',
      });
    }

    return AssessmentsResponsesFactories.AssignedFlagRetrieved({
      escalation,
      redCount,
      yellowCount,
    });
  }

  // GET /assessments/escalations/:escalationId/submission — full details for
  // one escalation. MANUAL flags return description/images/audioNote + patient
  // + submitter; AUTO flags additionally return the related checklist
  // submission with template, sections, questions, and answers. Scoped to the
  // caller's *assigned* escalation (org-scoping alone would leak other
  // assignees' patient data), so userId is threaded into the service.
  static async getEscalationSubmissionDetails(req, res, next) {
    const {escalationId} = req.params;
    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {
      success,
      doc: escalation,
      error,
    } = await EscalationServices.getEscalationSubmissionDetails({
      escalationId,
      organizationId,
      userId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch escalation submission details',
      });
    }

    if (!escalation) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Escalation not found',
      });
    }

    return AssessmentsResponsesFactories.escalationSubmissionDetailsRetrieved({
      escalation,
    });
  }

  // PATCH /assessments/escalations/:escalationId/accept — the current assignee
  // accepts the flag, which stops its escalation. No notifications are sent.
  static async acceptEscalation(req, res, next) {
    const {escalationId} = req.params;
    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {
      success,
      doc: escalation,
      notAssignee,
      alreadyClosed,
      notAcceptable,
      expired,
      error,
    } = await EscalationServices.acceptEscalation({
      escalationId,
      organizationId,
      userId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to accept escalation',
      });
    }

    if (notAssignee) {
      throw GeneralErrorsFactories.badRequestErr({
        customMessage:
          'You are not the assigned user for this escalation. Only the currently assigned user may accept a raised flag.',
      });
    }

    if (alreadyClosed || notAcceptable) {
      throw AssessmentsErrorsFactories.escalationNotAcceptableErr();
    }

    if (expired) {
      throw AssessmentsErrorsFactories.escalationExpiredErr({
        customMessage:
          'This escalation has expired and is being reassigned to the next level; it can no longer be accepted by you',
      });
    }

    if (!escalation) {
      throw AssessmentsErrorsFactories.escalationNotFoundErr();
    }

    return AssessmentsResponsesFactories.escalationAccepted({escalation});
  }

  // POST /assessments/escalations/:escalationId/resolve — record the assignee's
  // resolution (actions taken, notes, optional follow-up / supervisory visit),
  // flip the flag + escalation to RESOLVED, and write a RESOLVED audit event.
  // Self-scoped: only the current assignee may resolve (enforced in the service).
  static async resolveEscalation(req, res, next) {
    const {escalationId} = req.params;

    const {
      actions,
      notes,
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
    } = req.body;

    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Optional supporting evidence sent under the `files` field. The count cap
    // (MAX_RESOLUTION_ATTACHMENTS) and per-file size/type are enforced by the
    // upload middleware, so excess files are rejected before reaching here.
    const attachmentFiles = req.files || [];

    if (hasFollowUp && followUpChecklistTemplateId)
      await assertActiveFollowUpTemplate({
        checklistTemplateId: followUpChecklistTemplateId,
        organizationId,
      });

    if (hasSupervisoryVisit)
      await assertActiveVisitTemplate({
        checklistTemplateId: supervisoryVisitChecklistTemplateId,
        organizationId,
      });

    // Upload first so the keys are persisted with the resolution.
    const attachments = await uploadResolutionAttachments({
      files: attachmentFiles,
      escalationId,
    });

    const {
      success,
      doc: response,
      patientId,
      submissionFlagId,
      followUpTaskId,
      followUpAssigneeUserId,
      flag,
      supervisoryVisitId,
      supervisoryVisitAssigneeUserId,
      alreadyResolved,
      expired,
      notAssignee,
      missingCaseManager,
      missingFollowUpAssignee,
      assigneeNotInCareTeam,
      visitAssigneeNotInCareTeam,
      visitCaregiverNotInCareTeam,
      error,
    } = await EscalationServices.resolveEscalation({
      escalationId,
      organizationId,
      userId,
      actions,
      notes,
      attachments,
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
    });

    // Every non-committed outcome returns a null doc, so a falsy `response` means
    // the resolution did not persist — drop the just-uploaded attachments so they
    // don't linger in S3 unreferenced before surfacing the matching error.
    if (!response) {
      await cleanupResolutionAttachments({
        keys: attachments.map((attachment) => attachment.key),
      });
    }

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to resolve escalation',
      });
    }

    if (alreadyResolved) {
      throw AssessmentsErrorsFactories.escalationAlreadyResolvedErr();
    }

    if (expired) {
      throw AssessmentsErrorsFactories.escalationExpiredErr();
    }

    if (notAssignee) {
      throw GeneralErrorsFactories.badRequestErr({
        customMessage:
          'You are not the assigned user for this escalation. Only the currently assigned user may resolve a raised flag.',
      });
    }

    if (missingCaseManager) {
      throw GeneralErrorsFactories.badRequestErr({
        customMessage:
          'Patient has no assigned case manager; choose who the supervisory visit is assigned to',
      });
    }

    if (visitAssigneeNotInCareTeam) {
      throw SupervisoryVisitsErrorsFactories.assigneeNotInCareTeamErr();
    }

    if (visitCaregiverNotInCareTeam) {
      throw SupervisoryVisitsErrorsFactories.caregiverNotInCareTeamErr();
    }

    if (missingFollowUpAssignee) {
      throw FollowUpTasksErrorsFactories.assigneeRequiredErr();
    }

    if (assigneeNotInCareTeam) {
      throw FollowUpTasksErrorsFactories.assigneeNotInCareTeamErr();
    }

    if (!response) {
      throw AssessmentsErrorsFactories.escalationNotFoundErr();
    }

    // The escalation row holds only the status, so the activity log entry
    // also shows what the resolver did.
    if (req.extra.audit) {
      req.extra.audit.afterDetails = {
        actionsTaken: (response.actions || [])
          .map((action) => ESCALATION_RESPONSE_ACTIONS[action]?.label)
          .filter(Boolean)
          .join(', '),
        resolutionNotes: response.notes,
      };
    }

    // Notify everyone who received a notification during this flag's life plus
    // the caregiver who raised it, excluding the resolver themselves: the case
    // manager, every escalation assignee (nurses, plus the admin only if it
    // reached ADMIN), and the raiser. Best-effort: notifyManyFromTemplate swallows
    // its own errors and never affects the resolve response.
    const {doc: resolvedPatient} = await PatientsServices.getPatientById({
      id: patientId,
    });

    const {userId: caseManagerUserId} =
      await CaseManagersServices.resolveCaseManagerForPatient({
        patientId,
        organizationId,
      });

    // Only the caregiver who raised this flag (submittedBy) is notified — NOT
    // every caregiver on the patient. The patient can carry stale/extra checklist
    // assignments pointing at other caregivers, so a patient-wide lookup would
    // fan out to people who never received this flag's notifications.
    const {doc: resolvedFlag} =
      await EmergencyFlagServices.getEmergencyFlagById({
        id: submissionFlagId,
        includeFullDetails: false,
      });
    const raiserUserId = resolvedFlag?.submittedBy || null;

    // Everyone who actually handled the escalation (including region-nurse
    // fallbacks that aren't on the patient's primary/secondary nurse fields, and
    // the specific admin the row landed on if it ever reached ADMIN).
    const {
      userIds: escalationAssigneeUserIds = [],
      channelsByUserId: escalationAssigneeChannels = {},
    } = await EscalationServices.getEscalationAssigneeUserIds({escalationId});

    // The raiser may have been taken off the patient since raising the flag.
    const resolutionRecipientIds =
      await PatientsServices.filterRecipientsByPatientAccess({
        recipientIds: [raiserUserId, caseManagerUserId]
          .concat(escalationAssigneeUserIds)
          .filter((recipientId) => recipientId !== userId),
        patientId,
        organizationId,
      });

    const patientName = resolvedPatient
      ? `${resolvedPatient.firstName || ''} ${resolvedPatient.lastName || ''}`.trim()
      : '';

    await NotificationsServices.notifyManyFromTemplate({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_RESOLVED,
      context: {patientName, flag},
      recipientIds: resolutionRecipientIds,
      organizationId,
      performedBy: userId,
      documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
      documentId: submissionFlagId,
      patientId,

      // Everyone who held the flag is told on their policy step's "Notify via"
      // channels; the raiser (and a case manager who only oversaw) on all.
      channelsByRecipientId: escalationAssigneeChannels,
    });

    // A follow-up task or supervisory visit created here goes to its
    // care-team assignee (the case manager by default). Both are notified
    // even when they are the resolver themselves — they still want the
    // assignment record. Best-effort: never affects the resolve response.
    if (hasFollowUp && followUpAssigneeUserId) {
      await NotificationsServices.notifyFromTemplate({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ASSIGNED,
        context: {patientName},
        recipientId: followUpAssigneeUserId,
        organizationId,
        performedBy: userId,
        documentType: NOTIFICATION_DOCUMENT_TYPES.FOLLOW_UP_TASK.value,
        documentId: followUpTaskId,
        patientId,
      });
    }

    if (hasSupervisoryVisit && supervisoryVisitAssigneeUserId) {
      await NotificationsServices.notifyFromTemplate({
        templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_ASSIGNED,
        context: {patientName},
        recipientId: supervisoryVisitAssigneeUserId,
        organizationId,
        performedBy: userId,
        documentType: NOTIFICATION_DOCUMENT_TYPES.SUPERVISORY_VISIT.value,
        documentId: supervisoryVisitId,
        patientId,
      });
    }

    return AssessmentsResponsesFactories.escalationResolved({response});
  }
};
