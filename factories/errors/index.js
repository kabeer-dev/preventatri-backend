const AppError = require('./app');
const AssessmentsErrorsFactories = require('./assessments');
const AuthErrorsFactories = require('./auth');
const CaregiversErrorsFactories = require('./caregivers');
const CaseManagersErrorsFactories = require('./caseManagers');
const ChecklistAssignmentErrorsFactories = require('./checklistAssignment');
const EmergencyFlagErrorsFactories = require('./emergencyFlag');
const FollowUpTasksErrorsFactories = require('./followUpTasks');
const GeneralErrorsFactories = require('./general');
const HhaExchangeErrorsFactories = require('./hhaExchange');
const IdempotencyErrorsFactories = require('./idempotency');
const NursesErrorsFactories = require('./nurses');
const PatientsErrorsFactories = require('./patients');
const RegionsErrorsFactories = require('./regions');
const SecuritiesErrorsFactories = require('./securities');
const SupervisoryVisitsErrorsFactories = require('./supervisoryVisits');
const UsersErrorsFactories = require('./users');

module.exports = {
  AppError,
  GeneralErrorsFactories,
  UsersErrorsFactories,
  AuthErrorsFactories,
  IdempotencyErrorsFactories,
  NursesErrorsFactories,
  RegionsErrorsFactories,
  CaregiversErrorsFactories,
  PatientsErrorsFactories,
  HhaExchangeErrorsFactories,
  CaseManagersErrorsFactories,
  AssessmentsErrorsFactories,
  ChecklistAssignmentErrorsFactories,
  EmergencyFlagErrorsFactories,
  SupervisoryVisitsErrorsFactories,
  FollowUpTasksErrorsFactories,
  SecuritiesErrorsFactories,
};
