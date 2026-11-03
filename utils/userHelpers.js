const ms = require('ms');

const {toLuxonUTC, getCurrentTime} = require('./dateUtils');
const {safeMerge, getExistingSecretKeys} = require('./general');
const {isPlaceholderEmail} = require('./hhaExchange/placeholderEmailUtils');
const jwtUtils = require('./jwtUtils');
const {pickMembershipDetails} = require('./userUtils');

const {
  CAREGIVER_BLOCKED_STATUSES,
} = require('../constants/caregiversConstants');

const {
  ENTITY_STATUSES,
  userInvitationTokenExpiry,
} = require('../constants/generalConstant');

const {
  SYSTEM_ROLES,
  ROSTER_STATUSES,
  INVITATION_STATUSES,
  INVITE_BLOCK_REASONS,
  EMAIL_PATTERN,
} = require('../constants/usersConstants');

/**
 * Maps role values to their corresponding relation field name on the User model
 */
const ROLE_PROFILE_RELATIONS = {
  [SYSTEM_ROLES.caregiver.value]: 'caregiverProfiles',
  [SYSTEM_ROLES.nurse.value]: 'nurseProfiles',
  [SYSTEM_ROLES.case_manager.value]: 'caseManagerProfiles',
};

/**
 * Returns the role-specific profile from an already-fetched user object.
 * Expects the user to have been fetched with profile relations included.
 *
 * A person can hold a profile in several organizations, so the one in
 * `organizationId` is returned, never another organization's. Without it, the
 * one in their own active organization.
 */
function getProfileByRole({user, role, organizationId = null}) {
  const relation = ROLE_PROFILE_RELATIONS[role];

  if (!relation) return null;

  const profiles = user?.[relation] || [];

  const targetOrganizationId =
    organizationId || user?.currentActiveOrganization?.organizationId;

  if (!targetOrganizationId) return profiles[0] ?? null;

  return (
    profiles.find(
      (profile) => profile.organizationId === targetOrganizationId
    ) ?? null
  );
}

/**
 * Statuses that deny a role profile access, per role.
 *
 * A membership test rather than an equality check because CaregiverStatus grew
 * to six members with the HHAeXchange import: a TERMINATED or REJECTED caregiver
 * must not authenticate, and an equality test against INACTIVE would have let
 * both straight in. HOLD and ON_LEAVE deliberately still authenticate -- they
 * are temporary states for someone who is still employed.
 *
 * Nurses and case managers keep the two-value ENTITY_STATUSES set their own
 * Postgres enums define.
 */
const BLOCKED_PROFILE_STATUSES = {
  [SYSTEM_ROLES.caregiver.value]: CAREGIVER_BLOCKED_STATUSES,
  [SYSTEM_ROLES.nurse.value]: [ENTITY_STATUSES.INACTIVE.value],
  [SYSTEM_ROLES.case_manager.value]: [ENTITY_STATUSES.INACTIVE.value],
};

/**
 * Returns true if the user's role-specific profile status denies them access.
 * Expects the user to have been fetched with profile relations included.
 */
function isRoleProfileInactive({user, role, organizationId = null}) {
  const profile = getProfileByRole({user, role, organizationId});

  if (!profile?.status) return false;

  const blockedStatuses = BLOCKED_PROFILE_STATUSES[role] || [
    ENTITY_STATUSES.INACTIVE.value,
  ];

  return blockedStatuses.includes(profile.status);
}

/**
 * Builds the Prisma include object for all role profile relations.
 *
 * Defaults to status only -- authMiddleware runs this on every authenticated
 * request and must stay cheap. `selects` overrides the select per role for
 * callers that need more (the roster wants licence, professional role, title).
 * @param {Object} [selects] - role value -> Prisma select object
 * @param {boolean} [includeArchived] - also read archived (soft-deleted)
 *   profiles, for the roster's archived view
 */
function buildProfileRelationsInclude({
  selects = null,
  organizationId = null,
  includeArchived = false,
} = {}) {
  const scope = includeArchived ? {} : {isDeleted: null};

  const where = organizationId
    ? Object.assign({}, scope, {organizationId})
    : scope;

  return Object.entries(ROLE_PROFILE_RELATIONS).reduce(
    (acc, [role, relation]) => {
      // organizationId lets getProfileByRole pick the active organization's
      // profile when the read is not limited to one organization.
      const select = Object.assign(
        {organizationId: true},
        selects?.[role] || {status: true}
      );

      acc[relation] = organizationId
        ? {where, select, take: 1}
        : {where, select};

      return acc;
    },
    {}
  );
}

/**
 * Get the active organization for a user
 * @param {Object} user - Prisma user object with userOrganizations and permissions included
 * @returns {Object} active organization with role, organizationId, and permissions ID
 */
