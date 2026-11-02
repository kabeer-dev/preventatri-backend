const AppResponse = require('./app');

const {
  HHA_EXCHANGE_SUCCESS_TYPES,
} = require('../../constants/responses/success/hhaExchange');

module.exports = class HhaExchangeResponsesFactories {
  /**
   * Outcome of a sync run, with its counters and every per-record exception.
   *
   * Keyed by resource -- {patients: {...}, caregivers: {...}} -- because the
   * resources succeed and fail independently: a night where patients imported
   * cleanly and the caregiver feed was down has to be legible as exactly that.
   */
  static syncCompleted({summaries}) {
    return new AppResponse({
      message: 'HHAeXchange sync completed successfully',
      statusCode: 200,
      body: {
        summary: summaries,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncCompleted.value,
      },
    });
  }

  /**
   * 202: the run is queued, so the response can say nothing about its outcome.
   * `runId` is the run's history row id and is echoed by the socket event.
   */
  static syncQueued({runId}) {
    return new AppResponse({
      message: 'HHAeXchange sync started',
      statusCode: 202,
      body: {
        runId,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncQueued.value,
      },
    });
  }

  /**
   * Lets a client that just loaded restore the Sync control's in-progress
   * state, rather than offering a button that would immediately 409.
   */
  static syncStatusRetrieved({isRunning}) {
    return new AppResponse({
      message: 'HHAeXchange sync status retrieved successfully',
      statusCode: 200,
      body: {
        isRunning,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncStatusRetrieved.value,
      },
    });
  }

  /**
   * A page of imported visits. `status` is returned as the raw HhaVisitStatus
   * enum value; the frontend maps it to a label and colour.
   */
  static hhaVisitsListRetrieved({hhaVisits, meta}) {
    return new AppResponse({
      message: 'HHAeXchange visits retrieved successfully',
      statusCode: 200,
      body: {
        hhaVisits,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.hhaVisitsListRetrieved.value,
      },
    });
  }

  static hhaVisitRetrieved({hhaVisit}) {
    return new AppResponse({
      message: 'HHAeXchange visit retrieved successfully',
      statusCode: 200,
      body: {
        hhaVisit,
        type: HHA_EXCHANGE_SUCCESS_TYPES.hhaVisitRetrieved.value,
      },
    });
  }

  static syncRunsListRetrieved({syncRuns, meta}) {
    return new AppResponse({
      message: 'HHAeXchange sync runs retrieved successfully',
      statusCode: 200,
      body: {
        syncRuns,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncRunsListRetrieved.value,
      },
    });
  }

  static syncRunRetrieved({syncRun}) {
    return new AppResponse({
      message: 'HHAeXchange sync run retrieved successfully',
      statusCode: 200,
      body: {
        syncRun,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncRunRetrieved.value,
      },
    });
  }

  /** Link-change entries carry fromLabel/toLabel, the names behind their ids. */
  static syncChangesListRetrieved({syncChanges, meta}) {
    return new AppResponse({
      message: 'HHAeXchange sync changes retrieved successfully',
      statusCode: 200,
      body: {
        syncChanges,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncChangesListRetrieved.value,
      },
    });
  }

  static syncExceptionsListRetrieved({syncExceptions, meta}) {
    return new AppResponse({
      message: 'HHAeXchange sync exceptions retrieved successfully',
      statusCode: 200,
      body: {
        syncExceptions,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncExceptionsListRetrieved.value,
      },
    });
  }

  static syncExceptionCountsRetrieved({total, byType}) {
    return new AppResponse({
      message: 'HHAeXchange sync exception counts retrieved successfully',
      statusCode: 200,
      body: {
        total,
        byType,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncExceptionCountsRetrieved.value,
      },
    });
  }

  static syncExceptionUpdated({syncException}) {
    return new AppResponse({
      message: 'HHAeXchange sync exception updated successfully',
      statusCode: 200,
      body: {
        syncException,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncExceptionUpdated.value,
      },
    });
  }

  static emailConflictsListRetrieved({emailConflicts, meta}) {
    return new AppResponse({
      message: 'HHAeXchange shared emails retrieved successfully',
      statusCode: 200,
      body: {
        emailConflicts,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.emailConflictsListRetrieved.value,
      },
    });
  }

  static emailConflictUserUpdated({userId, email}) {
    return new AppResponse({
      message: 'Login email updated successfully',
      statusCode: 200,
      body: {
        userId,
        email,
        type: HHA_EXCHANGE_SUCCESS_TYPES.emailConflictUserUpdated.value,
      },
    });
  }

  static pendingImportEmailSaved({member, isImported}) {
    return new AppResponse({
      message: isImported
        ? 'Login email saved and the person imported from HHAeXchange.'
        : 'Login email saved. The next sync imports this person.',
      statusCode: 200,
      body: {
        member,
        isImported,
        type: HHA_EXCHANGE_SUCCESS_TYPES.pendingImportEmailSaved.value,
      },
    });
  }

  static coordinatorPatientsListRetrieved({coordinatorPatients, meta}) {
    return new AppResponse({
      message: 'HHAeXchange patient coordinators retrieved successfully',
      statusCode: 200,
      body: {
        coordinatorPatients,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.coordinatorPatientsListRetrieved.value,
      },
    });
  }

  static patientCaseManagerSelected({coordinatorPatient}) {
    return new AppResponse({
      message: 'Case manager updated successfully',
      statusCode: 200,
      body: {
        coordinatorPatient,
        type: HHA_EXCHANGE_SUCCESS_TYPES.patientCaseManagerSelected.value,
      },
    });
  }

  static syncExceptionCountyAdded({exceptionCounty}) {
    return new AppResponse({
      message: 'County added to the region successfully',
      statusCode: 200,
      body: {
        exceptionCounty,
        type: HHA_EXCHANGE_SUCCESS_TYPES.syncExceptionCountyAdded.value,
      },
    });
  }

  static patientPrimaryNurseSelected({patientPrimaryNurse}) {
    return new AppResponse({
      message: 'Primary nurse updated successfully',
      statusCode: 200,
      body: {
        patientPrimaryNurse,
        type: HHA_EXCHANGE_SUCCESS_TYPES.patientPrimaryNurseSelected.value,
      },
    });
  }

  static patientCaseManagerConflictSettled({patientCaseManager}) {
    return new AppResponse({
      message: 'Case manager updated successfully',
      statusCode: 200,
      body: {
        patientCaseManager,
        type: HHA_EXCHANGE_SUCCESS_TYPES.patientCaseManagerConflictSettled
          .value,
      },
    });
  }

  static waitingPatientsListRetrieved({waitingPatients, meta}) {
    return new AppResponse({
      message: 'Waiting patients retrieved successfully',
      statusCode: 200,
      body: {
        waitingPatients,
        meta,
        type: HHA_EXCHANGE_SUCCESS_TYPES.waitingPatientsListRetrieved.value,
      },
    });
  }
};
