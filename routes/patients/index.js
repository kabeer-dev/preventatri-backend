const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  PATIENT_PERMISSIONS,
} = require('../../constants/aclConstants');
const {PatientsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const {patientsSchema} = require('../../schemas');

const router = Router();

const PATIENT_ENTITY = SYSTEM_ENTITIES.patient.value;

/**
 * Patients CRUD Routes
 * All routes require authentication and organization context
 */

// ➕ Create patient
// POST /patients
// Access: Admins and Case Managers (patient.create permission)
router.post(
  '/',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientCreateRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(PatientsController.createPatient)
);

// 📖 List patients in organization
// GET /patients
// Access: Admins, Case Managers, and Nurses with patient.view permission
router.get(
  '/',
  validatorMiddleware({
    validateFunction: patientsSchema.validateListPatientsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(PatientsController.listPatients)
);

// 📊 Get patient dashboard stats
// GET /patients/stats
// Access: Authenticated users with patient.view permission
router.get(
  '/stats',
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(PatientsController.getPatientStats)
);

// 📅 Get patient upcoming assessments (next 7 days)
// GET /patients/:id/assessments
// Access: Admins and Caregivers only (nurses excluded)
router.get(
  '/:id/assessments',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: PATIENT_PERMISSIONS.VIEW_ASSESSMENTS,
  }),
  catchAsyncMiddleware(PatientsController.getPatientUpcomingAssessments)
);

// 🕒 Get patient timeline (paginated, newest first)
// GET /patients/:id/timeline?page=1&limit=25
// Access: Admins, Case Managers and Nurses (caregivers excluded)
router.get(
  '/:id/timeline',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientTimelineQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: PATIENT_PERMISSIONS.VIEW_TIMELINE,
  }),
  catchAsyncMiddleware(PatientsController.getPatientTimeline)
);

// 📊 Get patient details
// GET /patients/:id
// Access: Authenticated users with patient.view permission
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(PatientsController.getPatient)
);

// 🔄 Update patient
// PATCH /patients/:id
// Access: Admins and Case Managers (patient.update permission)
router.patch(
  '/:id',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientUpdateRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(PatientsController.updatePatient)
);

// 🗑️ Delete patient (soft delete)
// DELETE /patients/:id
// Access: Admins and Case Managers (patient.delete permission)
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: patientsSchema.validatePatientIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: PATIENT_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(PatientsController.deletePatient)
);

module.exports = router;
