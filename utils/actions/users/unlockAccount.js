const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({user, unlockToken, locale}) => {
  const unlockUrl = generateUrl({
    path: 'auth/unlock-account',
    locale,
    params: unlockToken,
  });
  await emailNotificationProcesses.unlockAccount({user, unlockUrl});

  return unlockUrl;
};
