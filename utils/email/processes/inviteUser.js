const sendEmail = require('../send');

const {SYSTEM_ROLES} = require('../../../constants/usersConstants');
const {getFullName} = require('../../userUtils');

module.exports = async ({user, url, invitingUser, role}) => {
  const {email} = user;

  const inviterName = invitingUser ? getFullName({user: invitingUser}) : '';
  const inviterEmail = invitingUser?.email;
  const roleLabel = SYSTEM_ROLES[role]?.label || role;

  const config = {
    templateName: 'inviteUser',
    data: {
      inviterName,
      inviterEmail,
      role: roleLabel,
      hasFacts: Boolean(inviterName || inviterEmail || roleLabel),
    },
    actionButton: {
      url: url,
      label: 'Accept invitation',
    },
    title: 'User Invitation',
  };

  await sendEmail({
    to: email,
    subject: 'User Invitation',
    templateConfig: config,
  });
};
