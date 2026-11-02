const config = require('config');
const twilio = require('twilio');

const logger = require('../../middleware/loggerMiddleware');

const accountSid = config.get('twilioAccountSid');
const authToken = config.get('twilioAuthToken');

const client = twilio(accountSid, authToken);

module.exports = async ({to, from, body, mediaUrl = null}) => {
  const messageData = {to, from, body};

  if (mediaUrl) {
    messageData.mediaUrl = mediaUrl;
  }

  try {
    await client.messages.create(messageData);
  } catch (error) {
    if (error.response) logger.error(error.response);
  }
};
