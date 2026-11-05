const {randomUUID} = require('crypto');

const {
  HHA_SYNC_EXCEPTION_STATUSES,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_TRIGGERS,
} = require('../constants/hhaExchangeConstants');
const {HHA_VISIT_SORT_FIELDS} = require('../constants/hhaVisitsConstants');

const {
  GeneralErrorsFactories,
  HhaExchangeErrorsFactories,
  HhaExchangeResponsesFactories,
} = require('../factories');
const {enqueueHhaSync} = require('../lib/bullMQ/producers/enqueueHhaSync');

const {
  HhaSyncHistoryReadServices,
  HhaSyncServices,
  HhaSyncWorklistServices,
  HhaVisitsServices,
  UsersServices,
} = require('../services');

const {
  getListParams,
  buildOrderByClause,
  isDocumentDuplicationError,
  isDocumentNotFoundError,
} = require('../utils/general');

const {
  findOrgUserByEmail,
  resolveAdminEmailUpdate,
} = require('../utils/hhaExchange/userProfileSyncUtils');

const getOrganizationId = ({req}) =>
  req.extra.jwtToken.user.currentActiveOrganization.organizationId;

/** How each kind of link conflict reopens, and what it answers when it cannot. */
const LINK_CONFLICT_HANDLERS = {
  [HHAX_SYNC_EXCEPTION_TYPES.PRIMARY_NURSE_CONFLICT]: {
    reopen: (params) =>
      HhaSyncWorklistServices.reopenPatientPrimaryNurseConflict(params),
    choiceRequiredErr: () =>
      HhaExchangeErrorsFactories.hhaPrimaryNurseChoiceRequiredErr(),
    notReopenableErr: () =>
      HhaExchangeErrorsFactories.hhaPrimaryNurseConflictNotReopenableErr(),
  },
  [HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_CONFLICT]: {
    reopen: (params) =>
      HhaSyncWorklistServices.reopenPatientCaseManagerConflict(params),
    choiceRequiredErr: () =>
      HhaExchangeErrorsFactories.hhaCaseManagerChoiceRequiredErr(),
    notReopenableErr: () =>
      HhaExchangeErrorsFactories.hhaCaseManagerConflictNotReopenableErr(),
  },
};

const buildMeta = ({page, limit, count}) => ({
  page: parseInt(page, 10),
  limit: parseInt(limit, 10),
  count,
  totalPages: Math.ceil(count / limit),
});

/**
 * HHAeXchange integration endpoints.
 *
 * Kept apart from the per-entity controllers because the integration is its own
 * surface, not a patient or caregiver action: those are simply the resources it
 * imports. The visit endpoints below are the read side of that import -- the
 * only HHAeXchange resource with no PreventaTri entity of its own to list from.
 */
