const assessmentsSchema = require('./assessmentsSchema');
const auditLogsSchema = require('./auditLogsSchema');

const usersSchema = require(`./usersSchema`);
const caregiversSchema = require('./caregiversSchema');
const caseManagersSchema = require('./caseManagersSchema');
const checklistAssignmentSchema = require('./checklistAssignmentSchema');
const countiesSchema = require('./countiesSchema');
const emergencyFlagSchema = require('./emergencyFlagSchema');
const followUpTasksSchema = require('./followUpTasksSchema');
const generalsSchema = require('./generalsSchema');
const globalSearchSchema = require('./globalSearchSchema');
const hhaExchangeSchema = require('./hhaExchangeSchema');
const notificationsSchema = require('./notificationsSchema');
const nursesSchema = require('./nursesSchema');
const patientsSchema = require('./patientsSchema');
const regionsSchema = require('./regionsSchema');
const reportsSchema = require('./reportsSchema');
const securitySchema = require('./securitySchema');
const superAdminSchema = require('./superAdminSchema');
const supervisoryVisitsSchema = require('./supervisoryVisitsSchema');
const triageEngineSchema = require('./triageEngineSchema');

module.exports = {
  usersSchema,
  generalsSchema,
  notificationsSchema,
  nursesSchema,
  caregiversSchema,
  patientsSchema,
  caseManagersSchema,
  regionsSchema,
  securitySchema,
  countiesSchema,
  assessmentsSchema,
  checklistAssignmentSchema,
  emergencyFlagSchema,
  supervisoryVisitsSchema,
  followUpTasksSchema,
  triageEngineSchema,
  auditLogsSchema,
  globalSearchSchema,
  hhaExchangeSchema,
  reportsSchema,
  superAdminSchema,
};