function findActiveMembership({user}) {
  if (!user?.userOrganizations) return null;

  // The organization chosen in the switcher wins while the membership is
  // still accepted, then the main org; a user without one falls back to the
  // first active membership.
  const activeOrgJunctions = user.userOrganizations.filter(
    (org) => org.isActive
  );

  return (
    activeOrgJunctions.find(
      (org) => org.organizationId === user.sessionOrganizationId
    ) ||
    activeOrgJunctions.find(
      (org) => org.organizationId === user.primaryOrgId
    ) ||
    activeOrgJunctions[0] ||
    null
  );
}

/**
 * Puts the active organization's name, phone and address on the user, so every
 * response, token and message built from the user shows the details of the
 * organization the person is in. Without an active membership the account's
 * own values stay.
 */
function applyActiveMembershipDetails({user}) {
  const membership = findActiveMembership({user});

  if (membership) {
    Object.assign(user, pickMembershipDetails({data: membership}));
  }

  return user;
}

function getActiveOrganization({user}) {
  const activeOrgJunction = findActiveMembership({user});

  if (!activeOrgJunction) return null;

  // Find the permissions for this user in this organization
  const orgPermissions = user.permissions?.find(
    (perm) => perm.organizationId === activeOrgJunction.organizationId
  );

  // Build the response object with only required fields (matching MongoDB structure)
  const result = {
    organizationId: activeOrgJunction.organizationId,
    role: activeOrgJunction.role,
    isActive: activeOrgJunction.isActive,
  };

  // Add permissions ID only (not full permissions object)
  if (orgPermissions?.id) {
    result.permissions = orgPermissions.id;
  }

  return result;
}

/**
 * Makes the organization chosen in the switcher this request's active one.
 *
 * It is kept on the session, so it has to be applied wherever a user is loaded
 * for a request. The property is not enumerable, so it never reaches a
 * response or a token by itself.
 * @param {Object} user - Prisma user object
 * @param {Object} [session] - the login session, if any
 * @returns {Object} the same user
 */
