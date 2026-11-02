const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  SUPERVISORY_VISIT_PERMISSIONS,
} = require('../../constants/aclConstants');

const {
  SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
} = require('../../constants/assessmentConstants');

const {ALLOWED_TASK_EVIDENCE_TYPES} = require('../../constants/file');

const {SupervisoryVisitsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
  fileUploadMiddleware,
  parseMultipartFormFieldsMiddleware,
} = require('../../middleware');

const {supervisoryVisitsSchema} = require('../../schemas');

const router = Router();

const ENTITY = SYSTEM_ENTITIES.supervisoryVisit.value;

const validateParams = validatorMiddleware({
  validateFunction: supervisoryVisitsSchema.validateVisitIdParams,
  reqProperty: 'params',
});

// Edit / cancel: admins, nurses, case managers.
const canUpdate = aclAccessMiddleware({
  entityToCheck: ENTITY,
  permissionKey: CRUD_PERMISSIONS.UPDATE,
});

// File: the controller checks the assignee.
const canComplete = aclAccessMiddleware({
  entityToCheck: ENTITY,
  permissionKey: SUPERVISORY_VISIT_PERMISSIONS.COMPLETE,
});

// Approve / request correction: admins and case managers, never the filer.
const canReview = aclAccessMiddleware({
  entityToCheck: ENTITY,
  permissionKey: SUPERVISORY_VISIT_PERMISSIONS.REVIEW,
});

// GET /supervisory-visits/assignees?patientId=&roles= (before /:id)
router.get(
  '/assignees',
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateAssigneesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(SupervisoryVisitsController.listAssignees)
);

// POST /supervisory-visits
router.post(
  '/',
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateCreateVisitBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(SupervisoryVisitsController.createVisit)
);

// GET /supervisory-visits
router.get(
  '/',
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateListVisitsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(SupervisoryVisitsController.listVisits)
);

// GET /supervisory-visits/:id
router.get(
  '/:id',
  validateParams,
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(SupervisoryVisitsController.getVisit)
);

// PATCH /supervisory-visits/:id -- edit
router.patch(
  '/:id',
  validateParams,
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateUpdateVisitBody,
    reqProperty: 'body',
  }),
  canUpdate,
  catchAsyncMiddleware(SupervisoryVisitsController.updateVisit)
);

// PATCH /supervisory-visits/:id/cancel
router.patch(
  '/:id/cancel',
  validateParams,
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateCancelVisitBody,
    reqProperty: 'body',
  }),
  canUpdate,
  catchAsyncMiddleware(SupervisoryVisitsController.cancelVisit)
);

// PREVENT-772: reopen removed for now; uncomment to restore.
// // PATCH /supervisory-visits/:id/reopen
// router.patch(
//   '/:id/reopen',
//   validateParams,
//   canUpdate,
//   catchAsyncMiddleware(SupervisoryVisitsController.reopenVisit)
// );

// PATCH /supervisory-visits/:id/complete -- multipart: outcome, findings,
// answers, evidence and queued follow-ups
router.patch(
  '/:id/complete',
  validateParams,
  canComplete,

  // Any field name: evidence under `files`, checklist photos per question.
  fileUploadMiddleware({
    allowedTypes: ALLOWED_TASK_EVIDENCE_TYPES,
    fileSizeLimit: SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
    require: false,
    anyFieldName: true,
  }),
  parseMultipartFormFieldsMiddleware,
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateCompleteVisitBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(SupervisoryVisitsController.completeVisit)
);

// PATCH /supervisory-visits/:id/approve
router.patch(
  '/:id/approve',
  validateParams,
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateApproveVisitBody,
    reqProperty: 'body',
  }),
  canReview,
  catchAsyncMiddleware(SupervisoryVisitsController.approveVisit)
);

// PATCH /supervisory-visits/:id/request-correction
router.patch(
  '/:id/request-correction',
  validateParams,
  validatorMiddleware({
    validateFunction: supervisoryVisitsSchema.validateRequestCorrectionBody,
    reqProperty: 'body',
  }),
  canReview,
  catchAsyncMiddleware(SupervisoryVisitsController.requestCorrection)
);

module.exports = router;
