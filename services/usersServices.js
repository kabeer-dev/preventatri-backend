const {errorsConstants, modelConstants} = require('../constants');

const PermissionsServices = require('./permissionsServices');

const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {ESCALATION_STATUSES} = require('../constants/escalationConstants');

const {
  HHAX_PLACEHOLDER_EMAIL_DOMAIN,
} = require('../constants/hhaExchangeConstants');
const {PATIENT_STATUSES} = require('../constants/patientsConstants');

const {
  SLA_COMPLIANCE_BY_DAY_SQL,
} = require('../constants/reports/slaComplianceSql');

const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
} = require('../constants/submissionFlagConstants');

const {
  SYSTEM_ROLES,
  ADMIN_STATS_TRENDS_METRICS,
  FLAGS_RAISED_SERIES_KEYS,
  FLAGS_RAISED_BY_DAY_SQL,
  SLA_AT_RISK_COUNT_SQL,
  ROSTER_ROLES,
  ROSTER_ARCHIVE_FILTERS,
  ROSTER_STATUSES,
  ROSTER_STATUS_ROLES,
  INVITATION_STATUSES,
  USERS_SEARCH_FIELDS,
  MEMBERSHIP_DETAIL_FIELDS,
} = require('../constants/usersConstants');
const {PrismaFactory} = require('../factories');

const {passwordsUtils, getExistingSecretKeys} = require('../utils');
const {getPrismaClient} = require('../utils/databaseConnectionManager');

const {
  buildDateRangeClause,
  currentDate,
  getCurrentDateTime,
} = require('../utils/dateUtils');

const {
  buildNameSearchClause,
  calculateAverage,
  safeMerge,
} = require('../utils/general');

const {
  buildDayLabels,
  buildReportWindow,
} = require('../utils/reportWindowUtils');
const {asyncTryCatch} = require('../utils/tryCatchUtils');

const {
  enrichUserObject,
  buildProfileRelationsInclude,
  ROLE_PROFILE_RELATIONS,
  BLOCKED_PROFILE_STATUSES,
  getInvitationExpiryCutoff,
  buildEmailChangeInvalidation,
} = require('../utils/userHelpers');
const {pickMembershipDetails} = require('../utils/userUtils');

/**
 * What the roster needs off a profile: the id the row links to, plus the status
 * and source it renders. Identical for all three roles -- every column that
 * differed by role has been taken off the table.
 */
const ROSTER_PROFILE_SELECT = {id: true, status: true, source: true};

const ROSTER_PROFILE_SELECTS = Object.fromEntries(
  ROSTER_ROLES.map((role) => [role, ROSTER_PROFILE_SELECT])
);

// Recalculate permissions based on the current role

