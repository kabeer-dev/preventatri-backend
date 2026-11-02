const {Router} = require('express');

const checklistAssignmentsRoute = require('../checklistAssignments');
const emergencyFlagsRoute = require('../emergencyFlags');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  SUBMISSION_PERMISSIONS,
} = require('../../constants/aclConstants');

const {
  SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
  RESOLUTION_ATTACHMENT_FILE_SIZE_LIMIT,
  MAX_RESOLUTION_ATTACHMENTS,
} = require('../../constants/assessmentConstants');

const {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_RESOLUTION_ATTACHMENT_TYPES,
} = require('../../constants/file');
const {AssessmentsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
  fileUploadMiddleware,
  parseMultipartFormFieldsMiddleware,
} = require('../../middleware');

const {assessmentsSchema} = require('../../schemas');

const router = Router();

const TEMPLATE_ENTITY = SYSTEM_ENTITIES.checklistTemplate.value;
const SUBMISSION_ENTITY = SYSTEM_ENTITIES.checklistSubmission.value;

// ==========================================
// CHECKLIST TEMPLATE ROUTES
// ==========================================

// POST /assessments/escalations/:escalationId/resolve (multipart/form-data) —
// assignee records the resolution for one escalation, optionally attaching up to
// 5 supporting files (field name `files`): images, PDF, or Word (.doc/.docx).
// Self-scoped by the service; no entity-level ACL.
router.post(
  '/escalations/:escalationId/resolve',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateEscalationIdParams,
    reqProperty: 'params',
  }),
  fileUploadMiddleware({
    allowedTypes: ALLOWED_RESOLUTION_ATTACHMENT_TYPES,
    fileSizeLimit: RESOLUTION_ATTACHMENT_FILE_SIZE_LIMIT,
    require: false,
    multiple: true,
    maxFiles: MAX_RESOLUTION_ATTACHMENTS,
  }),
  parseMultipartFormFieldsMiddleware,
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateResolveEscalationBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(AssessmentsController.resolveEscalation)
);

// GET /assessments/templates
router.get(
  '/templates',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateListTemplatesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(AssessmentsController.listTemplates)
);

// GET /assessments/templates/:id
router.get(
  '/templates/:id',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateTemplateIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateGetTemplateQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(AssessmentsController.getTemplate)
);

// POST /assessments/templates
router.post(
  '/templates',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateCreateTemplateBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(AssessmentsController.createTemplate)
);

// PATCH /assessments/templates/:id/status
router.patch(
  '/templates/:id/status',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateTemplateIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateUpdateTemplateStatusBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(AssessmentsController.updateTemplateStatus)
);

// PATCH /assessments/templates/:id
router.patch(
  '/templates/:id',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateTemplateIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateUpdateTemplateBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(AssessmentsController.updateTemplate)
);

// DELETE /assessments/templates/:id
router.delete(
  '/templates/:id',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateTemplateIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: TEMPLATE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(AssessmentsController.deleteTemplate)
);

// ==========================================
// CHECKLIST SUBMISSION ROUTES
// ==========================================

// GET /assessments/submissions
router.get(
  '/submissions',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateListSubmissionsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: SUBMISSION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(AssessmentsController.listSubmissions)
);

// GET /assessments/submissions/:id
router.get(
  '/submissions/:id',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateSubmissionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: SUBMISSION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(AssessmentsController.getSubmission)
);

// GET /assessments/escalations/assigned — caller's next assigned escalation to
// handle (oldest active RED, else oldest active YELLOW) plus per-color remaining
// counts. Self-scoped to the authenticated user; no entity-level ACL needed.
router.get(
  '/escalations/assigned',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateAssignedEscalationQuery,
    reqProperty: 'query',
  }),
  catchAsyncMiddleware(AssessmentsController.getAssignedEscalation)
);

// GET /assessments/escalations/:escalationId/submission — full details for
// one escalation. Org-scoped by the service; no entity-level ACL needed.
router.get(
  '/escalations/submission/:escalationId',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateEscalationIdParams,
    reqProperty: 'params',
  }),
  catchAsyncMiddleware(AssessmentsController.getEscalationSubmissionDetails)
);

// PATCH /assessments/escalations/:escalationId/accept — the current assignee
// accepts the flag, which stops its escalation. Self-scoped by the service; no
// entity-level ACL.
router.patch(
  '/escalations/:escalationId/accept',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateEscalationIdParams,
    reqProperty: 'params',
  }),
  catchAsyncMiddleware(AssessmentsController.acceptEscalation)
);

// PATCH /assessments/submissions/:id/void
router.patch(
  '/submissions/:id/void',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateSubmissionIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateVoidSubmissionBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: SUBMISSION_ENTITY,
    permissionKey: SUBMISSION_PERMISSIONS.VOID,
  }),
  catchAsyncMiddleware(AssessmentsController.voidSubmission)
);

// PATCH /assessments/submissions/:id/skip
router.patch(
  '/submissions/:id/skip',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateSubmissionIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateSkipSubmissionBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: SUBMISSION_ENTITY,
    permissionKey: SUBMISSION_PERMISSIONS.VOID,
  }),
  catchAsyncMiddleware(AssessmentsController.skipSubmission)
);

// PATCH /assessments/submissions/:id (multipart/form-data)
router.patch(
  '/submissions/:id',
  validatorMiddleware({
    validateFunction: assessmentsSchema.validateSubmissionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: SUBMISSION_ENTITY,
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
    validateFunction: assessmentsSchema.validateSubmissionUpdateRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(AssessmentsController.submitSubmission)
);

// ==========================================
// CHECKLIST ASSIGNMENT ROUTES (mounted at /assessments/assignments)
// ==========================================
router.use('/assignments', checklistAssignmentsRoute);

// ==========================================
// EMERGENCY FLAG ROUTES (mounted at /assessments/emergency-flags)
// ==========================================
router.use('/emergency-flags', emergencyFlagsRoute);

module.exports = router;
