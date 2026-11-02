const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({user, locale, token, invitingUser, role}) => {
  const url = generateUrl({
    path: 'auth/accept-invitation',
    locale,
    params: token,
  });
  await emailNotificationProcesses.inviteUser({user, url, invitingUser, role});
};
