const {modelConstants} = require('../constants');
const {PrismaFactory} = require('../factories');
const {dateUtils, sessionUtils} = require('../utils');

module.exports = class SessionsServices {
  static async createSession({
    userId,
    secretKey,
    userAgent,
    ipAddress,
    platform,
    expiresAt,
  }) {
    return await PrismaFactory.create({
      model: modelConstants.MODELS.USER_SESSION,
      data: {userId, secretKey, userAgent, ipAddress, platform, expiresAt},
    });
  }

  static async renewSessionExpiry({id}) {
    const {success, error, isDocumentUpdated} = await PrismaFactory.updateOne({
      model: modelConstants.MODELS.USER_SESSION,
      query: {id},
      data: {expiresAt: sessionUtils.getSessionExpiresAt()},

      // Runs after aclAccessMiddleware, whose organizationId scope doesn't exist on UserSession.
      options: {bypassExtraQueries: true},
    });

    return {success, error, isDocumentUpdated};
  }

  static async setActiveOrganization({id, userId, organizationId}) {
    return await PrismaFactory.updateOne({
      model: modelConstants.MODELS.USER_SESSION,
      query: {id, userId},
      data: {activeOrganizationId: organizationId},
      options: {bypassExtraQueries: true},
    });
  }

  static async getSessionById({id, userId}) {
    return await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER_SESSION,
      query: {id, userId, expiresAt: {gte: new Date()}},
      options: {bypassExtraQueries: true},
    });
  }

  static async listActiveSessionsForUser({userId}) {
    return await PrismaFactory.find({
      model: modelConstants.MODELS.USER_SESSION,
      query: {userId, expiresAt: {gte: new Date()}},
      options: {sort: {expiresAt: 'desc'}, bypassExtraQueries: true},
      fieldsInclusion: {
        includeSpecificFields: [
          'id',
          'userAgent',
          'ipAddress',
          'platform',
          'createdAt',
        ],
      },
    });
  }

  static async deleteSessionById({id, userId}) {
    return await PrismaFactory.hardDeleteOne({
      model: modelConstants.MODELS.USER_SESSION,
      query: {id, userId},
      options: {bypassExtraQueries: true},
    });
  }

  static async deleteOtherSessionsForUser({userId, currentSessionId}) {
    return await PrismaFactory.hardDeleteMany({
      model: modelConstants.MODELS.USER_SESSION,
      query: {userId, id: {not: currentSessionId}},
      options: {bypassExtraQueries: true},
    });
  }

  static async deleteExpiredSessions() {
    return await PrismaFactory.hardDeleteMany({
      model: modelConstants.MODELS.USER_SESSION,
      query: {expiresAt: {lt: dateUtils.getCurrentTime()}},
      options: {bypassExtraQueries: true},
    });
  }

  static async deleteAllSessionsOfUser({userId}) {
    return await PrismaFactory.hardDeleteMany({
      model: modelConstants.MODELS.USER_SESSION,
      query: {userId},
      options: {bypassExtraQueries: true},
    });
  }
};
