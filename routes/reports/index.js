const {Router} = require('express');

const {
  CRUD_PERMISSIONS,
  SYSTEM_ENTITIES,
} = require('../../constants/aclConstants');
const {ReportsController} = require('../../controllers');

const {
  aclAccessMiddleware,
  catchAsyncMiddleware,
  validatorMiddleware,
} = require('../../middleware');
const {reportsSchema} = require('../../schemas');

const router = Router();

const REPORT_ENTITY = SYSTEM_ENTITIES.report.value;

const viewReport = aclAccessMiddleware({
  entityToCheck: REPORT_ENTITY,
  permissionKey: CRUD_PERMISSIONS.VIEW,
});

const validateQuery = ({validateFunction}) =>
  validatorMiddleware({validateFunction, reqProperty: 'query'});

// KPI row and Performance by role. Admins only.
router.get(
  '/overview',
  validateQuery({validateFunction: reportsSchema.validateReportQuery}),
  viewReport,
  catchAsyncMiddleware(ReportsController.getOverview)
);

// Region scorecard. Admins only.
router.get(
  '/regions',
  validateQuery({validateFunction: reportsSchema.validateReportQuery}),
  viewReport,
  catchAsyncMiddleware(ReportsController.getRegions)
);

// Top high-risk patients for the period, no pagination. Admins only.
router.get(
  '/high-risk-patients',
  validateQuery({validateFunction: reportsSchema.validateReportQuery}),
  viewReport,
  catchAsyncMiddleware(ReportsController.getHighRiskPatients)
);

// Follow-up tasks and Supervisory visits cards. Admins only.
router.get(
  '/work-items',
  validateQuery({validateFunction: reportsSchema.validateReportQuery}),
  viewReport,
  catchAsyncMiddleware(ReportsController.getWorkItems)
);

// Coverage gaps, live counts only. Admins only.
router.get(
  '/coverage',
  validateQuery({validateFunction: reportsSchema.validateCoverageQuery}),
  viewReport,
  catchAsyncMiddleware(ReportsController.getCoverage)
);

module.exports = router;
