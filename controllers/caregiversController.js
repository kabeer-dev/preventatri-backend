const {
  accessConstants: {SYSTEM_ENTITIES},
  modelConstants,
  usersConstants: {SYSTEM_ROLES},
} = require('../constants');

const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {
  CAREGIVERS_SORT_FIELDS,
  CAREGIVER_SOURCES,
  CAREGIVER_STATUSES,
} = require('../constants/caregiversConstants');

const {
  HHA_MANAGED_CAREGIVER_FIELDS,
} = require('../constants/hhaExchangeConstants');

const {
  UsersErrorsFactories,
  GeneralErrorsFactories,
  GeneralResponsesFactories,
  CaregiversErrorsFactories,
  CaregiversResponsesFactories,
} = require('../factories');
const {UsersControllerHelpers} = require('../helpers');

const {
  UsersServices,
  CaregiversServices,
  PatientsServices,
  ChecklistAssignmentServices,
  GeneralServices,
} = require('../services');

const {getDaysFromNow} = require('../utils/dateUtils');

const {
  getListParams,
  buildOrderByClause,
  withIdTieBreaker,
  filterUndefined,
  isDocumentDuplicationError,
} = require('../utils/general');

const {
  assertHhaManagedFieldsNotEdited,
} = require('../utils/hhaExchange/managedFieldsUtils');

