const {
  accessConstants: {SYSTEM_ENTITIES},
  usersConstants: {SYSTEM_ROLES},
} = require('../constants');

const {
  CASE_MANAGERS_SORT_FIELDS,
  CASE_MANAGER_SOURCES,
} = require('../constants/caseManagersConstants');

const {ENTITY_STATUSES} = require('../constants/generalConstant');

const {
  HHA_MANAGED_CASE_MANAGER_FIELDS,
} = require('../constants/hhaExchangeConstants');

const {
  UsersErrorsFactories,
  GeneralErrorsFactories,
  GeneralResponsesFactories,
  CaseManagersErrorsFactories,
  CaseManagersResponsesFactories,
  HhaExchangeErrorsFactories,
} = require('../factories');
const {UsersControllerHelpers} = require('../helpers');

const {UsersServices, CaseManagersServices} = require('../services');

const {
  getListParams,
  buildOrderByClause,
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

/**
 * The manual subset of a requested roster. An HHA patient's case manager comes
 * from the patient sync: one already linked here may be echoed back, any other
 * is refused.
 */
const resolveManualPatientIds = async ({patientIds, linkedPatientIds = []}) => {
  const {success, hhaPatientIds, manualPatientIds, error} =
    await CaseManagersServices.splitPatientIdsBySource({patientIds});

  if (!success) {
    throw (
      error ||
      GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to validate patient assignments',
      })
    );
  }

  if (hhaPatientIds.some((id) => !linkedPatientIds.includes(id))) {
    throw HhaExchangeErrorsFactories.hhaManagedFieldReadOnlyErr({
      fields: ['patientIds'],
    });
  }

  return manualPatientIds;
};

