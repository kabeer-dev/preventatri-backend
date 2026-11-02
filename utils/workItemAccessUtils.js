const {modelConstants} = require('../constants');
const {PrismaFactory, GeneralErrorsFactories} = require('../factories');
const {resolveCaseManagerProfileId} = require('./caseManagerScopingUtils');
const {resolveNurseScope} = require('./nurseScopingUtils');
const PatientCareTeamServices = require('../services/patientCareTeamServices');

/**
 * Who is calling: user, org, role, active membership id, (for case managers)
 * their profile id and (for nurses) their patient scope. Every follow-up task /
 * supervisory visit route starts here.
 */
module.exports.resolveWorkItemActor = async ({token}) => {
  const userId = token.user.id;
  const {organizationId, role} = token.user.currentActiveOrganization;

  const {doc: userOrg} = await PrismaFactory.findOne({
    model: modelConstants.MODELS.USER_ORGANIZATION,
    query: {userId, organizationId, isActive: true},
    options: {bypassExtraQueries: true},
  });

  if (!userOrg)
    throw GeneralErrorsFactories.internalErr({
      customMessage: 'Active organization membership not found',
      statusCode: 403,
    });

  const caseManagerProfileId = await resolveCaseManagerProfileId({token});
  const nurseScope = await resolveNurseScope({token});

  return {
    userId,
    organizationId,
    role,
    userOrgId: userOrg.id,
    caseManagerProfileId,
    nurseScope,
  };
};

// Lives on the service so services can use it without pulling in this
// (request-scoped) module; re-exported here for the access utils.
module.exports.resolveCareTeamMembers = ({
  userOrgIds,
  patientId,
  organizationId,
  roles,
  tx,
}) =>
  PatientCareTeamServices.resolveCareTeamMembers({
    userOrgIds,
    patientId,
    organizationId,
    roles,
    tx,
  });
