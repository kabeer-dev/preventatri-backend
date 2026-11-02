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
