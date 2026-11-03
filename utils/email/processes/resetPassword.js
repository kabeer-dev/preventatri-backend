const sendEmail = require('../send');

const {
  passwordResetTokenExpiry,
} = require('../../../constants/generalConstant');
const {withOrganizationDetails} = require('../../userUtils');

module.exports = async ({user, resetUrl}) => {
  // Account-level message: the name in the primary organization.
  const {email} = user;
  const {firstName, lastName} = await withOrganizationDetails({user});
  const name = `${firstName} ${lastName}`;

  const expiryMinutes = parseInt(passwordResetTokenExpiry, 10) || 30;

  const warningText = `This link expires in <strong>${expiryMinutes} minutes</strong>.`;

  const config = {
    templateName: 'resetPassword',
    data: {name, warningText},
    actionButton: {
      url: resetUrl,
      label: 'Reset password',
    },
    title: 'Reset Password',
  };

  await sendEmail({
    to: email,
    subject: 'Reset Password',
    templateConfig: config,
  });
};
