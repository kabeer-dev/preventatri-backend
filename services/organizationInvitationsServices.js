const {
  userInvitationTokenExpiry,
  ENTITY_STATUSES,
} = require('../constants/generalConstant');

const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {getPrismaClient} = require('../utils/databaseConnectionManager');
const {getCurrentTime} = require('../utils/dateUtils');
const {decodeToken, generateToken, verifyToken} = require('../utils/jwtUtils');

const PROFILE_MODEL_BY_ROLE = {
  [SYSTEM_ROLES.nurse.value]: 'nurseProfile',
  [SYSTEM_ROLES.caregiver.value]: 'caregiverProfile',
  [SYSTEM_ROLES.case_manager.value]: 'caseManagerProfile',
};

/**
 * Invitations into an organization for a person who already has an account.
 * The invitation lives on the membership: one person can hold several, and
 * accepting one must not touch the others or the account's password.
 */
module.exports = class OrganizationInvitationsServices {
  /**
   * Signs a fresh invitation for the pending membership and stores its secret,
   * so only the latest link works and accepting clears it.
   *
   * @returns {Promise<{success: boolean, token: string|null, error: Error|null}>}
   */
  static async issueInvitation({userId, organizationId, tx}) {
    try {
      const client = tx || getPrismaClient();

      const membership = await client.userOrganization.findFirst({
        where: {userId, organizationId, isActive: false},
      });

      if (!membership) return {success: true, token: null, error: null};

      const {token, secretKey} = generateToken({
        payload: {membership: {id: membership.id, userId, organizationId}},
        expiry: userInvitationTokenExpiry,
        isRandomSecretKeyNeeded: true,
      });

      await client.userOrganization.update({
        where: {id: membership.id},
        data: {invitationSecret: secretKey, invitationSentAt: getCurrentTime()},
      });

      return {success: true, token, error: null};
    } catch (error) {
      return {success: false, token: null, error};
    }
  }

  /**
   * Finds the pending membership a link was signed for and checks the link.
   * Nothing is returned for a link that is expired, replaced or already used.
   * The link's secret is stored on the membership, so the link alone proves it
   * was sent to this person.
   *
   * @returns {Promise<{success: boolean, membership: Object|null, error: Error|null}>}
   */
  static async getInvitationByToken({token, tx}) {
    try {
      const client = tx || getPrismaClient();

      const membershipId = decodeToken({token})?.membership?.id;

      if (!membershipId) return {success: true, membership: null, error: null};

      const membership = await client.userOrganization.findFirst({
        where: {id: membershipId, isActive: false},
        include: {organization: {select: {id: true, organizationName: true}}},
      });

      const isValid =
        membership?.invitationSecret &&
        verifyToken({token, dbSecretKey: membership.invitationSecret});

      return {
        success: true,
        membership: isValid ? membership : null,
        error: null,
      };
    } catch (error) {
      return {success: false, membership: null, error};
    }
  }

  /**
   * Turns the pending membership into a normal one and gives the profile the
   * status the admin chose when inviting.
   */
  static async acceptInvitation({membership, tx}) {
    try {
      const client = tx || getPrismaClient();

      const profileStatus =
        membership.pendingProfileStatus || ENTITY_STATUSES.ACTIVE.value;

      await client.userOrganization.update({
        where: {id: membership.id},
        data: {
          isActive: true,
          invitationSentAt: null,
          invitationSecret: null,
          pendingProfileStatus: null,
        },
      });

      const profileModel = PROFILE_MODEL_BY_ROLE[membership.role];

      if (profileModel) {
        await client[profileModel].updateMany({
          where: {
            userId: membership.userId,
            organizationId: membership.organizationId,
          },
          data: {status: profileStatus},
        });
      }

      return {success: true, error: null};
    } catch (error) {
      return {success: false, error};
    }
  }
};
