const {UAParser} = require('ua-parser-js');

const AppResponse = require('./app');

const {USER_SUCCESS_TYPES} = require('../../constants/responses/success/users');

const describeSession = ({session, currentSessionId}) => {
  const {browser, os, device} = new UAParser(
    session.userAgent || ''
  ).getResult();

  const deviceLabel =
    device?.vendor || device?.model
      ? [device.vendor, device.model].filter(Boolean).join(' ')
      : 'PC';

  return {
    id: session.id,
    device: deviceLabel,
    browser: browser?.name || 'Unknown browser',
    os: os?.name || 'Unknown OS',
    platform: session.platform,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    isCurrent: session.id === currentSessionId,
  };
};

module.exports = class UserSessionsResponsesFactories {
  static sessionsRetrieved({sessions, currentSessionId}) {
    return new AppResponse({
      message: 'Sessions retrieved successfully',
      statusCode: 200,
      body: {
        sessions: sessions.map((session) =>
          describeSession({session, currentSessionId})
        ),
        type: USER_SUCCESS_TYPES.sessionsRetrieved.value,
      },
    });
  }

  static sessionRevoked() {
    return new AppResponse({
      message: 'Session revoked successfully',
      statusCode: 200,
      body: {type: USER_SUCCESS_TYPES.sessionRevoked.value},
    });
  }

  static otherSessionsRevoked() {
    return new AppResponse({
      message: 'Signed out of all other devices successfully',
      statusCode: 200,
      body: {type: USER_SUCCESS_TYPES.otherSessionsRevoked.value},
    });
  }
};
