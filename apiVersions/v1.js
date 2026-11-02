const {
  authMiddleware,
  superAdminMiddleware,
  hhaOrganizationMiddleware,
} = require('../middleware');

const {
  usersRoute,
  publicRoute,
  privateRoute,
  healthRoute,
  nursesRoute,
  caregiversRoute,
  patientsRoute,
  hhaExchangeRoute,
  caseManagersRoute,
  organizationsRoute,
  regionsRoute,
  reportsRoute,
  countiesRoute,
  assessmentsRoute,
  supervisoryVisitsRoute,
  followUpTasksRoute,
  triageEngine,
  notificationsRoute,
  auditLogsRoute,
  globalSearchRoute,
  sessionsRoute,
  securitiesRoute,
  superAdminRoute,
} = require(`../routes`);

const apiPrefix = '/api/v1/';

const prepareV1Routes = ({app}) => {
  app.use(`${apiPrefix}health`, healthRoute); // Health check endpoints (no auth required)
  app.use(`${apiPrefix}users`, usersRoute); // This route is public mostly and whenever it's not, it's protected by the authMiddleware inside the specific route
  app.use(`${apiPrefix}public`, publicRoute);
  app.use(`${apiPrefix}private`, authMiddleware, privateRoute);
  app.use(`${apiPrefix}nurses`, authMiddleware, nursesRoute); // Nurses routes (all protected by authMiddleware)
  app.use(`${apiPrefix}caregivers`, authMiddleware, caregiversRoute); // Caregivers routes (all protected by authMiddleware)
  app.use(`${apiPrefix}patients`, authMiddleware, patientsRoute); // Patients routes (all protected by authMiddleware)
  app.use(
    `${apiPrefix}integration`,
    authMiddleware,
    hhaOrganizationMiddleware,
    hhaExchangeRoute
  ); // External-integration routes, HHAeXchange today (protected by authMiddleware, and only for the organization the integration is connected to)
  app.use(`${apiPrefix}case-managers`, authMiddleware, caseManagersRoute); // Case Managers routes (all protected by authMiddleware)
  app.use(`${apiPrefix}organizations`, authMiddleware, organizationsRoute); // Organizations routes (all protected by authMiddleware)
  app.use(`${apiPrefix}regions`, authMiddleware, regionsRoute); // Regions routes (all protected by authMiddleware)
  app.use(`${apiPrefix}counties`, authMiddleware, countiesRoute); // Counties routes (all protected by authMiddleware)
  app.use(`${apiPrefix}assessments`, authMiddleware, assessmentsRoute); // Assessments routes (all protected by authMiddleware)
  app.use(
    `${apiPrefix}supervisory-visits`,
    authMiddleware,
    supervisoryVisitsRoute
  ); // Supervisory Visits routes (all protected by authMiddleware)
  app.use(`${apiPrefix}follow-up-tasks`, authMiddleware, followUpTasksRoute); // Follow-Up Tasks routes (all protected by authMiddleware)
  app.use(`${apiPrefix}triage-engine`, authMiddleware, triageEngine); // Triage Engine routes (all protected by authMiddleware)
  app.use(`${apiPrefix}notifications`, authMiddleware, notificationsRoute); // Notifications routes (all protected by authMiddleware)
  app.use(`${apiPrefix}audit-logs`, authMiddleware, auditLogsRoute); // Audit Logs routes (all protected by authMiddleware)
  app.use(`${apiPrefix}search`, authMiddleware, globalSearchRoute); // Global Search routes (all protected by authMiddleware)
  app.use(`${apiPrefix}sessions`, authMiddleware, sessionsRoute); // Sessions routes (all protected by authMiddleware)
  app.use(`${apiPrefix}securities`, authMiddleware, securitiesRoute); // Securities routes (all protected by authMiddleware)
  app.use(`${apiPrefix}reports`, authMiddleware, reportsRoute); // Reports routes (all protected by authMiddleware)
  app.use(
    `${apiPrefix}super-admin`,
    authMiddleware,
    superAdminMiddleware,
    superAdminRoute
  ); // Super admin routes (the super admin only)
};

module.exports = {apiPrefix, prepareV1Routes};