module.exports = class HhaExchangeController {
  /**
   * Start an import of every HHAeXchange resource. Queued, not run inline: the
   * run takes minutes, so the caller gets a 202 and hears the outcome by
   * socket and notification.
   *
   * One endpoint for the whole run -- a run reconciles everything in
   * HHAX_SYNC_RESOURCES under one lock, so there is no per-resource import.
   */
  static async syncHhaExchange(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Becomes the run's history row id and is echoed by the socket event.
    const runId = randomUUID();

    // Pre-check for a clean 409 with a message.
    if (await HhaSyncServices.isSyncRunning({organizationId})) {
      throw HhaExchangeErrorsFactories.syncAlreadyRunningErr();
    }

    // ...then claim atomically: the check above cannot stand alone now that the
    // lock is taken inside the worker. See claimQueuedSlot.
    if (!(await HhaSyncServices.claimQueuedSlot({organizationId, runId}))) {
      throw HhaExchangeErrorsFactories.syncAlreadyRunningErr();
    }

    const {success: enqueued} = await enqueueHhaSync({
      runId,
      organizationId,
      requestedByUserId: token.user.id,
      trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
    });

    // Without this a failed enqueue blocks the button for the marker's TTL.
    if (!enqueued) {
      await HhaSyncServices.releaseQueuedSlot({organizationId, runId});

      throw HhaExchangeErrorsFactories.syncEnqueueFailedErr();
    }

    return HhaExchangeResponsesFactories.syncQueued({runId});
  }

  /**
   * Whether a sync is queued or in flight.
   * GET /integration/sync/status
   *
   * For page load, not polling: the socket only carries the completion event,
   * so a client mounting mid-run would otherwise show an idle button.
   */
  static async getHhaSyncStatus(req, res, next) {
    const isRunning = await HhaSyncServices.isSyncPendingOrRunning({
      organizationId: getOrganizationId({req}),
    });

    return HhaExchangeResponsesFactories.syncStatusRetrieved({isRunning});
  }

  /**
   * List the organization's imported HHAeXchange visits.
   * GET /integration/visits
   *
   * Read-only, admin-only, and served from PreventaTri's own table rather than
   * proxied to HHAeXchange: the nightly run (or the Sync button) is what moves
   * data, so this page never pays HHAeXchange latency or puts PHI on the wire
   * per request.
   */
  static async listHhaVisits(req, res, next) {
    const {page, limit, skip, search, sortBy, sortDir} = getListParams({req});
    const {status, visitType, dateFrom, dateTo} = req.query;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: HHA_VISIT_SORT_FIELDS,
    });

    const {
      success,
      docs: hhaVisits,
      error,
      count,
    } = await HhaVisitsServices.listHhaVisits({
      organizationId,
      status,
      visitType,
      search,
      dateFrom,
      dateTo,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange visits',
      });
    }

    return HhaExchangeResponsesFactories.hhaVisitsListRetrieved({
      hhaVisits,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * One imported HHAeXchange visit.
   * GET /integration/visits/:id
   */
  static async getHhaVisit(req, res, next) {
    const {id} = req.params;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {
      success,
      doc: hhaVisit,
      error,
    } = await HhaVisitsServices.getHhaVisitById({
      id,
      organizationId,
    });

    // A failed QUERY and a visit that is simply not there are different
    // answers, and collapsing them would report a database outage as a clean
    // 404 -- the caller would retry a URL that was never the problem. findOne
    // says which: success false carries the error, success true with a null doc
    // means the row genuinely does not exist for this organization.
    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange visit',
      });
    }

    if (!hhaVisit) {
      throw HhaExchangeErrorsFactories.hhaVisitNotFoundErr();
    }

    return HhaExchangeResponsesFactories.hhaVisitRetrieved({hhaVisit});
  }

  /** GET /integration/sync/runs */
  static async listSyncRuns(req, res, next) {
    const {page, limit, skip} = getListParams({req});
    const {status, trigger, dateFrom, dateTo} = req.query;

    const {success, docs, count} = await HhaSyncHistoryReadServices.listRuns({
      organizationId: getOrganizationId({req}),
      status,
      trigger,
      dateFrom,
      dateTo,
      skip,
      take: limit,
    });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange sync runs',
      });
    }

    return HhaExchangeResponsesFactories.syncRunsListRetrieved({
      syncRuns: docs,
      meta: buildMeta({page, limit, count}),
    });
  }

  /** GET /integration/sync/runs/:id */
  static async getSyncRun(req, res, next) {
    const {success, doc} = await HhaSyncHistoryReadServices.getRun({
      id: req.params.id,
      organizationId: getOrganizationId({req}),
    });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange sync run',
      });
    }

    if (!doc) throw HhaExchangeErrorsFactories.syncRunNotFoundErr();

    return HhaExchangeResponsesFactories.syncRunRetrieved({syncRun: doc});
  }

  /** GET /integration/sync/changes */
  static async listSyncChanges(req, res, next) {
    const {page, limit, skip} = getListParams({req});
    const {runId, resource, action, hhaRecordId, dateFrom, dateTo} = req.query;

    const {success, docs, count} = await HhaSyncHistoryReadServices.listChanges(
      {
        organizationId: getOrganizationId({req}),
        runId,
        resource,
        action,
        hhaRecordId,
        dateFrom,
        dateTo,
        skip,
        take: limit,
      }
    );

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange sync changes',
      });
    }

    return HhaExchangeResponsesFactories.syncChangesListRetrieved({
      syncChanges: docs,
      meta: buildMeta({page, limit, count}),
    });
  }

  /** GET /integration/sync/exceptions */
  static async listSyncExceptions(req, res, next) {
    const {page, limit, skip} = getListParams({req});
    const {status, type, resource, runId} = req.query;

    const {success, docs, count} =
      await HhaSyncHistoryReadServices.listExceptions({
        organizationId: getOrganizationId({req}),
        status,
        type,
        resource,
        runId,
        skip,
        take: limit,
      });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange sync exceptions',
      });
    }

    return HhaExchangeResponsesFactories.syncExceptionsListRetrieved({
      syncExceptions: docs,
      meta: buildMeta({page, limit, count}),
    });
  }

  /** GET /integration/sync/exceptions/counts */
  static async getSyncExceptionCounts(req, res, next) {
    const {success, total, byType} =
      await HhaSyncHistoryReadServices.countOpenExceptions({
        organizationId: getOrganizationId({req}),
      });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to count HHAeXchange sync exceptions',
      });
    }

    return HhaExchangeResponsesFactories.syncExceptionCountsRetrieved({
      total,
      byType,
    });
  }

  /** PATCH /integration/sync/exceptions/:id -- resolve, dismiss or reopen. */
  static async updateSyncException(req, res, next) {
    const {success, doc, error, linkConflict} =
      await HhaSyncHistoryReadServices.updateExceptionStatus({
        id: req.params.id,
        organizationId: getOrganizationId({req}),
        status: req.body.status,
        note: req.body.note,
        userId: req.extra.jwtToken.user.id,
      });

    if (linkConflict) {
      return HhaExchangeController.reopenLinkConflict({req, linkConflict});
    }

    if (!success && isDocumentNotFoundError({error})) {
      throw HhaExchangeErrorsFactories.syncExceptionNotFoundErr();
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update HHAeXchange sync exception',
      });
    }

    return HhaExchangeResponsesFactories.syncExceptionUpdated({
      syncException: doc,
    });
  }

  /** POST /integration/sync/exceptions/:id/county -- add the missing county to a region. */
  static async addSyncExceptionCounty(req, res, next) {
    const {
      success,
      doc,
      isExceptionFound,
      isActionable,
      isSyncRunning,
      isRegionFound,
      otherRegionName,
    } = await HhaSyncWorklistServices.addExceptionCountyToRegion({
      exceptionId: req.params.id,
      organizationId: getOrganizationId({req}),
      regionId: req.body.regionId,
      userId: req.extra.jwtToken.user.id,
    });

    if (!isExceptionFound) {
      throw HhaExchangeErrorsFactories.syncExceptionNotFoundErr();
    }

    if (!isActionable) {
      throw HhaExchangeErrorsFactories.hhaCountyExceptionNotActionableErr();
    }

    if (isSyncRunning) {
      throw HhaExchangeErrorsFactories.syncAlreadyRunningErr({
        customMessage:
          'A sync is running. Add the county once it has finished.',
      });
    }

    if (!isRegionFound) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Region not found',
      });
    }

    if (otherRegionName) {
      throw HhaExchangeErrorsFactories.hhaCountyExceptionNotActionableErr({
        customMessage: `This county is already in the region "${otherRegionName}". The next sync applies it.`,
      });
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to add the county to this region',
      });
    }

    return HhaExchangeResponsesFactories.syncExceptionCountyAdded({
      exceptionCounty: doc,
    });
  }

  /** GET /integration/sync/email-conflicts */
  static async listEmailConflicts(req, res, next) {
    const {page, limit, skip} = getListParams({req});

    const {success, docs, count} =
      await HhaSyncWorklistServices.listEmailConflicts({
        organizationId: getOrganizationId({req}),
        status: req.query.status,
        skip,
        take: limit,
      });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange shared emails',
      });
    }

    return HhaExchangeResponsesFactories.emailConflictsListRetrieved({
      emailConflicts: docs,
      meta: buildMeta({page, limit, count}),
    });
  }

  /** PATCH /integration/sync/email-conflicts/users/:userId */
  static async updateEmailConflictUser(req, res, next) {
    const organizationId = getOrganizationId({req});
    const {userId} = req.params;

    const {doc: user} = await HhaSyncWorklistServices.getOrgUser({
      userId,
      organizationId,
    });

    if (!user) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'User not found',
      });
    }

    if (user.isVerified) {
      throw HhaExchangeErrorsFactories.hhaEmailLockedAfterOnboardingErr();
    }

    const emailUpdate = await resolveAdminEmailUpdate({
      userId,
      organizationId,
      isHhaManaged: true,
      email: req.body.email,
    });

    const {success: lookedUp, doc: holder} = await findOrgUserByEmail({
      email: emailUpdate.email,
      organizationId,
    });

    if (lookedUp && holder && holder.id !== userId) {
      throw HhaExchangeErrorsFactories.hhaEmailInUseErr();
    }

    const {success, error} = await UsersServices.updateOne({
      id: userId,
      data: emailUpdate,
    });

    if (error && isDocumentDuplicationError({error})) {
      throw HhaExchangeErrorsFactories.hhaEmailInUseErr();
    }

    if (!lookedUp || !success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update the login email',
      });
    }

    // Best effort: the next sync auto-resolves them anyway; closing now lets
    // the admin send the invitation straight away.
    await HhaSyncWorklistServices.closeUserEmailExceptions({
      userId,
      organizationId,
      resolvedByUserId: req.extra.jwtToken.user.id,
    });

    return HhaExchangeResponsesFactories.emailConflictUserUpdated({
      userId,
      email: emailUpdate.email,
    });
  }

  /** PATCH /integration/sync/email-conflicts/pending/:id */
  static async updatePendingImportEmail(req, res, next) {
    const {success, doc, isFound, isEmailFree, isImported} =
      await HhaSyncWorklistServices.setPendingLoginEmail({
        id: req.params.id,
        organizationId: getOrganizationId({req}),
        email: req.body.email,
        userId: req.extra.jwtToken.user.id,
      });

    if (!isFound) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'This person is no longer waiting for an email',
      });
    }

    if (!isEmailFree) throw HhaExchangeErrorsFactories.hhaEmailInUseErr();

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to save the login email',
      });
    }

    return HhaExchangeResponsesFactories.pendingImportEmailSaved({
      member: doc,
      isImported,
    });
  }

  /** GET /integration/sync/coordinators */
  static async listCoordinatorPatients(req, res, next) {
    const {page, limit, skip} = getListParams({req});

    const {success, docs, count} =
      await HhaSyncWorklistServices.listCoordinatorPatients({
        organizationId: getOrganizationId({req}),
        choice: req.query.choice,
        skip,
        take: limit,
      });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch HHAeXchange patient coordinators',
      });
    }

    return HhaExchangeResponsesFactories.coordinatorPatientsListRetrieved({
      coordinatorPatients: docs,
      meta: buildMeta({page, limit, count}),
    });
  }

  /** PATCH /integration/patients/:patientId/case-manager */
  static async selectPatientCaseManager(req, res, next) {
    const {success, doc, isPatientFound, isSelectable} =
      await HhaSyncWorklistServices.selectPatientCaseManager({
        patientId: req.params.patientId,
        organizationId: getOrganizationId({req}),
        caseManagerProfileId: req.body.caseManagerProfileId,
      });

    if (!isPatientFound) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    if (!isSelectable) {
      throw HhaExchangeErrorsFactories.hhaCoordinatorNotSelectableErr();
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update the case manager of this patient',
      });
    }

    return HhaExchangeResponsesFactories.patientCaseManagerSelected({
      coordinatorPatient: doc,
    });
  }

  /** A link conflict closes only by a choice, and reopens only to ask it again. */
  static async reopenLinkConflict({req, linkConflict}) {
    const {reopen, choiceRequiredErr, notReopenableErr} =
      LINK_CONFLICT_HANDLERS[linkConflict.type];

    if (req.body.status !== HHA_SYNC_EXCEPTION_STATUSES.OPEN.value) {
      throw choiceRequiredErr();
    }

    const {success, doc, isReopenable} = await reopen({
      exception: linkConflict,
      organizationId: getOrganizationId({req}),
      userId: req.extra.jwtToken.user.id,
    });

    if (!isReopenable) throw notReopenableErr();

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update HHAeXchange sync exception',
      });
    }

    return HhaExchangeResponsesFactories.syncExceptionUpdated({
      syncException: doc,
    });
  }

  /** PATCH /integration/patients/:patientId/primary-nurse */
  static async selectPatientPrimaryNurse(req, res, next) {
    const {success, doc, isPatientFound, isConflictOpen} =
      await HhaSyncWorklistServices.selectPatientPrimaryNurse({
        patientId: req.params.patientId,
        organizationId: getOrganizationId({req}),
        choice: req.body.choice,
        userId: req.extra.jwtToken.user.id,
      });

    if (!isPatientFound) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    if (!isConflictOpen) {
      throw HhaExchangeErrorsFactories.hhaPrimaryNurseConflictNotFoundErr();
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update the primary nurse of this patient',
      });
    }

    return HhaExchangeResponsesFactories.patientPrimaryNurseSelected({
      patientPrimaryNurse: doc,
    });
  }

  /** PATCH /integration/patients/:patientId/case-manager-conflict */
  static async settlePatientCaseManagerConflict(req, res, next) {
    const {success, doc, isPatientFound, isConflictOpen} =
      await HhaSyncWorklistServices.selectPatientCaseManagerConflict({
        patientId: req.params.patientId,
        organizationId: getOrganizationId({req}),
        choice: req.body.choice,
        userId: req.extra.jwtToken.user.id,
      });

    if (!isPatientFound) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    if (!isConflictOpen) {
      throw HhaExchangeErrorsFactories.hhaCaseManagerConflictNotFoundErr();
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update the case manager of this patient',
      });
    }

    return HhaExchangeResponsesFactories.patientCaseManagerConflictSettled({
      patientCaseManager: doc,
    });
  }

  /** GET /integration/sync/exceptions/:id/patients */
  static async listWaitingPatients(req, res, next) {
    const {page, limit, skip} = getListParams({req});

    const {success, docs, count, isExceptionFound} =
      await HhaSyncWorklistServices.listWaitingPatients({
        exceptionId: req.params.id,
        organizationId: getOrganizationId({req}),
        skip,
        take: limit,
      });

    if (!isExceptionFound) {
      throw HhaExchangeErrorsFactories.syncExceptionNotFoundErr();
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch the waiting patients',
      });
    }

    return HhaExchangeResponsesFactories.waitingPatientsListRetrieved({
      waitingPatients: docs,
      meta: buildMeta({page, limit, count}),
    });
  }
};
