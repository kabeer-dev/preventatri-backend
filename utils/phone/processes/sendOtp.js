const config = require('config');

const sendSms = require('../send');

const {
  OTP_EXPIRE_TIME_IN_SECONDS,
} = require('../../../constants/generalConstant');
const {convertSecondsToMinutes} = require('../../general');

module.exports = async ({user, otp}) => {
  const {phoneNo, firstName, lastName} = user;
  const name = `${firstName} ${lastName}`;

  const to = phoneNo;
  const from = config.get('twilioPhoneNumber');

  const body = `Hello ${name}, your login OTP is >>> ${otp} <<<. It will expire in ${convertSecondsToMinutes({seconds: OTP_EXPIRE_TIME_IN_SECONDS})} minutes.`;

  await sendSms({to, from, body});
};
