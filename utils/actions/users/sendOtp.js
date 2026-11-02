const config = require('config');

const emailNotificationProcesses = require('../../email/processes');
const phoneNotificationProcesses = require('../../phone/processes');

module.exports.multiple = async ({user, OTPs}) => {
  if (config.get('env') === config.get('envVariables.prod')) {
    if (OTPs?.email) {
      await emailNotificationProcesses.sendOtp({
        user,
        otp: OTPs.email,
      });
    }

    if (OTPs?.phone) {
      await phoneNotificationProcesses.sendOtp({
        user,
        otp: OTPs.phone,
      });
    }
  }
};
