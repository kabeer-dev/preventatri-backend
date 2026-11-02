/* eslint-disable local-rules/no-spread-operator */
const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  SUBMISSION_PERMISSIONS,
} = require('../../constants/aclConstants');

const {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_AUDIO_TYPES,
} = require('../../constants/file');

const {
  RED_FLAG_AUDIO_FILE_SIZE_LIMIT,
} = require('../../constants/redFlagConstants');

const {EmergencyFlagController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
  fileUploadMiddleware,
  parseMultipartFormFieldsMiddleware,
} = require('../../middleware');

const {emergencyFlagSchema} = require('../../schemas');

const router = Router();

const EMERGENCY_FLAG_ENTITY = SYSTEM_ENTITIES.emergencyFlag.value;

// POST /emergency-flags (multipart/form-data)
router.post(
  '/',
  aclAccessMiddleware({
    entityToCheck: EMERGENCY_FLAG_ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  fileUploadMiddleware({
    allowedTypes: [...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES],
    fileSizeLimit: RED_FLAG_AUDIO_FILE_SIZE_LIMIT,
    require: false,
    anyFieldName: true,
  }),
  parseMultipartFormFieldsMiddleware,
  validatorMiddleware({
    validateFunction: emergencyFlagSchema.validateEmergencyFlagRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(EmergencyFlagController.createEmergencyFlag)
);

// GET /emergency-flags
router.get(
  '/',
  validatorMiddleware({
    validateFunction: emergencyFlagSchema.validateListQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: EMERGENCY_FLAG_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(EmergencyFlagController.listEmergencyFlags)
);

// GET /emergency-flags/:id
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: emergencyFlagSchema.validateIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: EMERGENCY_FLAG_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(EmergencyFlagController.getEmergencyFlag)
);

// PATCH /emergency-flags/:id/void
router.patch(
  '/:id/void',
  validatorMiddleware({
    validateFunction: emergencyFlagSchema.validateIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: emergencyFlagSchema.validateVoidEmergencyFlagBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: EMERGENCY_FLAG_ENTITY,
    permissionKey: SUBMISSION_PERMISSIONS.VOID,
  }),
  catchAsyncMiddleware(EmergencyFlagController.voidEmergencyFlag)
);

module.exports = router;
