const usersRoute = require(`./users`);
const publicRoute = require(`./publics`);
const privateRoute = require(`./privates`);
const healthRoute = require(`./health`);
const nursesRoute = require(`./nurses`);
const caregiversRoute = require(`./caregivers`);
const patientsRoute = require(`./patients`);
const hhaExchangeRoute = require(`./hhaExchange`);
const caseManagersRoute = require(`./caseManagers`);
const organizationsRoute = require(`./organizations`);
const regionsRoute = require(`./regions`);
const reportsRoute = require(`./reports`);
const countiesRoute = require(`./counties`);
const assessmentsRoute = require(`./assessments`);
const supervisoryVisitsRoute = require(`./supervisoryVisits`);
const followUpTasksRoute = require(`./followUpTasks`);
const triageEngine = require(`./triageEngine`);
const notificationsRoute = require(`./notifications`);
const auditLogsRoute = require(`./auditLogs`);
const globalSearchRoute = require(`./globalSearch`);
const sessionsRoute = require(`./sessions`);
const securitiesRoute = require(`./securities`);
const superAdminRoute = require(`./superAdmin`);

module.exports = {
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
};
