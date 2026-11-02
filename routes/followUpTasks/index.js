const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  SUBMISSION_PERMISSIONS,
  FOLLOW_UP_TASK_PERMISSIONS,
} = require('../../constants/aclConstants');

const {
  SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
} = require('../../constants/assessmentConstants');

const {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_TASK_EVIDENCE_TYPES,
} = require('../../constants/file');

const {FollowUpTasksController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
  fileUploadMiddleware,
  parseMultipartFormFieldsMiddleware,
} = require('../../middleware');

const {followUpTasksSchema} = require('../../schemas');

const router = Router();

const ENTITY = SYSTEM_ENTITIES.followUpTask.value;

const validateParams = validatorMiddleware({
  validateFunction: followUpTasksSchema.validateTaskIdParams,
  reqProperty: 'params',
});

// Edit / cancel: admins, nurses, case managers.
const canUpdate = aclAccessMiddleware({
  entityToCheck: ENTITY,
  permissionKey: CRUD_PERMISSIONS.UPDATE,
});

// Complete: every care-team role; the controller checks the assignee.
const canComplete = aclAccessMiddleware({
  entityToCheck: ENTITY,
  permissionKey: FOLLOW_UP_TASK_PERMISSIONS.COMPLETE,
});

// GET /follow-up-tasks/assignees?patientId= (before /:id)
router.get(
  '/assignees',
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateAssigneesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(FollowUpTasksController.listAssignees)
);

// POST /follow-up-tasks
router.post(
  '/',
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateCreateTaskBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(FollowUpTasksController.createTask)
);

// GET /follow-up-tasks
router.get(
  '/',
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateListTasksQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(FollowUpTasksController.listTasks)
);

// GET /follow-up-tasks/:id
router.get(
  '/:id',
  validateParams,
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(FollowUpTasksController.getTask)
);

// PATCH /follow-up-tasks/:id -- edit
router.patch(
  '/:id',
  validateParams,
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateUpdateTaskBody,
    reqProperty: 'body',
  }),
  canUpdate,
  catchAsyncMiddleware(FollowUpTasksController.updateTask)
);

// PATCH /follow-up-tasks/:id/cancel
router.patch(
  '/:id/cancel',
  validateParams,
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateCancelTaskBody,
    reqProperty: 'body',
  }),
  canUpdate,
  catchAsyncMiddleware(FollowUpTasksController.cancelTask)
);

// PREVENT-772: reopen removed for now; uncomment to restore.
// // PATCH /follow-up-tasks/:id/reopen
// router.patch(
//   '/:id/reopen',
//   validateParams,
//   canUpdate,
//   catchAsyncMiddleware(FollowUpTasksController.reopenTask)
// );

// PATCH /follow-up-tasks/:id/submit (legacy one-shot submission)
router.patch(
  '/:id/submit',
  validateParams,
  aclAccessMiddleware({
    entityToCheck: ENTITY,
    permissionKey: SUBMISSION_PERMISSIONS.SUBMIT,
  }),
  fileUploadMiddleware({
    allowedTypes: ALLOWED_IMAGE_TYPES,
    fileSizeLimit: SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
    require: false,
    anyFieldName: true,
  }),
  parseMultipartFormFieldsMiddleware,
  validatorMiddleware({
    validateFunction: followUpTasksSchema.validateSubmitTaskBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(FollowUpTasksController.submitTask)
);

// PATCH /follow-up-tasks/:id/complete -- multipart: outcome, notes, evidence, answers
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
    validateFunction: followUpTasksSchema.validateCompleteTaskBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(FollowUpTasksController.completeTask)
);

module.exports = router;