module.exports = class CaseManagersController {
  /**
   * Invite a case manager to the organization
   * POST /case-managers/invite
   */
  static async inviteCaseManager(req, res, next) {
    const {
      // User fields
      email,
      firstName,
      lastName,
      phoneNo,

      // CaseManagerProfile fields
      status = ENTITY_STATUSES.ACTIVE.value,
      preferredContactMethod,
      language,
      startDate,
      title,
      notes,

      // Region assignments
      regionIds,

      // Patient assignments
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

    const manualPatientIds = await resolveManualPatientIds({patientIds});

    // Wrap in single transaction
    const {createdUser, caseManagerProfile} = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Add user to system
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: {email, firstName, lastName, phoneNo},
          existingUserPrismaDoc: existingUser,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.case_manager.value,
          isExistingOrgMember: isUserPartOfCurrentOrganization,
          isPendingInvitation,
          pendingProfileStatus: status,
          tx,
        });

        // Step 2: Create case manager profile
        const {doc: caseManagerProfile, error: profileError} =
          await CaseManagersServices.createCaseManagerProfile({
            userId: createdUser.id,
            organizationId,
            status: isPendingInvitation
              ? ENTITY_STATUSES.INACTIVE.value
              : status,
            preferredContactMethod,
            language,
            startDate,
            title,
            notes,
            tx,
          });

        if (profileError && isDocumentDuplicationError({error: profileError})) {
          throw CaseManagersErrorsFactories.caseManagerAlreadyExistsErr();
        }

        if (profileError) throw profileError;

        // Step 3: Assign regions to case manager
        const {error: regionAssignError} =
          await CaseManagersServices.assignRegionsToCaseManager({
            caseManagerProfileId: caseManagerProfile.id,
            regionIds,
            organizationId,
            tx,
          });

        if (regionAssignError) throw regionAssignError;

        // Step 4: Assign patients (optional)
        if (manualPatientIds.length) {
          const {error: patientAssignError} =
            await CaseManagersServices.assignPatientsToCaseManager({
              caseManagerProfileId: caseManagerProfile.id,
              patientIds: manualPatientIds,
              organizationId,
              tx,
            });

          if (patientAssignError) throw patientAssignError;
        }

        return {createdUser, caseManagerProfile};
      },
    });

    // Send invitation email (outside transaction)
    UsersControllerHelpers.sendInvitation({
      user: createdUser,
      existingUser,
      invitingUser: token.user,
      role: SYSTEM_ROLES.case_manager.value,
      organizationId,
    });

    req.extra.audit.createdId = caseManagerProfile.id;

    return GeneralResponsesFactories.invitedSuccessfully({
      entityType: SYSTEM_ENTITIES.caseManager.label,
    });
  }

  /**
   * Get case manager profile details
   * GET /case-managers/:id
   */
  static async getCaseManager(req, res, next) {
    const {id} = req.params;

    // Archived people stay readable so the roster's archived view can open
    // them; the response carries `archived` so the page can lock editing.
    const {success, doc: caseManagerProfile} =
      await CaseManagersServices.getCaseManagerProfileById({
        id,
        options: {
          includeDeleted: true,
          fieldsInclusion: {include: ['isDeleted']},
        },
      });

    if (!success || !caseManagerProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Case Manager not found',
      });
    }

    return CaseManagersResponsesFactories.caseManagerProfileRetrieved({
      caseManager: caseManagerProfile,
    });
  }

  /**
   * Update case manager profile
   * PATCH /case-managers/:id
   */
  static async updateCaseManager(req, res, next) {
    const {id} = req.params;

    const {
      // User fields
      email,
      firstName,
      lastName,
      phoneNo,

      // CaseManagerProfile fields
      status,
      preferredContactMethod,
      language,
      startDate,
      title,
      notes,

      // Region assignments
      regionIds,

      // Patient assignments
      patientIds,
    } = req.body;

    // Get case manager profile
    const {success, doc: caseManagerProfile} =
      await CaseManagersServices.getCaseManagerProfileById({id});

    if (!success || !caseManagerProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Case Manager not found',
      });
    }

    const isHhaManaged =
      caseManagerProfile.source === CASE_MANAGER_SOURCES.HHA_EXCHANGE.value;

    // HHAeXchange owns the name and the status on an imported case manager and
    // the nightly sync overwrites them, so an edit is refused. Title, phone,
    // regions, manual patients, contact method, language, start date and notes
    // stay editable.
    assertHhaManagedFieldsNotEdited({
      body: req.body,
      isHhaManaged,
      managedFields: HHA_MANAGED_CASE_MANAGER_FIELDS,
    });

    const manualPatientIds = patientIds
      ? await resolveManualPatientIds({
          patientIds,
          linkedPatientIds: (caseManagerProfile.caseManagerPatients || []).map(
            (link) => link.patientId
          ),
        })
      : undefined;

    // An admin may type the login email of an imported person only while it is
    // the sync's placeholder or HHAeXchange's address is shared with someone.
    const emailUpdate =
      email === undefined
        ? {}
        : await resolveAdminEmailUpdate({
            userId: caseManagerProfile.userId,
            organizationId: caseManagerProfile.organizationId,
            isHhaManaged,
            email,
          });

    // Update in transaction
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Update user fields if provided
        const userUpdateData = filterUndefined({
          obj: Object.assign({firstName, lastName, phoneNo}, emailUpdate),
        });

        if (Object.keys(userUpdateData).length > 0) {
          const {error} = await UsersServices.updateOne({
            id: caseManagerProfile.userId,
            data: userUpdateData,
            tx,
          });

          if (error && isDocumentDuplicationError({error}))
            throw CaseManagersErrorsFactories.caseManagerAlreadyExistsErr();

          if (error) throw error;
        }

        // Update case manager profile fields if provided
        const profileUpdateData = filterUndefined({
          obj: {
            status,
            preferredContactMethod,
            language,
            startDate,
            title,
            notes,
          },
        });

        if (Object.keys(profileUpdateData).length > 0) {
          await CaseManagersServices.updateCaseManagerProfile({
            id,
            updateData: profileUpdateData,
            tx,
          });
        }

        // Update region assignments if provided
        if (regionIds) {
          const {error: regionAssignError} =
            await CaseManagersServices.assignRegionsToCaseManager({
              caseManagerProfileId: id,
              regionIds,
              organizationId: caseManagerProfile.organizationId,
              tx,
            });

          if (regionAssignError) throw regionAssignError;
        }

        // Update the manual roster if provided; HHA links are left in place.
        if (manualPatientIds) {
          const {error: patientAssignError} =
            await CaseManagersServices.assignPatientsToCaseManager({
              caseManagerProfileId: id,
              patientIds: manualPatientIds,
              organizationId: caseManagerProfile.organizationId,
              tx,
            });

          if (patientAssignError) throw patientAssignError;
        }
      },
    });

    // Fetch updated data AFTER transaction commits
    const {success: fetchSuccess, doc: updatedProfile} =
      await CaseManagersServices.getCaseManagerProfileById({id});

    if (!fetchSuccess || !updatedProfile) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch updated case manager',
      });
    }

    return CaseManagersResponsesFactories.caseManagerProfileUpdated({
      caseManager: updatedProfile,
    });
  }

  /**
   * Delete (soft-delete) a case manager
   * DELETE /case-managers/:id
   *
   * Also resets the user's permissions to ensure consistency
   * after the case manager profile is removed.
   */
  static async deleteCaseManager(req, res, next) {
    const {id} = req.params;

    const {success, doc: caseManagerProfile} =
      await CaseManagersServices.getCaseManagerProfileById({id});

    if (!success || !caseManagerProfile) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Case Manager not found',
      });
    }

    const {count: assignedCount, success: assignedSuccess} =
      await CaseManagersServices.getAssignedPatientsCount({
        caseManagerProfileId: id,
      });

    if (assignedSuccess && assignedCount > 0)
      throw CaseManagersErrorsFactories.caseManagerHasAssignedPatientsErr({
        count: assignedCount,
      });

    // Wrap deletion and permission reset in a single transaction
    // This ensures both operations succeed or both fail together
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Step 1: Delete case manager profile
        const {success: deleteSuccess, error: deleteError} =
          await CaseManagersServices.deleteCaseManagerProfile({id, tx});

        if (!deleteSuccess || deleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete case manager',
          });
        }

        // Step 2: Reset permissions after profile deletion
        const {success: permSuccess, error: permError} =
          await UsersServices.resetUserPermissions({
            userId: caseManagerProfile.userId,
            organizationId: caseManagerProfile.organizationId,
            tx,
          });

        if (!permSuccess || permError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage:
              'Failed to reset user permissions after deleting case manager',
          });
        }

        // Step 3: Remove the person from this organization. Their account is
        // deleted only when this was their last one.
        const {success: userDeleteSuccess, error: userDeleteError} =
          await UsersServices.removeUserFromOrganization({
            userId: caseManagerProfile.userId,
            organizationId: caseManagerProfile.organizationId,
            tx,
          });

        if (!userDeleteSuccess || userDeleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete user after deleting case manager',
          });
        }
      },
    });

    return CaseManagersResponsesFactories.caseManagerProfileDeleted();
  }

  /**
   * Get patients not yet assigned to any case manager
   * GET /case-managers/available-patients
   */
  static async getAvailablePatients(req, res, next) {
    const {regionIds: regionIdsParam, caseManagerProfileId} = req.query;

    const regionIds = regionIdsParam
      ? regionIdsParam
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    const {
      success,
      docs: patients,
      error,
    } = await CaseManagersServices.getAvailablePatients({
      regionIds,
      caseManagerProfileId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch available patients',
      });
    }

    return CaseManagersResponsesFactories.availablePatientsRetrieved({
      patients,
    });
  }

  /**
   * List case managers in organization
   * GET /case-managers
   */
  static async listCaseManagers(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});
    const {status, regionId, search, isVerified} = req.query;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: CASE_MANAGERS_SORT_FIELDS,
    });

    const {
      success,
      docs: caseManagerProfiles,
      error,
      count,
    } = await CaseManagersServices.listCaseManagerProfiles({
      status,
      regionId,
      isVerified: isVerified === undefined ? undefined : isVerified === 'true',
      name: search,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch case managers',
      });
    }

    return CaseManagersResponsesFactories.caseManagersListRetrieved({
      caseManagers: caseManagerProfiles,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * Get the dashboard for the logged-in case manager
   * GET /case-managers/dashboard
   */
  static async getCaseManagerDashboard(req, res, next) {
    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {
      success,
      doc: dashboard,
      error,
    } = await CaseManagersServices.getCaseManagerDashboard({
      userId,
      organizationId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve case manager dashboard',
      });
    }

    return CaseManagersResponsesFactories.caseManagerDashboardRetrieved({
      dashboard,
    });
  }

  /**
   * Get org-wide case manager stats for the admin dashboard
   * GET /case-managers/admin/stats
   */
  static async getCaseManagerAdminStats(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Already validated/cast by the query validator (from/to are Date objects).
    const {from, to} = req.query;

    const {
      success,
      doc: stats,
      error,
    } = await CaseManagersServices.getCaseManagerAdminStats({
      organizationId,
      from,
      to,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve case manager admin stats',
      });
    }

    return CaseManagersResponsesFactories.caseManagerAdminStatsRetrieved({
      stats,
    });
  }
};