const {
  resolveAdminEmailUpdate,
} = require('../utils/hhaExchange/userProfileSyncUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

module.exports = class CaregiversController {
  /**
   * Invite a caregiver to the organization
   * POST /caregivers/invite
   */
  static async inviteCaregiver(req, res, next) {
    const {
      // User fields
      email,
      firstName,
      lastName,
      phoneNo,
      address,
      city,
      state,
      zipCode,

      // CaregiverProfile fields
      role,
      status = CAREGIVER_STATUSES.ACTIVE.value,
      relationshipToPatient,
      preferredContactMethod,
      language,
      notes,
      startDate,
      terminationDate,
      onCallIndicator,

      // Patient assignments (optional on invite)
      patientIds,
    } = req.body;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

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

    // Validate patient IDs if provided
    if (patientIds && patientIds.length > 0) {
      const {valid, error: patientValidationError} =
        await PatientsServices.validatePatientIds({patientIds});

      if (!valid) {
        throw CaregiversErrorsFactories.invalidPatientAssignmentErr({
          customMessage: patientValidationError,
        });
      }
    }

    // Wrap in single transaction
    const {createdUser, caregiverProfile} = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Add user to system
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: filterUndefined({
            obj: {
              email,
              firstName,
              lastName,
              phoneNo,

              // Caregiver address lives on `users` -- CaregiverProfile is a
              // User satellite -- so it is set here rather than on the profile.
              address,
              city,
              state,
              zipCode,
            },
          }),
          existingUserPrismaDoc: existingUser,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.caregiver.value,
          isExistingOrgMember: isUserPartOfCurrentOrganization,
          isPendingInvitation,
          pendingProfileStatus: status,
          tx,
        });

        // Step 2: Create caregiver profile
        const {
          success: profileSuccess,
          doc: caregiverProfile,
          error: profileError,
        } = await CaregiversServices.createCaregiverProfile({
          userId: createdUser.id,
          organizationId,
          role,
          status: isPendingInvitation
            ? CAREGIVER_STATUSES.INACTIVE.value
            : status,
          relationshipToPatient,
          preferredContactMethod,
          language,
          notes,
          startDate,
          terminationDate,
          onCallIndicator,
          tx,
        });

        if (!profileSuccess || profileError) {
          throw (
            profileError ||
            GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to create caregiver profile',
            })
          );
        }

        // Step 3: Assign patients if provided
        if (patientIds && patientIds.length > 0) {
          const {success: assignSuccess, error: assignError} =
            await CaregiversServices.assignPatientsToCaregiver({
              caregiverProfileId: caregiverProfile.id,
              patientIds,
              organizationId,
              tx,
            });

          if (!assignSuccess || assignError) {
            throw (
              assignError ||
              GeneralErrorsFactories.internalErr({
                customMessage: 'Failed to assign patients to caregiver',
              })
            );
          }
        }

        return {createdUser, caregiverProfile};
      },
    });

    // Send invitation email (outside transaction)
    UsersControllerHelpers.sendInvitation({
      user: createdUser,
      existingUser,
      invitingUser: token.user,
      role: SYSTEM_ROLES.caregiver.value,
      organizationId,
    });

    req.extra.audit.createdId = caregiverProfile.id;

    return GeneralResponsesFactories.invitedSuccessfully({
      entityType: SYSTEM_ENTITIES.caregiver.label,
    });
  }

  /**
   * Get caregiver profile details
   * GET /caregivers/:id
   */
  static async getCaregiver(req, res, next) {
    const {id} = req.params;

    // Archived people stay readable so the roster's archived view can open
    // them; the response carries `archived` so the page can lock editing.
    const {success, doc: caregiverProfile} =
      await CaregiversServices.getCaregiverProfileById({
        id,
        options: {
          includeDeleted: true,
          fieldsInclusion: {include: ['isDeleted']},
        },
      });

    if (!success || !caregiverProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Caregiver not found',
      });
    }

    return CaregiversResponsesFactories.caregiverProfileRetrieved({
      caregiver: caregiverProfile,
    });
  }

  /**
   * Update caregiver profile
   * PATCH /caregivers/:id
   */
  static async updateCaregiver(req, res, next) {
    const {id} = req.params;

    const {
      // User fields
      email,
      firstName,
      lastName,
      phoneNo,
      address,
      city,
      state,
      zipCode,

      // CaregiverProfile fields
      role,
      status,
      relationshipToPatient,
      preferredContactMethod,
      language,
      notes,
      startDate,
      terminationDate,
      onCallIndicator,
    } = req.body;

    // Get caregiver profile
    const {success, doc: caregiverProfile} =
      await CaregiversServices.getCaregiverProfileById({id});

    if (!success || !caregiverProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Caregiver not found',
      });
    }

    const isHhaManaged =
      caregiverProfile.source === CAREGIVER_SOURCES.HHA_EXCHANGE.value;

    // HHAeXchange owns these fields on an imported caregiver and the nightly
    // sync overwrites them. Accepting an edit here would let it vanish silently
    // at midnight, so it is refused instead.
    assertHhaManagedFieldsNotEdited({
      body: req.body,
      isHhaManaged,
      managedFields: HHA_MANAGED_CAREGIVER_FIELDS,
    });

    // An admin may type the login email of an imported person only while it is
    // the sync's placeholder or HHAeXchange's address is shared with someone.
    const emailUpdate =
      email === undefined
        ? {}
        : await resolveAdminEmailUpdate({
            userId: caregiverProfile.userId,
            organizationId: caregiverProfile.organizationId,
            isHhaManaged,
            email,
          });

    // Update in transaction
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Update user fields if provided
        const userUpdateData = filterUndefined({
          obj: Object.assign(
            {firstName, lastName, phoneNo, address, city, state, zipCode},
            emailUpdate
          ),
        });

        if (Object.keys(userUpdateData).length > 0) {
          const {success: userSuccess, error: userError} =
            await UsersServices.updateOne({
              id: caregiverProfile.userId,
              data: userUpdateData,
              tx,
            });

          if (userError && isDocumentDuplicationError({error: userError}))
            throw CaregiversErrorsFactories.caregiverAlreadyExistsErr();

          if (!userSuccess || userError)
            throw GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to update caregiver',
            });
        }

        // Update caregiver profile fields if provided
        const profileUpdateData = filterUndefined({
          obj: {
            role,
            status,
            relationshipToPatient,
            preferredContactMethod,
            language,
            notes,
            startDate,
            terminationDate,
            onCallIndicator,
          },
        });

        if (Object.keys(profileUpdateData).length > 0) {
          const {success: profileSuccess, error: profileError} =
            await CaregiversServices.updateCaregiverProfile({
              id,
              updateData: profileUpdateData,
              tx,
            });
          if (!profileSuccess || profileError) {
            throw GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to update caregiver',
            });
          }
        }
      },
    });

    // Fetch updated data AFTER transaction commits
    const {success: fetchSuccess, doc: updatedProfile} =
      await CaregiversServices.getCaregiverProfileById({id});

    if (!fetchSuccess || !updatedProfile) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch updated caregiver',
      });
    }

    return CaregiversResponsesFactories.caregiverProfileUpdated({
      caregiver: updatedProfile,
    });
  }

  /**
   * Delete (soft-delete) a caregiver
   * DELETE /caregivers/:id
   *
   * Deletes the caregiver profile and resets the user's permissions
   * as a single atomic transaction to ensure consistency.
   */
  static async deleteCaregiver(req, res, next) {
    const {id} = req.params;

    // Get caregiver profile
    const {success, doc: caregiverProfile} =
      await CaregiversServices.getCaregiverProfileById({id});

    if (!success || !caregiverProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Caregiver not found',
      });
    }

    // Verify caregiver has no active assignments
    const {hasActive, success: hasActiveSuccess} =
      await ChecklistAssignmentServices.hasActiveAssignments({
        caregiverProfileId: id,
      });

    if (!hasActiveSuccess) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to verify caregiver assignments',
      });
    }

    if (hasActive)
      throw CaregiversErrorsFactories.caregiverHasActiveAssignmentsErr();

    // Wrap deletion and permission reset in a single transaction
    // This ensures both operations succeed or both fail together
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Delete caregiver profile
        const {success: deleteSuccess, error: deleteError} =
          await CaregiversServices.deleteCaregiverProfile({id, tx});

        if (!deleteSuccess || deleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete caregiver',
          });
        }

        // Step 2: Reset permissions after profile deletion
        const {success: permSuccess, error: permError} =
          await UsersServices.resetUserPermissions({
            userId: caregiverProfile.userId,
            organizationId: caregiverProfile.organizationId,
            tx,
          });

        if (!permSuccess || permError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage:
              'Failed to reset user permissions after deleting caregiver',
          });
        }

        // Step 3: Remove the person from this organization. Their account is
        // deleted only when this was their last one.
        const {success: userDeleteSuccess, error: userDeleteError} =
          await UsersServices.removeUserFromOrganization({
            userId: caregiverProfile.userId,
            organizationId: caregiverProfile.organizationId,
            tx,
          });

        if (!userDeleteSuccess || userDeleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete user after deleting caregiver',
          });
        }
      },
    });

    return CaregiversResponsesFactories.caregiverProfileDeleted();
  }

  /**
   * List caregivers in organization
   * GET /caregivers
   */
  static async listCaregivers(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});
    const {status, role, search} = req.query;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: CAREGIVERS_SORT_FIELDS,
    });

    const {
      success,
      docs: caregiverProfiles,
      error,
      count,
    } = await CaregiversServices.listCaregiverProfiles({
      status,
      role,
      name: search,
      skip,
      take: limit,
      sort: withIdTieBreaker({orderBy}),
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch caregivers',
      });
    }

    return CaregiversResponsesFactories.caregiversListRetrieved({
      caregivers: caregiverProfiles,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * Get dashboard stats for the logged-in caregiver
   * GET /caregivers/stats
   */
  static async getCaregiverStats(req, res, next) {
    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Optional date range; absent bounds keep the metric all-time.
    const {from, to} = req.query;

    const {
      success,
      doc: stats,
      error,
    } = await CaregiversServices.getCaregiverStats({
      userId,
      organizationId,
      from,
      to,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve caregiver stats',
      });
    }

    return CaregiversResponsesFactories.caregiverStatsRetrieved({stats});
  }

  /**
   * Get org-wide caregiver stats for the admin dashboard
   * GET /caregivers/admin/stats
   */
  static async getCaregiverAdminStats(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Optional date range; absent bounds keep the metrics all-time.
    const {from, to} = req.query;

    const {
      success,
      doc: stats,
      error,
    } = await CaregiversServices.getCaregiverAdminStats({
      organizationId,
      from,
      to,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve caregiver admin stats',
      });
    }

    return CaregiversResponsesFactories.caregiverAdminStatsRetrieved({stats});
  }

  /**
   * Get caregiver statistics
   * GET /caregivers/:id/statistics
   */
  static async getCaregiverStatistics(req, res, next) {
    const {id} = req.params;

    const {success, doc: caregiverProfile} =
      await CaregiversServices.getCaregiverProfileById({id});

    if (!success || !caregiverProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Caregiver not found',
      });
    }

    const caregiverUserId = caregiverProfile.userId;
    const thirtyDaysAgo = getDaysFromNow({days: -30});

    const [submissionsCount, redFlagsCount] = await Promise.all([
      GeneralServices.countDocuments({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: {
          assigneeId: caregiverUserId,
          status: CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
          submittedAt: {gte: thirtyDaysAgo},
        },
        options: {includeDeleted: true},
      }),
      GeneralServices.countDocuments({
        model: modelConstants.MODELS.RED_FLAG,
        query: {
          submittedBy: caregiverUserId,
          createdAt: {gte: thirtyDaysAgo},
        },
        options: {includeDeleted: true},
      }),
    ]);

    return CaregiversResponsesFactories.caregiverStatisticsRetrieved({
      statistics: {
        submissionsCount: submissionsCount.count,
        redFlagsCount: redFlagsCount.count,
      },
    });
  }
};
