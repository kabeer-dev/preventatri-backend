// Detail-box tone per flag severity. The flag-lifecycle notification copy always
// carries the severity word ("Red flag …" / "Yellow flag …"), so the box that
// holds the message uses the matching frontend severity tone and pill label.
// Any non-flag notification (follow-up task, supervisory visit) keeps the
// neutral note tone. Mirrors the in-app notification's coloring.

const {EMAIL_TONES} = require('./emailConstants');
const {NOTIFICATION_DOCUMENT_TYPES} = require('./notificationConstants');

const ALERT_BOX_STYLES = {
  red: {tone: EMAIL_TONES.critical, label: 'Red flag'},
  yellow: {tone: EMAIL_TONES.moderate, label: 'Yellow flag'},
  default: {tone: EMAIL_TONES.neutral, label: ''},
};

// Deep-link target per notification document type. Mirrors the frontend routes
// (DASHBOARD_ROOT + path) and the in-app notification click behaviour, so the
// email button opens the exact same record the recipient would see in-app.
const DOCUMENT_LINK_CONFIG = {
  [NOTIFICATION_DOCUMENT_TYPES.FLAG.value]: {
    pathPrefix: '/dashboard/emergency-flags/',
    label: 'View flag',
  },
  [NOTIFICATION_DOCUMENT_TYPES.FOLLOW_UP_TASK.value]: {
    pathPrefix: '/dashboard/follow-ups/',
    label: 'View task',
  },
  [NOTIFICATION_DOCUMENT_TYPES.SUPERVISORY_VISIT.value]: {
    pathPrefix: '/dashboard/supervisory-visits/',
    label: 'View visit',
  },
};

module.exports = {
  ALERT_BOX_STYLES,
  DOCUMENT_LINK_CONFIG,
};
