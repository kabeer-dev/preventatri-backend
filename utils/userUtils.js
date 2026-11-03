const {MEMBERSHIP_DETAIL_FIELDS} = require('../constants/usersConstants');

/**
 * Public user fields that are safe to return to API clients by default
 * Defines fields to include in Prisma select operations for API responses
 * Secret fields (password, OTPs, secretKeys) are intentionally excluded
 */
const PUBLIC_USER_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNo: true,
  isVerified: true,
  language: true,
  createdAt: true,
  updatedAt: true,
  primaryOrgId: true,

  // Relations that are safe to include
  userOrganizations: true,
  permissions: true,
};

/**
 * Get Prisma select object for public user fields only
 * Ensures sensitive data (password, OTPs, secretKeys) is never fetched from DB
 * @returns {Object} Prisma select object
 */
module.exports.selectPublicUserFields = () => {
  return PUBLIC_USER_FIELDS;
};

/**
 * The per-organization person details out of a payload, with undefined fields
 * left out so an update never blanks a detail the caller did not send.
 */
const pickMembershipDetails = ({data}) => {
  return Object.fromEntries(
    MEMBERSHIP_DETAIL_FIELDS.filter(
      (field) => data && data[field] !== undefined
    ).map((field) => [field, data[field]])
  );
};

module.exports.pickMembershipDetails = pickMembershipDetails;

/**
 * Prisma select for a membership's person details, to put next to a `user`
 * select (or in place of its name fields).
 */
module.exports.MEMBERSHIP_DETAILS_SELECT = Object.fromEntries(
  MEMBERSHIP_DETAIL_FIELDS.map((field) => [field, true])
);

/**
 * The user with the person details of one organization on top, so responses
 * keep their shape while showing the right organization's name and phone.
 * Without a membership the account's own values stay.
 */
const withMembershipDetails = ({user, membership}) => {
  if (!user || !membership) return user;

  return Object.assign({}, user, pickMembershipDetails({data: membership}));
};

module.exports.withMembershipDetails = withMembershipDetails;

/**
 * The user with the person details of one organization, for a message. A
 * message about an organization passes its id; an account-level message (login
 * OTP, verify email, reset password) passes none and gets the primary
 * organization's. Uses the loaded memberships when the user has them, otherwise
 * reads the one membership. Without a membership the account's values stay.
 */
module.exports.withOrganizationDetails = async ({user, organizationId}) => {
  const targetOrganizationId = organizationId || user?.primaryOrgId;

  if (!user || !targetOrganizationId) return user;

  if (Array.isArray(user.userOrganizations)) {
    const membership = user.userOrganizations.find(
      (userOrganization) =>
        userOrganization.organizationId === targetOrganizationId &&
        !userOrganization.isDeleted
    );

    return withMembershipDetails({user, membership});
  }

  // Required here: usersServices requires this file.
  const UsersServices = require('../services/usersServices');

  const {doc: membership} = await UsersServices.getMembershipDetails({
    userId: user.id,
    organizationId: targetOrganizationId,
  });

  return withMembershipDetails({user, membership});
};

module.exports.getFullName = ({user}) => {
  return `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
};

// Name only, for a caregiver viewing a co-worker's record: no contact details.
module.exports.withoutContactDetails = ({user, hide}) => {
  if (!user || !hide) return user;

  return {firstName: user.firstName, lastName: user.lastName};
};

module.exports.getInitials = ({user}) => {
  return `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`.toUpperCase();
};

module.exports.sanitizeUser = ({user}) => {
  const plainUserObject = user?.toObject?.() || user;
  delete plainUserObject.password;

  // Delete JSON secret fields
  delete plainUserObject.secretKeys;
  delete plainUserObject.otps;

  // A membership carries the secret of its pending invitation link.
  if (Array.isArray(plainUserObject.userOrganizations)) {
    plainUserObject.userOrganizations = plainUserObject.userOrganizations.map(
      (membership) =>
        Object.fromEntries(
          Object.entries(membership).filter(
            ([key]) => key !== 'invitationSecret'
          )
        )
    );
  }

  return plainUserObject;
};
