const config = require('config');

const sendSms = require('../send');

const {
  OTP_EXPIRE_TIME_IN_SECONDS,
} = require('../../../constants/generalConstant');
const {convertSecondsToMinutes} = require('../../general');
const {withOrganizationDetails} = require('../../userUtils');

module.exports = async ({user, otp}) => {
  // The caller picks the number (a profile change verifies the new one); the
  // name is the primary organization's.
  const {phoneNo} = user;
  const {firstName, lastName} = await withOrganizationDetails({user});
  const name = `${firstName} ${lastName}`;

  const to = phoneNo;
  const from = config.get('twilioPhoneNumber');

  const body = `Hello ${name}, your login OTP is >>> ${otp} <<<. It will expire in ${convertSecondsToMinutes({seconds: OTP_EXPIRE_TIME_IN_SECONDS})} minutes.`;

  await sendSms({to, from, body});
};
