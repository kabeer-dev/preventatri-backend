const sendEmail = require('../send');

const {
  OTP_EXPIRE_TIME_IN_SECONDS,
} = require('../../../constants/generalConstant');
const {convertSecondsToMinutes} = require('../../general');

module.exports = async ({user, otp}) => {
  const {email, firstName, lastName} = user;
  const name = `${firstName} ${lastName}`;

  const expiryMinutes = convertSecondsToMinutes({
    seconds: OTP_EXPIRE_TIME_IN_SECONDS,
  });

  const config = {
    templateName: 'sendOtp', // template file name in specific folder
    data: {name, otp, expiryMinutes},
    title: 'One Time Password - OTP',
  };

  await sendEmail({
    to: email,
    subject: 'One Time Password - OTP',
    templateConfig: config,
  });
};
