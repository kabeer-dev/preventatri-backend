const {
  accessConstants: {SYSTEM_ENTITIES},
  usersConstants: {SYSTEM_ROLES},
} = require('../constants');
const {ENTITY_STATUSES} = require('../constants/generalConstant');

const {
  NURSES_SORT_FIELDS,
  NURSE_SOURCES,
  NURSE_DEFAULT_LICENSE_STATE,
  NURSE_REGION_ROLES,
} = require('../constants/nursesConstants');

const {
  UsersErrorsFactories,
  GeneralErrorsFactories,
  GeneralResponsesFactories,
  NursesErrorsFactories,
  NursesResponsesFactories,
} = require('../factories');
const {UsersControllerHelpers} = require('../helpers');

const {UsersServices, NursesServices} = require('../services');
const {normalizeToISO} = require('../utils/dateUtils');

const {
  getListParams,
  buildOrderByClause,
  withIdTieBreaker,
  filterUndefined,
  isDocumentDuplicationError,
} = require('../utils/general');

const {
  assertHhaManagedFieldsNotEdited,
  resolveNurseHhaManagedFields,
} = require('../utils/hhaExchange/managedFieldsUtils');

const {
  resolveAdminEmailUpdate,
} = require('../utils/hhaExchange/userProfileSyncUtils');
const {resolveNurseScope} = require('../utils/nurseScopingUtils');

const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

