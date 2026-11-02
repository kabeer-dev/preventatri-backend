const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({
  user,
  locale,
  token,
  invitingUser,
  role,
  organizationName,
}) => {
  const url = generateUrl({
    path: 'accept-organization-invitation',
    locale,
    params: token,
  });

  await emailNotificationProcesses.organizationInvitation({
    user,
    url,
    invitingUser,
    role,
    organizationName,
  });
};
