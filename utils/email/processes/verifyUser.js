const sendEmail = require('../send');

const {
  accountVerificationTokenExpiry,
} = require('../../../constants/generalConstant');

module.exports = async ({user, verifyUrl}) => {
  const {email, firstName, lastName} = user;
  const name = `${firstName} ${lastName}`;

  const expiryHours = parseInt(accountVerificationTokenExpiry, 10) || 1;

  const infoText = `This link expires in <strong>${expiryHours} hour${expiryHours !== 1 ? 's' : ''}</strong>. If you didn&rsquo;t create an account, you can ignore this email.`;

  const config = {
    templateName: 'verifyUser',
    data: {name, infoText},
    actionButton: {
      url: verifyUrl,
      label: 'Verify email',
    },
    title: 'User Verification',
  };

  await sendEmail({
    to: email,
    subject: 'User Verification',
    templateConfig: config,
  });
};
