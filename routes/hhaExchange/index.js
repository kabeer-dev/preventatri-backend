const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  HHA_EXCHANGE_PERMISSIONS,
} = require('../../constants/aclConstants');
const {HhaExchangeController} = require('../../controllers');

const {
  catchAsyncMiddleware,
  aclAccessMiddleware,
  validatorMiddleware,
} = require('../../middleware');
const {hhaExchangeSchema} = require('../../schemas');

const router = Router();

const HHA_EXCHANGE_ENTITY = SYSTEM_ENTITIES.hhaExchange.value;

/**
 * HHAeXchange Integration Routes
 *
 * Mounted at /integration and protected by authMiddleware. The path is
 * provider-neutral on purpose: the endpoint is the org's external-roster
 * import, and which vendor backs it is an implementation detail.
 *
 * ONE sync endpoint, not one per resource. A run reconciles every resource in
 * HHAX_SYNC_RESOURCES together, so /sync/<resource> would promise a granularity
 * the single run lock does not offer -- and the UI has one button. A future
 * import (authorizations) joins the same run and needs no route here.
 *
 * The /visits routes are the READ side of the import, and exist only because
 * visits are the one resource with no PreventaTri entity of their own to list
 * from: patients, caregivers and case managers are served by their own routes.
 */

// 🔄 Start an import of every HHAeXchange resource
// POST /integration/sync
// Access: Admins only (hhaExchange.sync permission)
//
// Returns 202: the run is queued, not performed in the request. No request
// body, so no validatorMiddleware.
router.post(
  '/sync',
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.SYNC,
  }),
  catchAsyncMiddleware(HhaExchangeController.syncHhaExchange)
);

// 🔎 Is a sync queued or running?
// GET /integration/sync/status
// Access: Admins only (hhaExchange.sync permission)
//
// Gated on SYNC, not VIEW_VISITS: whoever may start a run may ask about one.
router.get(
  '/sync/status',
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.SYNC,
  }),
  catchAsyncMiddleware(HhaExchangeController.getHhaSyncStatus)
);

// 🕑 Sync run history
// GET /integration/sync/runs
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/runs',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaSyncRunsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listSyncRuns)
);

// 🔍 One sync run
// GET /integration/sync/runs/:id
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/runs/:id',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaSyncIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.getSyncRun)
);

// 📝 Records the sync created or changed
// GET /integration/sync/changes
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/changes',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaSyncChangesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listSyncChanges)
);

// 🔢 Open exception counts by type
// GET /integration/sync/exceptions/counts
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/exceptions/counts',
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.getSyncExceptionCounts)
);

// ⚠️ Sync exceptions worklist
// GET /integration/sync/exceptions
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/exceptions',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaSyncExceptionsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listSyncExceptions)
);

// ✅ Resolve, dismiss or reopen a sync exception
// PATCH /integration/sync/exceptions/:id
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.patch(
  '/sync/exceptions/:id',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaSyncIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateUpdateHhaSyncExceptionBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.updateSyncException)
);

// 🏘️ Add a "county not set up" exception's county to a region
// POST /integration/sync/exceptions/:id/county
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.post(
  '/sync/exceptions/:id/county',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaSyncIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateAddHhaSyncExceptionCountyBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.addSyncExceptionCounty)
);

// 👥 Patients waiting for the nurse or case manager an exception names
// GET /integration/sync/exceptions/:id/patients
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/exceptions/:id/patients',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaSyncIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaWaitingPatientsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listWaitingPatients)
);

// 📧 People sharing one HHAeXchange email
// GET /integration/sync/email-conflicts
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/email-conflicts',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaEmailConflictsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listEmailConflicts)
);

// ✏️ Give one of them a unique login email
// PATCH /integration/sync/email-conflicts/users/:userId
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.patch(
  '/sync/email-conflicts/users/:userId',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaEmailConflictUserParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateUpdateHhaEmailConflictUserBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.updateEmailConflictUser)
);

// ✏️ Give a person who is not imported yet a login email
// PATCH /integration/sync/email-conflicts/pending/:id
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.patch(
  '/sync/email-conflicts/pending/:id',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaSyncIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateUpdateHhaEmailConflictUserBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.updatePendingImportEmail)
);

// 👥 Patients with more than one HHAeXchange coordinator
// GET /integration/sync/coordinators
// Access: Admins only (hhaExchange.viewSyncHistory permission)
router.get(
  '/sync/coordinators',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaCoordinatorPatientsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_SYNC_HISTORY,
  }),
  catchAsyncMiddleware(HhaExchangeController.listCoordinatorPatients)
);

// ✅ Choose which HHAeXchange coordinator is the patient's case manager
// PATCH /integration/patients/:patientId/case-manager
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.patch(
  '/patients/:patientId/case-manager',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaPatientParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateSelectHhaPatientCaseManagerBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.selectPatientCaseManager)
);

// ✅ Settle a primary nurse conflict: keep PreventaTri's nurse or take HHAeXchange's
// PATCH /integration/patients/:patientId/primary-nurse
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
router.patch(
  '/patients/:patientId/primary-nurse',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaPatientParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction:
      hhaExchangeSchema.validateSelectHhaPatientPrimaryNurseBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.selectPatientPrimaryNurse)
);

// ✅ Settle a case manager conflict: keep the current one or take HHAeXchange's
// PATCH /integration/patients/:patientId/case-manager-conflict
// Access: Admins only (hhaExchange.resolveSyncExceptions permission)
// The body is the same choice a primary nurse conflict takes.
router.patch(
  '/patients/:patientId/case-manager-conflict',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaPatientParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction:
      hhaExchangeSchema.validateSelectHhaPatientPrimaryNurseBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.RESOLVE_SYNC_EXCEPTIONS,
  }),
  catchAsyncMiddleware(HhaExchangeController.settlePatientCaseManagerConflict)
);

// 📋 List imported HHAeXchange visits
// GET /integration/visits
// Access: Admins only (hhaExchange.viewVisits permission)
router.get(
  '/visits',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateListHhaVisitsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_VISITS,
  }),
  catchAsyncMiddleware(HhaExchangeController.listHhaVisits)
);

// 🔍 One imported HHAeXchange visit
// GET /integration/visits/:id
// Access: Admins only (hhaExchange.viewVisits permission)
router.get(
  '/visits/:id',
  validatorMiddleware({
    validateFunction: hhaExchangeSchema.validateHhaVisitIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: HHA_EXCHANGE_ENTITY,
    permissionKey: HHA_EXCHANGE_PERMISSIONS.VIEW_VISITS,
  }),
  catchAsyncMiddleware(HhaExchangeController.getHhaVisit)
);

module.exports = router;
