const sendEmail = require('../send');

const {
  accountUnlockTokenExpiry,
} = require('../../../constants/generalConstant');
const {getFullName, withOrganizationDetails} = require('../../userUtils');

module.exports = async ({user, unlockUrl}) => {
  const {email} = user;

  // Account-level message: the name in the primary organization.
  const person = await withOrganizationDetails({user});
  const name = getFullName({user: person}) || email;

  const expiryMinutes = parseInt(accountUnlockTokenExpiry, 10) || 30;

  const warningText = `<strong>Wasn&rsquo;t you?</strong> Someone may be trying to access your account. Reset your password after unlocking. This link expires in <strong>${expiryMinutes} minutes</strong>.`;

  const config = {
    templateName: 'unlockAccount',
    data: {name, expiryMinutes, warningText},
    actionButton: {url: unlockUrl, label: 'Unlock account'},
    title: 'Unlock Your Account',
  };

  await sendEmail({
    to: email,
    subject: 'Unlock Your Account',
    templateConfig: config,
  });
};
