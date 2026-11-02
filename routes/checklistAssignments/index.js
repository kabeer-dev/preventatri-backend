const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');

const {ChecklistAssignmentController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');

const {checklistAssignmentSchema} = require('../../schemas');

const router = Router();

const ASSIGNMENT_ENTITY = SYSTEM_ENTITIES.checklistAssignment.value;

// POST /assessments/assignments
router.post(
  '/',
  aclAccessMiddleware({
    entityToCheck: ASSIGNMENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  validatorMiddleware({
    validateFunction: checklistAssignmentSchema.validateAssignmentCreateRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(ChecklistAssignmentController.createAssignment)
);

// GET /assessments/assignments
router.get(
  '/',
  aclAccessMiddleware({
    entityToCheck: ASSIGNMENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  validatorMiddleware({
    validateFunction: checklistAssignmentSchema.validateListAssignmentsQuery,
    reqProperty: 'query',
  }),
  catchAsyncMiddleware(ChecklistAssignmentController.listAssignments)
);

// GET /assessments/assignments/:id
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: checklistAssignmentSchema.validateAssignmentIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: ASSIGNMENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(ChecklistAssignmentController.getAssignment)
);

// DELETE /assessments/assignments/:id
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: checklistAssignmentSchema.validateAssignmentIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: ASSIGNMENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(ChecklistAssignmentController.deleteAssignment)
);

module.exports = router;
