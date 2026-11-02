const config = require('config');

const {Resend} = require('resend');

const {
  getFromContentForSendingEmail,
  renderModularTemplate,
} = require('./utils');
const Queue = require('../queue');

const {EMAIL_RATE_LIMIT_DELAY} = require('../../constants/generalConstant');
const logger = require('../../middleware/loggerMiddleware');

const resendApiKey = config.get('resendAPIKey');

const resend = new Resend(resendApiKey);

const emailQueue = new Queue({RATE_LIMIT_DELAY: EMAIL_RATE_LIMIT_DELAY});

module.exports = async ({to, subject, templateConfig, attachments = []}) => {
  //  This will be uncommented in the case of having auto reminders to prevent wasting balances on unncessary emails
  //  Currently we don't send auto emails, so sending emails is necessary for testing and development purposes
  // if (config.get('env') !== config.get('envVariables.prod')) return;

  const html = renderModularTemplate(templateConfig);

  const emailData = {to, from: getFromContentForSendingEmail(), subject, html};

  if (attachments.length > 0) {
    emailData.attachments = attachments;
  }

  try {
    const response = await emailQueue.add({
      action: () => resend.emails.send(emailData),
    });

    if (response.error) {
      throw new Error(response.error.message || response.error.error);
    }
  } catch (error) {
    logger.error(error);
  }
};