module.exports = class NursesController {
  /**
   * Invite a nurse to the organization
   * POST /nurses/invite
   */
  static async inviteNurse(req, res, next) {
    const {
      // User fields. Address lives on `users` like every other role; it is
      // edited through the nurse endpoints, as caregivers do.
      email,
      firstName,
      lastName,
      phoneNo,
      address,
      city,
      state,
      zipCode,

      // NurseProfile fields
      professionalRole,
      licenseNumber,
      licenseState = NURSE_DEFAULT_LICENSE_STATE,
      licenseExpirationDate,
      status = ENTITY_STATUSES.ACTIVE.value,
      npi,
      onCallIndicator,
      preferredContactMethod,
      notes,
      joiningDate,

      // Region assignments
      primaryRegionIds,
      secondaryRegionIds,
    } = req.body;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Validate region IDs exist in organization
    const {valid, error: regionValidationError} =
      await NursesServices.validateRegionAssignment({
        primaryRegionIds,
        secondaryRegionIds,
      });

    if (!valid) throw regionValidationError;

    // Check if user already exists by email
    const {
      success: lookupSuccess,
      user: existingUser,
      isMember: isUserPartOfCurrentOrganization,
      error: lookupError,
    } = await UsersServices.getUserForInvitationByEmail({
      email,
      organizationId,
    });

    if (!lookupSuccess) throw lookupError;

    // A person who already uses their account joins only after accepting, so
    // their profile waits inactive until then.
    const isPendingInvitation = Boolean(existingUser?.isVerified);

    // If user is already in this org, reject — email is already in use
    if (isUserPartOfCurrentOrganization) {
      throw UsersErrorsFactories.userAlreadyRegisteredErr();
    }

    // Wrap ENTIRE nurse invitation process in single transaction
    // This ensures if ANY step fails, ALL changes (user + nurse profile + regions) are rolled back
    const {createdUser, nurseProfile} = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Add user to system with transaction context
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: filterUndefined({
            obj: {
              email,
              firstName,
              lastName,
              phoneNo,
              address,
              city,
              state,
              zipCode,
            },
          }),
          existingUserPrismaDoc: existingUser,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.nurse.value,
          isExistingOrgMember: isUserPartOfCurrentOrganization,
          isPendingInvitation,
          pendingProfileStatus: status,
          tx, // Pass transaction context so user creation uses this transaction
        });

        // Step 2: Create nurse profile with all required fields
        const {
          success: profileSuccess,
          doc: nurseProfile,
          error: profileError,
        } = await NursesServices.createNurseProfile({
          userId: createdUser.id,
          organizationId,
          professionalRole,
          licenseNumber,
          licenseState,

          // Use dateUtils for date handling consistency
          licenseExpirationDate: licenseExpirationDate
            ? normalizeToISO({date: licenseExpirationDate})
            : undefined,
          status: isPendingInvitation ? ENTITY_STATUSES.INACTIVE.value : status,
          npi,
          onCallIndicator,
          preferredContactMethod,
          notes,
          joiningDate: joiningDate
            ? normalizeToISO({date: joiningDate})
            : undefined,
          tx,
        });

        if (!profileSuccess || profileError) {
          throw (
            profileError ||
            GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to create nurse profile',
            })
          );
        }

        // Step 3: Assign nurse to regions
        const {success: regionSuccess, error: regionAssignError} =
          await NursesServices.assignNurseToRegions({
            nurseProfileId: nurseProfile.id,
            primaryRegionIds,
            secondaryRegionIds,
            organizationId,
            tx,
          });

        if (!regionSuccess || regionAssignError) {
          throw (
            regionAssignError ||
            GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to assign nurse to regions',
            })
          );
        }

        return {createdUser, nurseProfile};
      },
    });

    // Send invitation email (outside transaction, non-critical operation)
    const invitingUser = token.user;
    UsersControllerHelpers.sendInvitation({
      user: createdUser,
      existingUser,
      invitingUser,
      role: SYSTEM_ROLES.nurse.value,
      organizationId,
    });

    req.extra.audit.createdId = nurseProfile.id;

    return GeneralResponsesFactories.invitedSuccessfully({
      entityType: SYSTEM_ENTITIES.nurse.label,
    });
  }

  /**
   * Get nurse profile details
   * GET /nurses/:id
   */
  static async getNurse(req, res, next) {
    const {id} = req.params;

    // Archived people stay readable so the roster's archived view can open
    // them; the response carries `archived` so the page can lock editing.
    const {success, doc: nurseProfile} =
      await NursesServices.getNurseProfileById({
        id,
        options: {
          includeDeleted: true,
          fieldsInclusion: {include: ['isDeleted']},
        },
      });

    if (!success || !nurseProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Nurse not found',
      });
    }

    return NursesResponsesFactories.nurseProfileRetrieved({
      nurse: nurseProfile,
    });
  }

  /**
   * Update nurse profile
   * PATCH /nurses/:id
   */
  static async updateNurse(req, res, next) {
    const {id} = req.params;

    const {
      // User fields (go to User table)
      email,
      firstName,
      lastName,
      phoneNo,
      address,
      city,
      state,
      zipCode,

      // NurseProfile fields (go to NurseProfile table)
      professionalRole,
      licenseNumber,
      licenseState,
      licenseExpirationDate,
      status,
      npi,
      onCallIndicator,
      preferredContactMethod,
      notes,
      joiningDate,
      primaryRegionIds,
      secondaryRegionIds,
    } = req.body;

    // Get nurse profile
    const {success, doc: nurseProfile} =
      await NursesServices.getNurseProfileById({id});

    if (!success || !nurseProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Nurse not found',
      });
    }

    const isHhaManaged =
      nurseProfile.source === NURSE_SOURCES.HHA_EXCHANGE.value;

    // HHAeXchange owns the person, the role, the status, the licence number and
    // (while the address resolves) the primary regions; the sync would
    // overwrite an edit, so it is refused. Everything else stays editable.
    assertHhaManagedFieldsNotEdited({
      body: req.body,
      isHhaManaged,
      managedFields: resolveNurseHhaManagedFields({nurseProfile}),
    });

    // Listing the locked primary region as secondary would demote it.
    if (isHhaManaged && nurseProfile.isPrimaryRegionHhaManaged) {
      const lockedPrimaryIds = (nurseProfile.regionalNurses || [])
        .filter((row) => row.nurseRegionRole === NURSE_REGION_ROLES.PRIMARY)
        .map((row) => row.regionId);

      if (
        (secondaryRegionIds || []).some((regionId) =>
          lockedPrimaryIds.includes(regionId)
        )
      ) {
        throw NursesErrorsFactories.invalidRegionAssignmentErr({
          customMessage:
            'The primary region comes from HHAeXchange and cannot also be a secondary region',
        });
      }
    }

    // An admin may type the login email of an imported person only while it is
    // the sync's placeholder or HHAeXchange's address is shared with someone.
    const emailUpdate =
      email === undefined
        ? {}
        : await resolveAdminEmailUpdate({
            userId: nurseProfile.userId,
            organizationId: nurseProfile.organizationId,
            isHhaManaged,
            email,
          });

    // 1. Build the region change plan (PATCH semantics). It is null when the
    // incoming IDs match the nurse's current assignments, so a non-region edit
    // (e.g. name) that echoes unchanged IDs skips validation, assignment, and the
    // destructive patient-unassignment step entirely.
    const regionParams = filterUndefined({
      obj: {primaryRegionIds, secondaryRegionIds},
    });

    let regionAssignmentPlan = null;

    if (Object.keys(regionParams).length > 0) {
      const {
        success: planSuccess,
        plan,
        error: planError,
      } = await NursesServices.buildRegionAssignmentPlan({
        nurseProfileId: id,
        organizationId: nurseProfile.organizationId,
        primaryRegionIds: regionParams.primaryRegionIds,
        secondaryRegionIds: regionParams.secondaryRegionIds,
      });

      if (!planSuccess)
        throw (
          planError ||
          GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to evaluate nurse region changes',
          })
        );

      regionAssignmentPlan = plan;
    }

    if (regionAssignmentPlan) {
      const {valid: regionValid, error: regionError} =
        await NursesServices.validateRegionAssignment({
          primaryRegionIds: regionParams.primaryRegionIds,
          secondaryRegionIds: regionParams.secondaryRegionIds,
        });

      if (!regionValid) {
        throw regionError;
      }
    }

    // 2. Update in transaction (writes only)
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Name, phone and address are the person's details in THIS
        // organization only; the account keeps just the email.
        const membershipUpdateData = filterUndefined({
          obj: {firstName, lastName, phoneNo, address, city, state, zipCode},
        });

        if (Object.keys(membershipUpdateData).length > 0) {
          const {error: membershipError} =
            await UsersServices.updateMembershipDetails({
              userId: nurseProfile.userId,
              organizationId: nurseProfile.organizationId,
              data: membershipUpdateData,
              tx,
            });

          if (membershipError) throw membershipError;
        }

        const userUpdateData = filterUndefined({obj: emailUpdate});

        if (Object.keys(userUpdateData).length > 0) {
          const {success: userUpdated, error: userError} =
            await UsersServices.updateOne({
              id: nurseProfile.userId,
              data: userUpdateData,
              tx,
            });

          // updateOne answers with an envelope rather than throwing, so a
          // failed write (a duplicate email most likely) has to be raised
          // here or the transaction commits and the client hears "success".
          if (userError && isDocumentDuplicationError({error: userError}))
            throw UsersErrorsFactories.userAlreadyRegisteredErr();

          if (!userUpdated)
            throw userError || new Error('Nurse user update failed');
        }

        // Update nurse profile fields if provided
        const profileUpdateData = filterUndefined({
          obj: {
            professionalRole,
            licenseNumber,
            licenseState,

            // An explicit null clears the date; normalizeToISO would turn it
            // into undefined and filterUndefined would then drop the field.
            licenseExpirationDate:
              licenseExpirationDate === null ||
              licenseExpirationDate === undefined
                ? licenseExpirationDate
                : normalizeToISO({date: licenseExpirationDate}),
            status,
            npi,
            onCallIndicator,
            preferredContactMethod,
            notes,
            joiningDate:
              joiningDate !== undefined
                ? normalizeToISO({date: joiningDate})
                : undefined,
          },
        });

        if (Object.keys(profileUpdateData).length > 0) {
          await NursesServices.updateNurseProfile({
            id,
            updateData: profileUpdateData,
            tx,
          });
        }

        // Apply the precomputed region plan (only set when something changed),
        // clearing patient slots the nurse no longer covers.
        if (regionAssignmentPlan) {
          const {success: regionAssignSuccess, error: regionAssignError} =
            await NursesServices.applyRegionAssignment({
              nurseProfileId: id,
              primaryRegionIds: regionParams.primaryRegionIds,
              secondaryRegionIds: regionParams.secondaryRegionIds,
              organizationId: nurseProfile.organizationId,
              plan: regionAssignmentPlan,
              tx,
            });

          if (!regionAssignSuccess) {
            throw (
              regionAssignError ||
              GeneralErrorsFactories.internalErr({
                customMessage: 'Failed to update nurse region assignments',
              })
            );
          }
        }
      },
    });

    // Fetch updated data AFTER transaction commits (guarantees fresh data)
    const {success: fetchSuccess, doc: updatedProfile} =
      await NursesServices.getNurseProfileById({
        id,
      });

    if (!fetchSuccess || !updatedProfile) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch updated nurse',
      });
    }

    return NursesResponsesFactories.nurseProfileUpdated({
      nurse: updatedProfile,
    });
  }

  /**
   * Delete (soft-delete) a nurse
   * DELETE /nurses/:id
   *
   * Also resets the user's permissions to ensure consistency
   * after the nurse profile is removed.
   */
  static async deleteNurse(req, res, next) {
    const {id} = req.params;

    // Get nurse profile
    const {success, doc: nurseProfile} =
      await NursesServices.getNurseProfileById({id});

    if (!success || !nurseProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Nurse not found',
      });
    }

    // Wrap deletion and permission reset in a single transaction
    // This ensures both operations succeed or both fail together
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Soft delete nurse profile
        const {success: deleteSuccess, error: deleteError} =
          await NursesServices.deleteNurseProfile({id, tx});

        if (!deleteSuccess || deleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete nurse',
          });
        }

        const {success: releaseSuccess} =
          await NursesServices.releaseNursePatients({nurseProfileId: id, tx});

        if (!releaseSuccess) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to remove the nurse from their patients',
          });
        }

        // Step 2: Reset permissions after profile deletion
        const {success: permSuccess, error: permError} =
          await UsersServices.resetUserPermissions({
            userId: nurseProfile.userId,
            organizationId: nurseProfile.organizationId,
            tx,
          });

        if (!permSuccess || permError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage:
              'Failed to reset user permissions after deleting nurse',
          });
        }

        // Step 3: Remove the person from this organization. Their account is
        // deleted only when this was their last one.
        const {success: userDeleteSuccess, error: userDeleteError} =
          await UsersServices.removeUserFromOrganization({
            userId: nurseProfile.userId,
            organizationId: nurseProfile.organizationId,
            tx,
          });

        if (!userDeleteSuccess || userDeleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete user after deleting nurse',
          });
        }
      },
    });

    return NursesResponsesFactories.nurseProfileDeleted();
  }

  /**
   * List nurses in organization
   * GET /nurses
   */
  static async listNurses(req, res, next) {
    // Query params are already validated by route middleware
    // getListParams extracts all query params: page, limit, skip, search, date, sortBy, sortDir
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});
    const {status, regionId, nurseRegionRole, search, isVerified} = req.query;

    const isVerifiedFilter =
      isVerified === 'true' ? true : isVerified === 'false' ? false : undefined;

    // Build sort object for Prisma
    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: NURSES_SORT_FIELDS,
    });

    const {
      success,
      docs: nurseProfiles,
      error,
      count,
    } = await NursesServices.listNurseProfiles({
      status,
      regionId,
      nurseRegionRole,
      isVerified: isVerifiedFilter,
      name: search,
      skip,
      take: limit,
      sort: withIdTieBreaker({orderBy}),
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch nurses',
      });
    }

    // Alert workload + avg response for the page's nurses . organizationId is passed
    // explicitly because the stats queries run with bypassExtraQueries, which
    // suppresses the ACL layer's automatic org scoping.
    const organizationId =
      req.extra.jwtToken.user.currentActiveOrganization.organizationId;

    const {
      success: statsSuccess,
      statsByUserId,
      error: statsError,
    } = await NursesServices.getNurseAlertStatsByUserIds({
      userIds: nurseProfiles.map((profile) => profile.userId),
      organizationId,
    });

    if (!statsSuccess || statsError) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch nurse alert stats',
      });
    }

    return NursesResponsesFactories.nursesListRetrieved({
      nurses: nurseProfiles,
      statsByUserId,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * Get the dashboard for the logged-in nurse
   * GET /nurses/dashboard
   */
  static async getNurseDashboard(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const nurseScope = await resolveNurseScope({token});

    const {
      success,
      doc: dashboard,
      error,
    } = await NursesServices.getNurseDashboard({
      nurseScope,
      organizationId,
      userId: token.user.id,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve nurse dashboard',
      });
    }

    return NursesResponsesFactories.nurseDashboardRetrieved({dashboard});
  }

  /**
   * Get org-wide nurse stats for the admin dashboard
   * GET /nurses/admin/stats
   */
  static async getNurseAdminStats(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Already validated/cast by the query validator (from/to are Date objects).
    const {from, to} = req.query;

    const {
      success,
      doc: stats,
      error,
    } = await NursesServices.getNurseAdminStats({
      organizationId,
      from,
      to,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve nurse admin stats',
      });
    }

    return NursesResponsesFactories.nurseAdminStatsRetrieved({stats});
  }
};
