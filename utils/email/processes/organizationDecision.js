const sendEmail = require('../send');

// What each decision tells the organization's admin. Reject and suspend carry
// the reason the super admin gave, when there is one.
const DECISION_COPY = {
  approve: {
    title: 'Your organization was approved',
    message: (organizationName) =>
      `${organizationName} has been approved. You and everyone in it can log in now.`,
    hasLoginButton: true,
  },
  reject: {
    title: 'Your organization was not approved',
    message: (organizationName) =>
      `${organizationName} was not approved, so nobody in it can log in.`,
    hasLoginButton: false,
  },
  suspend: {
    title: 'Your organization was suspended',
    message: (organizationName) =>
      `${organizationName} has been suspended. Nobody in it can log in until it is reactivated.`,
    hasLoginButton: false,
  },
  reactivate: {
    title: 'Your organization was reactivated',
    message: (organizationName) =>
      `${organizationName} has been reactivated. You and everyone in it can log in again.`,
    hasLoginButton: true,
  },
};

module.exports = async ({user, url, organizationName, action, reason}) => {
  const copy = DECISION_COPY[action];

  const config = {
    templateName: 'organizationDecision',
    data: {
      title: copy.title,
      message: copy.message(organizationName),
      reason,
    },
    actionButton: copy.hasLoginButton ? {url, label: 'Log in'} : {},
    title: copy.title,
  };

  await sendEmail({
    to: user.email,
    subject: copy.title,
    templateConfig: config,
  });
};
