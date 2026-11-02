const sendEmail = require('../send');

const {SYSTEM_ROLES} = require('../../../constants/usersConstants');
const {getFullName} = require('../../userUtils');

module.exports = async ({user, url, invitingUser, role, organizationName}) => {
  const {email} = user;

  const inviterName = invitingUser ? getFullName({user: invitingUser}) : '';
  const roleLabel = SYSTEM_ROLES[role]?.label || role;

  const config = {
    templateName: 'organizationInvitation',
    data: {inviterName, organizationName, role: roleLabel},
    actionButton: {
      url,
      label: 'Accept invitation',
    },
    title: 'Organization Invitation',
  };

  await sendEmail({
    to: email,
    subject: `Invitation to join ${organizationName}`,
    templateConfig: config,
  });
};
