const sendEmail = require('../send');

const NotificationsHelpers = require('../../../helpers/notificationsHelpers');
const {getFrontendBaseUrl} = require('../../general');

// Email a notification/alert to a user. Mirrors the other email processes:
// takes the recipient user plus the already-rendered notification copy
// (title/description, shared with the in-app + SMS channels) and dispatches it
// through the modular `alert` template. Best-effort — sendEmail swallows its own
// errors so a mail failure never breaks the surrounding flow.
module.exports = async ({
  user,
  title,
  description,
  documentType = null,
  documentId = null,
}) => {
  const {email, firstName, lastName} = user;
  const name = [firstName, lastName].filter(Boolean).join(' ');

  const box = NotificationsHelpers.resolveBoxStyle({title, description});
  const baseUrl = getFrontendBaseUrl();

  const actionButton = NotificationsHelpers.buildActionButton({
    documentType,
    documentId,
    baseUrl,
  });

  const templateConfig = {
    templateName: 'alert',
    data: {
      name,
      title,
      description,
      alertTone: box.tone,
      alertLabel: box.label,
    },
    actionButton,
    title,
  };

  await sendEmail({
    to: email,
    subject: title,
    templateConfig,
  });
};
