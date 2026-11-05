const AssessmentsServices = require(`./assessmentsServices`);
const ChecklistAssignmentServices = require(`./checklistAssignmentServices`);
const UsersServices = require(`./usersServices`);
const SessionsServices = require(`./sessionsServices`);
const GeneralServices = require(`./generalServices`);
const GlobalSearchServices = require(`./globalSearchServices`);
const PermissionsServices = require(`./permissionsServices`);
const NursesServices = require(`./nursesServices`);
const CaregiversServices = require(`./caregiversServices`);
const HhaCaregiverSyncServices = require(`./hhaCaregiverSyncServices`);
const HhaCoordinatorSyncServices = require(`./hhaCoordinatorSyncServices`);
const HhaCredentialsServices = require(`./hhaCredentialsServices`);
const HhaExchangeServices = require(`./hhaExchangeServices`);
const HhaNurseSyncServices = require(`./hhaNurseSyncServices`);
const HhaPatientSyncServices = require(`./hhaPatientSyncServices`);
const HhaSyncHistoryReadServices = require(`./hhaSyncHistoryReadServices`);
const HhaSyncReportingServices = require(`./hhaSyncReportingServices`);
const HhaSyncServices = require(`./hhaSyncServices`);
const HhaSyncWorklistServices = require(`./hhaSyncWorklistServices`);
const HhaVisitSyncServices = require(`./hhaVisitSyncServices`);
const HhaVisitsServices = require(`./hhaVisitsServices`);
const PatientsServices = require(`./patientsServices`);
const CaseManagersServices = require(`./caseManagersServices`);
const OrganizationsServices = require(`./organizationsServices`);

const OrganizationInvitationsServices = require(
  `./organizationInvitationsServices`
);
const RegionsServices = require(`./regionsServices`);

const ReportsCoverageServices = require(`./reportsCoverageServices`);

const ReportsHighRiskPatientsServices = require(
  `./reportsHighRiskPatientsServices`
);
const ReportsOverviewServices = require(`./reportsOverviewServices`);
const ReportsRegionsServices = require(`./reportsRegionsServices`);
const ReportsWorkItemsServices = require(`./reportsWorkItemsServices`);
const AuditServices = require(`./auditServices`);
const CountiesServices = require(`./countiesServices`);
const EscalationServices = require(`./escalationServices`);
const EscalationPolicyServices = require(`./escalationPolicyServices`);
const EmergencyFlagServices = require(`./emergencyFlagServices`);
const SupervisoryVisitsServices = require(`./supervisoryVisitsServices`);
const FollowUpTasksServices = require(`./followUpTasksServices`);

const FollowUpTaskSchedulerServices = require(
  `./followUpTaskSchedulerServices`
);

const SupervisoryVisitSchedulerServices = require(
  `./supervisoryVisitSchedulerServices`
);
const PatientCareTeamServices = require(`./patientCareTeamServices`);
const TriageEngineServices = require(`./triageEngineServices`);
const NotificationsServices = require(`./notificationsServices`);
const SecurityServices = require(`./securityServices`);

module.exports = {
  UsersServices,
  SessionsServices,
  GeneralServices,
  GlobalSearchServices,
  PermissionsServices,
  NursesServices,
  CaregiversServices,
  PatientsServices,
  HhaCaregiverSyncServices,
  HhaCoordinatorSyncServices,
  HhaCredentialsServices,
  HhaExchangeServices,
  HhaNurseSyncServices,
  HhaPatientSyncServices,
  HhaSyncHistoryReadServices,
  HhaSyncReportingServices,
  HhaSyncServices,
  HhaSyncWorklistServices,
  HhaVisitSyncServices,
  HhaVisitsServices,
  CaseManagersServices,
  OrganizationsServices,
  OrganizationInvitationsServices,
  RegionsServices,
  ReportsCoverageServices,
  ReportsHighRiskPatientsServices,
  ReportsOverviewServices,
  ReportsRegionsServices,
  ReportsWorkItemsServices,
  AuditServices,
  CountiesServices,
  AssessmentsServices,
  ChecklistAssignmentServices,
  EmergencyFlagServices,
  EscalationPolicyServices,
  SupervisoryVisitsServices,
  FollowUpTasksServices,
  FollowUpTaskSchedulerServices,
  SupervisoryVisitSchedulerServices,
  PatientCareTeamServices,
  EscalationServices,
  TriageEngineServices,
  NotificationsServices,
  SecurityServices,
};
