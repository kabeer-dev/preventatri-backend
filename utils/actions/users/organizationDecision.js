const emailNotificationProcesses = require('../../email/processes');
const {generateUrl} = require('../../general');

module.exports = async ({user, locale, organizationName, action, reason}) => {
  const url = generateUrl({path: 'auth/login', locale});

  await emailNotificationProcesses.organizationDecision({
    user,
    url,
    organizationName,
    action,
    reason,
  });
};