module.exports = class UsersServices {
  static async getUserByEmail({
    email,
    optionsInclude,
    includeProfileRelations = false,
  }) {
    // Always include userOrganizations and permissions for virtual fields to work
    const defaultIncludes = ['userOrganizations', 'permissions'];

    const mergedIncludes = optionsInclude
      ? [].concat(defaultIncludes, optionsInclude)
      : defaultIncludes;

    const query = {email: email.toLowerCase()};

    const fieldsInclusion = includeProfileRelations
      ? {
          include: Object.assign(
            mergedIncludes.reduce((acc, f) => {
              acc[f] = true;

              return acc;
            }, {}),
            buildProfileRelationsInclude()
          ),
        }
      : {include: mergedIncludes};

    const {
      success,
      doc: user,
      error,
    } = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER,
      query,
      fieldsInclusion,
    });

    return {success, user: enrichUserObject({user}), error};
  }

  /**
   * The person behind an invited email, wherever they already have an account.
   * getUserByEmail is limited to the caller's organization, so it cannot see
   * a person who only belongs to another one. This reads just what an invite
   * needs, so nothing about their other organizations reaches the caller.
   */
  static async getUserForInvitationByEmail({email, organizationId}) {
    const {
      success: userSuccess,
      doc: user,
      error: userError,
    } = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER,
      query: {email: email.toLowerCase()},
      fieldsInclusion: {includeSpecificFields: ['id', 'email', 'isVerified']},
      options: {bypassExtraQueries: true},
    });

    // A failed lookup must not read as "no such email": the invite would go on
    // to create a second account for an email that exists elsewhere.
    if (!userSuccess) {
      return {success: false, user: null, isMember: false, error: userError};
    }

    if (!user) return {success: true, user: null, isMember: false, error: null};

    const {
      success: membershipSuccess,
      doc: membership,
      error: membershipError,
    } = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER_ORGANIZATION,
      query: {userId: user.id, organizationId},
      fieldsInclusion: {includeSpecificFields: ['id']},
      options: {bypassExtraQueries: true},
    });

    if (!membershipSuccess) {
      return {success: false, user, isMember: false, error: membershipError};
    }

    return {success: true, user, isMember: Boolean(membership), error: null};
  }

  static async getUserById({id, options}) {
    // Always include userOrganizations and permissions for virtual fields to work
    const enhancedOptions = safeMerge({
      originalObj: {
        fieldsInclusion: {
          include: ['userOrganizations', 'permissions'],
        },
      },
      newObj: options || {},
    });

    const {
      success,
      doc: user,
      error,
    } = await PrismaFactory.findById({
      model: modelConstants.MODELS.USER,
      id,
      options: enhancedOptions,
      fieldsInclusion: enhancedOptions.fieldsInclusion,
    });

    return {success, user: enrichUserObject({user}), error};
  }

  static async createUser({data, optionsInclude, tx}) {
    try {
      // Normalize email to lowercase to match Mongoose behavior and ensure unique constraint works
      let normalizedData = data;
      if (data.email) {
        normalizedData = Object.assign({}, data, {
          email: data.email.toLowerCase(),
        });
      }

      const {
        doc: user,
        error: createError,
        success,
      } = await PrismaFactory.create({
        model: modelConstants.MODELS.USER,
        data: normalizedData,
        fieldsInclusion: optionsInclude ? {include: optionsInclude} : undefined,
        tx,
      });

      if (!success || createError) {
        return {success: false, user: null, error: createError};
      }

      return {success, user: enrichUserObject({user}), error: null};
    } catch (error) {
      // P2002 is Prisma's unique constraint error code
      if (error.code === errorsConstants.PRISMA_DUPLICATION_ERROR_CODE) {
        return {success: false, user: null, error};
      }

      return {success: false, user: null, error};
    }
  }

  static async createUserOrganization({organizationData, tx}) {
    try {
      // Create organization with Prisma
      const {
        doc: organization,
        error: createError,
        success,
      } = await PrismaFactory.create({
        model: modelConstants.MODELS.ORGANIZATION,
        data: organizationData,
        tx,
      });

      if (!success || createError) {
        return {success: false, organization: null, error: createError};
      }

      return {success: !!organization, organization, error: null};
    } catch (error) {
      return {success: false, organization: null, error};
    }
  }

  static async verifyUserPassword({inputPassword, dbPassword}) {
    const {success, response, error} = await asyncTryCatch({
      fn: async () => await passwordsUtils.verify({inputPassword, dbPassword}),
    });

    return {success, isPasswordVerified: response, error};
  }

  static async resetPassword({resetArgs: {id, newPassword}, tx}) {
    try {
      // FIX: Fetch existing secretKeys to merge with updates
      const {doc: currentUser} = await PrismaFactory.findById({
        model: modelConstants.MODELS.USER,
        id,
      });

      const existingSecretKeys = getExistingSecretKeys({
        secretKeys: currentUser?.secretKeys,
      });

      // Use safeMerge to properly merge secretKeys without losing other fields
      const updatedSecretKeys = safeMerge({
        originalObj: existingSecretKeys,
        newObj: {
          loginReset: null,
          otp: null,
          accountUnlock: null,
        },
      });

      const {success, error, isDocumentUpdated} = await PrismaFactory.updateOne(
        {
          model: modelConstants.MODELS.USER,
          query: {id},
          data: {
            password: newPassword,
            secretKeys: updatedSecretKeys,

            // Auto-verify the account — completing the reset proves email
            // ownership, so invited users who never opened the invitation link
            // should not be sent to the account verification page (PREVENT-205)
            isVerified: true,

            // Clear lockout state — user proved email ownership via reset flow
            lockedAt: null,
            failedLoginAttempts: 0,
          },
          tx,
        }
      );

      return {
        success,
        error,
        isDocumentUpdated,
      };
    } catch (error) {
      return {
        success: false,
        error,
        isDocumentUpdated: false,
      };
    }
  }

  static async setPermissions({
    permissionArgs: {userId, organizationId, permissions},
    tx,
  }) {
    try {
      // Update the permission record for the user in the given organization
      // permissions object has: levels.users.view, levels.users.update, levels.region.view, etc.
      const client = tx || getPrismaClient();

      const updated = await client.permission.update({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        data: permissions,
      });

      return {
        success: !!updated,
        user: null,
        error: null,
        isDocumentUpdated: !!updated,
      };
    } catch (error) {
      return {success: false, user: null, error, isDocumentUpdated: false};
    }
  }

  static async deletePermissions({userId, organizationId, tx}) {
    try {
      // Delete all permissions for a user in an organization
      const client = tx || getPrismaClient();

      const deleted = await client.permission.deleteMany({
        where: {
          userId,
          organizationId,
        },
      });

      return {
        success: true,
        error: null,
        areDocumentsUpdated: deleted.count > 0,
        responseObj: deleted,
      };
    } catch (error) {
      return {
        success: false,
        error,
        areDocumentsUpdated: false,
        responseObj: null,
      };
    }
  }

  static async verifyUser({id}) {
    try {
      // FIX: Fetch existing secretKeys to merge with updates
      const {doc: currentUser} = await PrismaFactory.findById({
        model: modelConstants.MODELS.USER,
        id,
      });

      const existingSecretKeys = getExistingSecretKeys({
        secretKeys: currentUser?.secretKeys,
      });

      // Use safeMerge to properly merge secretKeys without losing other fields
      const updatedSecretKeys = safeMerge({
        originalObj: existingSecretKeys,
        newObj: {
          verification: null,
        },
      });

      const {success, error, isDocumentUpdated} = await PrismaFactory.updateOne(
        {
          model: modelConstants.MODELS.USER,
          query: {id},
          data: {
            isVerified: true,
            secretKeys: updatedSecretKeys,
          },
        }
      );

      return {
        error,
        isDocumentUpdated,
        success,
      };
    } catch (error) {
      return {
        error,
        isDocumentUpdated: false,
        success: false,
      };
    }
  }

  static async updateUserLanguage({updateArgs: {userId, language}}) {
    try {
      const user = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.USER,
        query: {id: userId},
        data: {language},
      });

      return {success: !!user, error: null};
    } catch (error) {
      return {success: false, error};
    }
  }

  static async incrementFailedLoginAttempts({id}) {
    try {
      const client = getPrismaClient();

      const updated = await client.user.update({
        where: {id},
        data: {failedLoginAttempts: {increment: 1}},
      });

      return {
        success: true,
        failedLoginAttempts: updated.failedLoginAttempts,
        error: null,
      };
    } catch (error) {
      return {success: false, failedLoginAttempts: null, error};
    }
  }

  static async lockAccount({id}) {
    try {
      const client = getPrismaClient();

      const user = await client.user.findUnique({
        where: {id},
        select: {secretKeys: true},
      });

      const existingSecretKeys = getExistingSecretKeys({
        secretKeys: user?.secretKeys,
      });

      const updatedSecretKeys = safeMerge({
        originalObj: existingSecretKeys,
        newObj: {accountUnlock: null},
      });

      const {success, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.USER,
        query: {id},
        data: {
          lockedAt: currentDate(),
          failedLoginAttempts: 0,
          secretKeys: updatedSecretKeys,
        },
      });

      return {success, error};
    } catch (error) {
      return {success: false, error};
    }
  }

  static async unlockAccount({id}) {
    try {
      const client = getPrismaClient();

      const user = await client.user.findUnique({
        where: {id},
        select: {secretKeys: true},
      });

      const existingSecretKeys = getExistingSecretKeys({
        secretKeys: user?.secretKeys,
      });

      const updatedSecretKeys = safeMerge({
        originalObj: existingSecretKeys,
        newObj: {accountUnlock: null},
      });

      const {success, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.USER,
        query: {id},
        data: {
          lockedAt: null,
          failedLoginAttempts: 0,
          secretKeys: updatedSecretKeys,
        },
      });

      return {success, error};
    } catch (error) {
      return {success: false, error};
    }
  }

  /** `data`, plus the cancelling of emailed links when it moves the email. */
  static async addEmailChangeInvalidation({id, data, tx}) {
    const {
      success,
      doc: user,
      error,
    } = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER,
      query: {id},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        includeSpecificFields: ['id', 'email', 'isVerified', 'secretKeys'],
      },
      tx,
    });

    // Fail closed: an unread user must not keep links to the old address.
    if (!success) throw error;

    if (!user) return data;

    return Object.assign(
      {},
      data,
      buildEmailChangeInvalidation({user, email: data.email})
    );
  }

  static async updateOne({id, data, options = {}, tx}) {
    try {
      const {success, error, isDocumentUpdated} = await PrismaFactory.updateOne(
        {
          model: modelConstants.MODELS.USER,
          query: {id},
          data:
            data.email === undefined
              ? data
              : await UsersServices.addEmailChangeInvalidation({id, data, tx}),
          options,
          tx,
        }
      );

      return {success, error, isDocumentUpdated};
    } catch (error) {
      if (error.code === errorsConstants.PRISMA_DUPLICATION_ERROR_CODE) {
        // P2002 is Prisma's unique constraint error
        return {success: false, error, isDocumentUpdated: false};
      }

      return {success: false, error, isDocumentUpdated: false};
    }
  }

  /**
   * Changes a person's name, phone and address in ONE organization. The
   * membership is named explicitly, so a change here never reaches the same
   * person in another organization.
   */
  static async updateMembershipDetails({
    userId,
    organizationId,
    data,
    options = {},
    tx,
  }) {
    try {
      const {success, error} = await PrismaFactory.updateMany({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId},
        data: pickMembershipDetails({data}),
        options: safeMerge({
          originalObj: options,
          newObj: {bypassExtraQueries: true},
        }),
        tx,
      });

      return {success, error};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * The person's details in one organization, for messages and responses that
   * are about that organization. Null when the person has no membership there.
   */
  static async getMembershipDetails({userId, organizationId}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId},
        fieldsInclusion: {
          includeSpecificFields: MEMBERSHIP_DETAIL_FIELDS,
        },
        options: {bypassExtraQueries: true},
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Check if a user has an active (non-deleted) role profile in the current organization.
   * This is a common method used across all role controllers (nurse, caregiver, case manager)
   * to prevent duplicate profiles and allow re-invitation after soft-delete.
   *
   * NOTE: organizationId is NOT passed in the query because PrismaFactory auto-adds it
   * from the ACL middleware context (req.extra.queries → attachExtraQueriesFromOptions).
   *
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID
   * @param {string} params.model - Prisma model name (e.g., modelConstants.MODELS.NURSE_PROFILE)
   * @returns {Object} { hasActiveProfile: boolean, profile: Object|null }
   */
  static async hasActiveRoleProfile({userId, model}) {
    try {
      const {success, doc} = await PrismaFactory.findOne({
        model,
        query: {userId},
      });

      // findOne with soft-delete extension automatically excludes deleted records
      return {hasActiveProfile: success && !!doc, profile: doc};
    } catch (error) {
      return {hasActiveProfile: false, profile: null};
    }
  }

  /**
   * Reset permissions for a user after their role profile is deleted.
   * Since a user has only one role per org, we recalculate permissions
   * based on the current role to ensure consistency.
   *
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @param {Object} [params.tx] - Optional transaction context
   * @returns {Object} { success, error }
   */
  static async resetUserPermissions({userId, organizationId, tx}) {
    try {
      const client = tx || getPrismaClient();

      // Find the UserOrganization record to get the current role
      const userOrg = await client.userOrganization.findFirst({
        where: {userId, organizationId},
      });

      if (!userOrg) {
        return {success: false, error: new Error('UserOrganization not found')};
      }

      await PermissionsServices.resetPermissionsForRole({
        userId,
        organizationId,
        role: userOrg.role,
        tx: client,
      });

      return {success: true, error: null};
    } catch (error) {
      return {success: false, error};
    }
  }

  static async softDeleteUser({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.USER,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Remove a person from one organization after their profile there was
   * deleted. The account is deleted only when this was their last accepted
   * organization; softDeleteUser cascades by user, so calling it while they
   * belong elsewhere would lock them out of every organization.
   *
   * When this was their main org, the oldest other accepted one becomes the
   * main one so they can still log in.
   */
  static async removeUserFromOrganization({userId, organizationId, tx}) {
    try {
      const client = tx || getPrismaClient();

      const otherMemberships = await client.userOrganization.findMany({
        where: {userId, organizationId: {not: organizationId}, isActive: true},
        orderBy: {createdAt: 'asc'},
      });

      if (otherMemberships.length === 0) {
        return await UsersServices.softDeleteUser({id: userId, tx});
      }

      const deletedAt = getCurrentDateTime();

      // An unaccepted invitation is cleared with the membership.
      await client.userOrganization.updateMany({
        where: {userId, organizationId},
        data: {
          isDeleted: deletedAt,
          isActive: false,
          invitationSentAt: null,
          invitationSecret: null,
          pendingProfileStatus: null,
        },
      });

      await client.permission.updateMany({
        where: {userId, organizationId},
        data: {isDeleted: deletedAt},
      });

      // Profiles are per organization. Those already deleted are left alone.
      await Promise.all(
        ['nurseProfile', 'caregiverProfile', 'caseManagerProfile'].map(
          (profileModel) =>
            client[profileModel].updateMany({
              where: {userId, organizationId},
              data: {isDeleted: deletedAt},
            })
        )
      );

      await client.user.updateMany({
        where: {id: userId, primaryOrgId: organizationId},
        data: {primaryOrgId: otherMemberships[0].organizationId},
      });

      return {success: true, doc: null, error: null};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * The isDeleted clause for an archive view: live rows, archived rows, or
   * (for 'all') no clause at all.
   */
  static buildArchiveClause({archiveFilter}) {
    if (archiveFilter === ROSTER_ARCHIVE_FILTERS.ARCHIVED.value) {
      return {isDeleted: {not: null}};
    }

    if (archiveFilter === ROSTER_ARCHIVE_FILTERS.ALL.value) return {};

    return {isDeleted: null};
  }

  /**
   * Builds the shared where-clause for the Users & Roles roster.
   *
   * Kept separate from the queries so the paginated page and the per-role tab
   * counts provably filter on the same thing -- the tab counts drop only the
   * role clause.
   */
  static buildRosterQuery({
    roles,
    status,
    sources,
    regionId,
    search,
    restrictedUserIds,
    organizationId = null,
    invitationStatus = null,
    conflictUserIds = [],
    archiveFilter = ROSTER_ARCHIVE_FILTERS.ACTIVE.value,
  }) {
    // active -> live only; archived -> soft-deleted only; all -> no isDeleted
    // clause. Archiving soft-deletes the user, the profile and the membership
    // together, so one rule covers all three levels.
    const archiveClause = UsersServices.buildArchiveClause({archiveFilter});

    // A person removed from this org keeps a live account when they belong to
    // another one, so the archived view asks for the membership (the root
    // clause) to be deleted, not the user.
    const userClause =
      archiveFilter === ROSTER_ARCHIVE_FILTERS.ARCHIVED.value
        ? {}
        : Object.assign({}, archiveClause);

    // Org scoping only reaches the root UserOrganization, not these nested
    // relations; a user in two orgs would otherwise match the other org's profile.
    const profileScope = organizationId
      ? Object.assign({}, archiveClause, {organizationId})
      : Object.assign({}, archiveClause);

    if (restrictedUserIds) userClause.id = {in: restrictedUserIds};

    if (status === ROSTER_STATUSES.LOCKED_OUT.value) {
      userClause.lockedAt = {not: null};
    } else if (status) {
      // A profile status only shows through on a user who is not locked out --
      // the lockout outranks it on the roster. Deliberately NOT gated on
      // isVerified: every HHAeXchange import is unverified and would vanish.
      userClause.lockedAt = null;

      // Only reach for the relations whose enum actually accepts this status --
      // Prisma rejects the query outright otherwise (HOLD on NurseStatus).
      const rolesWithStatus = ROSTER_ROLES.filter((role) =>
        ROSTER_STATUS_ROLES[role]?.includes(status)
      );

      userClause.OR = rolesWithStatus.map((role) => ({
        [ROLE_PROFILE_RELATIONS[role]]: {
          some: safeMerge({originalObj: profileScope, newObj: {status}}),
        },
      }));

      // No role can hold it, so nothing matches. An empty OR would match all.
      if (rolesWithStatus.length === 0) userClause.OR = [{id: {in: []}}];
    }

    const query = Object.assign({}, archiveClause, {
      role: {in: roles},
      user: userClause,
    });

    // Search and region both need their own OR/AND groups rooted at the
    // UserOrganization level, so they go in a shared top-level AND rather than
    // fighting over the single OR/AND slot on the user clause.
    const andClauses = [];

    const nameClause = buildNameSearchClause({
      name: search,
      fields: USERS_SEARCH_FIELDS,
    });

    if (nameClause) andClauses.push(nameClause);

    // Its own AND entry, not the user-level OR the status filter owns, so a
    // source never widens or replaces the status match.
    if (sources?.length) {
      andClauses.push({
        user: {
          OR: ROSTER_ROLES.map((role) => ({
            [ROLE_PROFILE_RELATIONS[role]]: {
              some: safeMerge({
                originalObj: profileScope,
                newObj: {source: {in: sources}},
              }),
            },
          })),
        },
      });
    }

    if (regionId) {
      andClauses.push({
        user: {
          OR: [
            {
              nurseProfiles: {
                some: safeMerge({
                  originalObj: profileScope,
                  newObj: {regionalNurses: {some: {regionId}}},
                }),
              },
            },
            {
              caseManagerProfiles: {
                some: safeMerge({
                  originalObj: profileScope,
                  newObj: {caseManagerRegions: {some: {regionId}}},
                }),
              },
            },

            // Caregivers hold no region of their own -- theirs is derived
            // through the patients they are assigned to.
            {
              caregiverProfiles: {
                some: safeMerge({
                  originalObj: profileScope,
                  newObj: {
                    caregiverPatients: {some: {patient: {county: {regionId}}}},
                  },
                }),
              },
            },
          ],
        },
      });
    }

    if (invitationStatus) {
      andClauses.push(
        UsersServices.buildMembershipInvitationClause({
          invitationStatus,
          userClause: {
            user: UsersServices.buildInvitationStatusClause({
              invitationStatus,
              conflictUserIds,
              profileScope,
            }),
          },
        })
      );
    }

    if (andClauses.length > 0) query.AND = andClauses;

    return query;
  }

  /**
   * A membership still pending acceptance reads Invited or Expired from its own
   * invitation, never from the user's, so the user-level statuses apply only to
   * memberships that are not pending.
   */
  static buildMembershipInvitationClause({invitationStatus, userClause}) {
    const expiryCutoff = getInvitationExpiryCutoff();

    const pendingByStatus = {
      [INVITATION_STATUSES.INVITED.value]: {
        isActive: false,
        invitationSentAt: {gt: expiryCutoff},
      },
      [INVITATION_STATUSES.EXPIRED.value]: {
        isActive: false,
        invitationSentAt: {lte: expiryCutoff},
      },
    };

    // A pending membership is inactive and carries an invitation.
    const notPending = {
      AND: [
        {NOT: {isActive: false, invitationSentAt: {not: null}}},
        userClause,
      ],
    };

    const pending = pendingByStatus[invitationStatus];

    return pending ? {OR: [notPending, pending]} : notPending;
  }

  /**
   * The user-level clause for one INVITATION_STATUSES value.
   *
   * Mirrors resolveInvitationStatus, including its order, so the filter and
   * the chip on each row cannot disagree.
   */
  static buildInvitationStatusClause({
    invitationStatus,
    conflictUserIds = [],
    profileScope,
  }) {
    const deactivated = {
      OR: ROSTER_ROLES.map((role) => ({
        [ROLE_PROFILE_RELATIONS[role]]: {
          some: safeMerge({
            originalObj: profileScope,
            newObj: {status: {in: BLOCKED_PROFILE_STATUSES[role]}},
          }),
        },
      })),
    };

    if (invitationStatus === INVITATION_STATUSES.DEACTIVATED.value) {
      return deactivated;
    }

    const active = {NOT: deactivated};

    if (invitationStatus === INVITATION_STATUSES.ACCEPTED.value) {
      return {AND: [active, {isVerified: true}]};
    }

    const notAccepted = [active, {isVerified: false}];

    if (invitationStatus === INVITATION_STATUSES.CONFLICT.value) {
      return {AND: notAccepted.concat({id: {in: conflictUserIds}})};
    }

    const expiryCutoff = getInvitationExpiryCutoff();

    const placeholderEmail = {
      email: {endsWith: `@${HHAX_PLACEHOLDER_EMAIL_DOMAIN}`},
    };

    const clauseByStatus = {
      [INVITATION_STATUSES.INVITED.value]: {
        invitationSentAt: {gt: expiryCutoff},
      },
      [INVITATION_STATUSES.EXPIRED.value]: {
        invitationSentAt: {lte: expiryCutoff},
      },
      [INVITATION_STATUSES.READY_TO_INVITE.value]: {
        invitationSentAt: null,
        NOT: placeholderEmail,
      },
      [INVITATION_STATUSES.PENDING_REVIEW.value]: Object.assign(
        {invitationSentAt: null},
        placeholderEmail
      ),
    };

    return {
      AND: notAccepted.concat(
        {id: {notIn: conflictUserIds}},
        clauseByStatus[invitationStatus]
      ),
    };
  }

  /**
   * One page of the unified Users & Roles roster.
   *
   * Based on UserOrganization rather than User because that is the only table
   * carrying a role, which is what the list is grouped and filtered by.
   */
  static async listOrgUsers({
    roles = ROSTER_ROLES,
    status = null,
    sources = null,
    regionId = null,
    search = null,
    restrictedUserIds = null,
    organizationId = null,
    invitationStatus = null,
    conflictUserIds = [],
    archiveFilter = ROSTER_ARCHIVE_FILTERS.ACTIVE.value,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = UsersServices.buildRosterQuery({
        roles,
        status,
        sources,
        regionId,
        search,
        restrictedUserIds,
        organizationId,
        invitationStatus,
        conflictUserIds,
        archiveFilter,
      });

      const includeArchived =
        archiveFilter !== ROSTER_ARCHIVE_FILTERS.ACTIVE.value;

      // includeDeleted lifts the default live-only filter on the membership
      // itself; the nested clauses above already say which rows to keep.
      const queryOptions = safeMerge({
        originalObj: {skip, take, includeDeleted: includeArchived},
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: {
          include: {
            // Person details are per organization, so they come from the
            // membership row, not the account.
            firstName: true,
            lastName: true,
            phoneNo: true,
            user: {
              select: safeMerge({
                originalObj: {
                  id: true,
                  email: true,
                  isVerified: true,
                  isDeleted: true,
                  lockedAt: true,
                  invitationSentAt: true,
                },
                newObj: buildProfileRelationsInclude({
                  selects: ROSTER_PROFILE_SELECTS,
                  organizationId,
                  includeArchived,
                }),
              }),
            },
          },
        },
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query,
        options: {includeDeleted: includeArchived},
      });

      // A failed count must not pass as an empty page.
      if (!countResult.success) {
        return {success: false, docs: [], error: countResult.error, count: 0};
      }

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.count},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  /**
   * Per-role totals for the roster tabs.
   *
   * Deliberately ignores the role filter so "Nurses 34" stays 34 while the
   * Caregivers tab is open, and cannot be derived from the current page -- that
   * would count only the rows on screen.
   */
  static async getRosterTabCounts({
    viewableRoles = ROSTER_ROLES,
    status = null,
    sources = null,
    regionId = null,
    search = null,
    restrictedUserIds = null,
    organizationId = null,
    invitationStatus = null,
    conflictUserIds = [],
    archiveFilter = ROSTER_ARCHIVE_FILTERS.ACTIVE.value,
  }) {
    try {
      // Named viewableRoles, not roles: it must be every role the caller may
      // see, never the selected tab, or the other tabs lose their totals.
      const counts = await Promise.all(
        viewableRoles.map(async (role) => {
          const {success, count, error} = await PrismaFactory.countDocuments({
            model: modelConstants.MODELS.USER_ORGANIZATION,
            query: UsersServices.buildRosterQuery({
              roles: [role],
              status,
              sources,
              regionId,
              search,
              restrictedUserIds,
              organizationId,
              invitationStatus,
              conflictUserIds,
              archiveFilter,
            }),
            options: {
              includeDeleted:
                archiveFilter !== ROSTER_ARCHIVE_FILTERS.ACTIVE.value,
            },
          });

          return {role, success, count, error};
        })
      );

      const failed = counts.find((entry) => !entry.success);

      if (failed) return {success: false, tabCounts: {}, error: failed.error};

      return {
        success: true,
        tabCounts: Object.fromEntries(
          counts.map(({role, count}) => [role, count])
        ),
      };
    } catch (error) {
      return {success: false, tabCounts: {}, error};
    }
  }

  /**
   * Resolve an admin UserOrganization for the org. If multiple admins exist
   * we pick the earliest-created active one for deterministic dispatch — change
   * this resolver if a different admin-selection policy is needed.
   */
  static async resolveAdminForOrganization({organizationId, tx}) {
    try {
      const {docs = []} = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {
          organizationId,
          role: SYSTEM_ROLES.admin.value,
          isActive: true,
        },
        options: {
          bypassExtraQueries: true,
          take: 1,
          sort: {createdAt: 'asc'},
        },
        tx,
      });

      const admin = docs[0] || null;

      return {
        success: true,
        userOrgId: admin?.id || null,
        userId: admin?.userId || null,
      };
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  /**
   * Resolve the organization an unattended background job should operate on.
   *
   * The scheduled HHAeXchange sync has no request and therefore no JWT, so it
   * cannot read organizationId off the caller the way every HTTP path does. It
   * derives it from the single admin UserOrganization instead.
   *
   * Both failure modes are explicit and both abort the caller:
   *  - zero organizations: there is no organization to import into.
   *  - more than one: the app has become multi-tenant, and silently picking the
   *    first would import an entire roster into an arbitrary organization.
   *    That is the tripwire — when it fires, the sync needs a real
   *    office-to-organization mapping rather than a guess.
   *
   * Note this deliberately differs from resolveAdminForOrganization above,
   * which takes an organization and finds its admin. This does the reverse.
   */
  static async resolveSingleAdminOrganization({tx} = {}) {
    try {
      const {docs = []} = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {
          role: SYSTEM_ROLES.admin.value,
          isActive: true,
          isDeleted: null,
        },
        options: {
          bypassExtraQueries: true,
          sort: {createdAt: 'asc'},
        },
        fieldsInclusion: {includeSpecificFields: ['organizationId']},
        tx,
      });

      // Distinct ORGANIZATIONS, not admin rows. One organization with two
      // admins is ordinary and must resolve cleanly; counting memberships
      // would read that as ambiguity and disable the sync permanently.
      const organizationIds = Array.from(
        new Set(docs.map((doc) => doc.organizationId))
      );

      return {
        success: organizationIds.length === 1,
        organizationId:
          organizationIds.length === 1 ? organizationIds[0] : null,
        organizationCount: organizationIds.length,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        organizationId: null,
        organizationCount: 0,
        error,
      };
    }
  }

  static async getAdminStats({organizationId, from, to}) {
    try {
      // Optional reporting window on createdAt. When neither bound is passed
      // the clause stays empty, so every metric is an all-time count.
      const dateClause = buildDateRangeClause({from, to});

      const countQueries = {
        activePatients: {
          model: modelConstants.MODELS.PATIENT,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              status: PATIENT_STATUSES.ACTIVE.value,
            },
            dateClause
          ),
        },
        openRedFlags: {
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              flag: RISK_SCORE_THRESHOLDS.RED.flag,
              status: {
                notIn: [
                  SUBMISSION_FLAG_STATUS.RESOLVED,
                  SUBMISSION_FLAG_STATUS.VOIDED,
                ],
              },
            },
            dateClause
          ),
        },

        // PENDING already means due today, and submissions have no createdAt to window on.
        pendingAssessments: {
          model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
          query: {
            organizationId,
            isDeleted: null,
            status: CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
          },
        },
      };

      const metrics = Object.keys(countQueries);

      const [results, slaAtRiskResult] = await Promise.all([
        Promise.all(
          metrics.map((metric) =>
            PrismaFactory.countDocuments(countQueries[metric])
          )
        ),
        PrismaFactory.aggregate({
          query: SLA_AT_RISK_COUNT_SQL({
            organizationId,
            activeStatus: ESCALATION_STATUSES.ACTIVE.value,
          }),
        }),
      ]);

      const failed = results
        .concat(slaAtRiskResult)
        .find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const doc = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );
      doc.slaAtRisk =
        Number(((slaAtRiskResult.docs || [])[0] || {}).sla_at_risk) || 0;

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Admin dashboard Trends per org-zone day: flags raised by colour and SLA
   * compliance, optionally narrowed to a region and people's patients.
   */
  static async getAdminStatsTrends({
    organizationId,
    timeZone,
    from,
    to,
    scope,
  }) {
    try {
      const window = buildReportWindow({from, to, timeZone});
      const labels = buildDayLabels({window});
      const {startISO, endISO} = window;
      const range = {from: window.from, to: window.to};

      const flagColors = Object.keys(FLAGS_RAISED_SERIES_KEYS);

      const [flagsResult, slaResult] = await Promise.all([
        PrismaFactory.aggregate({
          query: FLAGS_RAISED_BY_DAY_SQL({
            organizationId,
            flags: flagColors,
            startISO,
            endISO,
            timeZone,
            scope,
          }),
        }),
        PrismaFactory.aggregate({
          query: SLA_COMPLIANCE_BY_DAY_SQL({
            organizationId,
            startISO,
            endISO,
            timeZone,
            scope,
          }),
        }),
      ]);

      const failed = [flagsResult, slaResult].find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const flagCountsByDayAndColor = new Map(
        (flagsResult.docs || []).map((row) => [
          `${row.day}:${row.flag}`,
          Number(row.count),
        ])
      );

      const flagsRaised = {};
      flagColors.forEach((flag) => {
        flagsRaised[FLAGS_RAISED_SERIES_KEYS[flag]] = labels.map(
          (label) => flagCountsByDayAndColor.get(`${label}:${flag}`) || 0
        );
      });

      const slaRowsByDay = new Map(
        (slaResult.docs || []).map((row) => [row.day, row])
      );

      // Null rather than 0% when nothing was resolved, so an idle day is not a breach.
      const toCompliancePct = ({withinSla, resolvedTotal}) =>
        resolvedTotal
          ? calculateAverage({
              total: withinSla * 100,
              count: resolvedTotal,
              decimals: 1,
            })
          : null;

      let windowWithinSla = 0;
      let windowResolvedTotal = 0;

      const dailyCompliance = labels.map((label) => {
        const row = slaRowsByDay.get(label);
        const withinSla = Number(row?.within_sla) || 0;
        const resolvedTotal = Number(row?.resolved_total) || 0;

        windowWithinSla += withinSla;
        windowResolvedTotal += resolvedTotal;

        return toCompliancePct({withinSla, resolvedTotal});
      });

      const doc = {
        labels,
        [ADMIN_STATS_TRENDS_METRICS.flagsRaised]: flagsRaised,
        [ADMIN_STATS_TRENDS_METRICS.slaCompliance]: {
          pct: toCompliancePct({
            withinSla: windowWithinSla,
            resolvedTotal: windowResolvedTotal,
          }),
          daily: dailyCompliance,
        },
        range,
      };

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Resolve the user ids of every active admin in an organization. Used to
   * fan-out notifications to all admins (e.g. on escalation resolution).
   */
  static async getAdminUserIdsForOrganization({organizationId, tx}) {
    try {
      const {
        success,
        docs = [],
        error,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {
          organizationId,
          role: SYSTEM_ROLES.admin.value,
          isActive: true,
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      // A failed lookup must not masquerade as "no admins" — callers need to
      // distinguish a DB error from an org that genuinely has none.
      if (!success) {
        return {success: false, userIds: [], error};
      }

      return {success: true, userIds: docs.map((doc) => doc.userId)};
    } catch (error) {
      return {success: false, userIds: [], error};
    }
  }
};