function applySessionOrganization({user, session}) {
  if (!user) return user;

  Object.defineProperty(user, 'sessionOrganizationId', {
    value: session?.activeOrganizationId || null,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return applyActiveMembershipDetails({user});
}

/**
 * Add helper methods to Prisma user object
 * @param {Object} user - Prisma user object
 * @returns {Object} user with helper methods
 */
function enrichUserObject({user}) {
  if (!user) return user;

  applyActiveMembershipDetails({user});

  // Add generateToken method
  user.generateToken = ({type, payload}) => {
    return jwtUtils.generateUserToken({user, type, payload});
  };

  // Add getter for currentActiveOrganization (virtual field for Prisma)
  Object.defineProperty(user, 'currentActiveOrganization', {
    get() {
      return getActiveOrganization({user: this});
    },
    configurable: true,
  });

  return user;
}

/**
 * Resolves the roster status for one person.
 *
 * The Users & Roles list shows a single status column spanning the three
 * per-role profile enums plus the lockout that lives on `users`, which wins --
 * a locked-out nurse whose profile still reads ACTIVE must not render Active.
 *
 * @param {Object} user - user row with isVerified and lockedAt
 * @param {Object} [profile] - the role profile, when the user has one
 * @returns {string} a ROSTER_STATUSES value
 */
function resolveRosterStatus({user, profile = null}) {
  if (user?.lockedAt) return ROSTER_STATUSES.LOCKED_OUT.value;

  return profile?.status || ROSTER_STATUSES.ACTIVE.value;
}

/** When the invitation sent at `sentAt` stops working, as a Luxon UTC time. */
function getInvitationExpiry({sentAt}) {
  return toLuxonUTC({date: sentAt}).plus({
    milliseconds: ms(userInvitationTokenExpiry),
  });
}

/** Invitations sent at or before this moment have expired. */
function getInvitationExpiryCutoff() {
  return toLuxonUTC({date: getCurrentTime()})
    .minus({milliseconds: ms(userInvitationTokenExpiry)})
    .toJSDate();
}

function isInvitationActive({sentAt}) {
  if (!sentAt) return false;

  return getInvitationExpiry({sentAt}) > toLuxonUTC({date: getCurrentTime()});
}

/**
 * Why this person cannot be invited, or null when they can.
 *
 * Every invite path goes through this, so an import never gets a login the
 * admin did not mean to give. Expects profile relations on the user.
 * @returns {Object|null} an INVITE_BLOCK_REASONS member
 */
function getInviteBlockReason({
  user,
  role,
  hasEmailConflict = false,
  organizationId = null,
}) {
  if (user.isVerified) return INVITE_BLOCK_REASONS.ALREADY_ACCEPTED;

  if (isRoleProfileInactive({user, role, organizationId})) {
    return INVITE_BLOCK_REASONS.DEACTIVATED;
  }

  if (isPlaceholderEmail({email: user.email})) {
    return INVITE_BLOCK_REASONS.PLACEHOLDER_EMAIL;
  }

  if (!EMAIL_PATTERN.test(user.email))
    return INVITE_BLOCK_REASONS.INVALID_EMAIL;

  if (hasEmailConflict) return INVITE_BLOCK_REASONS.EMAIL_CONFLICT;

  return null;
}

/**
 * Resolves where one person stands on getting a login.
 *
 * Order matters: someone who may not log in reads Deactivated whatever their
 * invitation did, and an accepted invitation outranks a later email problem.
 * @returns {string} an INVITATION_STATUSES value
 */
function resolveInvitationStatus({user, role, hasEmailConflict = false}) {
  if (isRoleProfileInactive({user, role})) {
    return INVITATION_STATUSES.DEACTIVATED.value;
  }

  if (user?.isVerified) return INVITATION_STATUSES.ACCEPTED.value;

  if (hasEmailConflict) return INVITATION_STATUSES.CONFLICT.value;

  if (user?.invitationSentAt) {
    return isInvitationActive({sentAt: user.invitationSentAt})
      ? INVITATION_STATUSES.INVITED.value
      : INVITATION_STATUSES.EXPIRED.value;
  }

  return isPlaceholderEmail({email: user?.email})
    ? INVITATION_STATUSES.PENDING_REVIEW.value
    : INVITATION_STATUSES.READY_TO_INVITE.value;
}

/**
 * Whether a membership is an invitation the person has not accepted yet.
 * isActive means an accepted member, so an inactive membership that carries an
 * invitation is pending.
 */
function isPendingMembership({membership}) {
  return !membership.isActive && Boolean(membership.invitationSentAt);
}

/**
 * Where an invitation into one organization stands for a person who already
 * has an account. It lives on the membership, not the user.
 * @returns {string} an INVITATION_STATUSES value
 */
function resolveMembershipInvitationStatus({membership}) {
  return isInvitationActive({sentAt: membership.invitationSentAt})
    ? INVITATION_STATUSES.INVITED.value
    : INVITATION_STATUSES.EXPIRED.value;
}

/**
 * Kills every link mailed to the person. An unaccepted invitation is cancelled
 * too; an accepted one keeps its sent date and inviter as history.
 * @param {{isVerified, secretKeys}} user
 * @returns {Object} `users` columns to write
 */
function buildEmailedLinksInvalidation({user}) {
  return Object.assign(
    {
      secretKeys: safeMerge({
        originalObj: getExistingSecretKeys({secretKeys: user.secretKeys}),
        newObj: {
          invitation: null,
          invitationSentAt: null,
          loginReset: null,
          accountUnlock: null,
        },
      }),
    },
    user.isVerified ? {} : {invitationSentAt: null, invitedByUserId: null}
  );
}

/**
 * What a login email change must also write: the links mailed to the old
 * address would otherwise still open the account. Empty when it is the same.
 */
function buildEmailChangeInvalidation({user, email}) {
  const isSameEmail =
    String(user.email).toLowerCase() === String(email).toLowerCase();

  return isSameEmail ? {} : buildEmailedLinksInvalidation({user});
}

/**
 * Clean user response - removes raw userOrganizations and permissions arrays
 * Keeps only the virtual currentActiveOrganization field
 * Used for API responses to match login/me endpoint format
 * @param {Object} user - User object (enriched with virtual fields)
 * @returns {Object} cleaned user object without raw relations
 */
function cleanUserResponse({user}) {
  if (!user) return user;

  // Create a plain object from the user using safeMerge (no spread operator)
  const cleanedUser = safeMerge({originalObj: user, newObj: {}});

  // IMPORTANT: Compute the virtual currentActiveOrganization BEFORE removing the raw arrays
  // The virtual getter depends on userOrganizations and permissions being present
  if (cleanedUser.userOrganizations || cleanedUser.permissions) {
    cleanedUser.currentActiveOrganization = getActiveOrganization({
      user: cleanedUser,
    });
  }

  // Now remove raw relation arrays - currentActiveOrganization is already computed
  delete cleanedUser.userOrganizations;
  delete cleanedUser.permissions;

  return cleanedUser;
}

/**
 * Clean multiple user responses
 * @param {Array} users - Array of user objects
 * @returns {Array} array of cleaned user objects
 */
function cleanUsersResponse({users}) {
  if (!Array.isArray(users)) return users;

  return users.map((user) => cleanUserResponse({user}));
}

module.exports = {
  enrichUserObject,
  getActiveOrganization,
  applySessionOrganization,
  cleanUserResponse,
  cleanUsersResponse,
  getProfileByRole,
  isRoleProfileInactive,
  BLOCKED_PROFILE_STATUSES,
  buildProfileRelationsInclude,
  resolveRosterStatus,
  getInvitationExpiry,
  getInvitationExpiryCutoff,
  isInvitationActive,
  getInviteBlockReason,
  resolveInvitationStatus,
  isPendingMembership,
  resolveMembershipInvitationStatus,
  buildEmailedLinksInvalidation,
  buildEmailChangeInvalidation,
  ROLE_PROFILE_RELATIONS,
};
