const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({user, locale, token}) => {
  const verifyUrl = generateUrl({
    path: 'auth/verify',
    locale,
    params: token,
  });
  await emailNotificationProcesses.verifyUser({user, verifyUrl});
};
