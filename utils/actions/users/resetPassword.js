const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({user, resetToken, locale}) => {
  const resetUrl = generateUrl({
    path: 'auth/reset',
    locale,
    params: resetToken,
  });
  await emailNotificationProcesses.resetPassword({user, resetUrl});

  return resetUrl;
};
