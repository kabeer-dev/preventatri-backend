const AppResponse = require('./app');

const {
  CASE_MANAGER_SUCCESS_TYPES,
} = require('../../constants/responses/success/caseManagers');

const {
  isPlaceholderEmail,
} = require('../../utils/hhaExchange/placeholderEmailUtils');

module.exports = class CaseManagersResponsesFactories {
  /**
   * Internal helper to format case manager object from database model
   * Centralizes the mapping from Prisma model to API response shape
   */
  static formatCaseManager({caseManagerProfile, includeUser = true}) {
    const regions =
      caseManagerProfile.caseManagerRegions?.map((cmr) => ({
        id: cmr.region?.id || cmr.regionId,
        name: cmr.region?.name,
        code: cmr.region?.code,
        assignedAt: cmr.assignedAt,
      })) || [];

    const patients =
      caseManagerProfile.caseManagerPatients?.map((cmp) => ({
        id: cmp.patient?.id || cmp.patientId,
        firstName: cmp.patient?.firstName,
        lastName: cmp.patient?.lastName,

        // HHA patients' links come from the patient sync and are read-only.
        source: cmp.patient?.source,
        assignedAt: cmp.assignedAt,
      })) || [];

    const formatted = {
      profileId: caseManagerProfile.id,
      archived: Boolean(caseManagerProfile.isDeleted),
      caseManagerId: caseManagerProfile.userId,
      organizationId: caseManagerProfile.organizationId,

      // Professional info
      status: caseManagerProfile.status,

      // Optional fields
      preferredContactMethod: caseManagerProfile.preferredContactMethod,
      language: caseManagerProfile.language,
      startDate: caseManagerProfile.startDate,
      title: caseManagerProfile.title,
      notes: caseManagerProfile.notes,

      // HHAeXchange provenance. The frontend greys out the managed fields on an
      // HHA_EXCHANGE case manager, so `source` has to reach it. hhaSyncHash is
      // never exposed -- it is internal state and is not even in the model's
      // default field set.
      //
      // There is no hhaModifiedDate counterpart to the caregiver response:
      // GetCoordinators publishes no ModifiedDate, so hhaLastSyncedAt is the
      // only timestamp this integration can show for a case manager.
      source: caseManagerProfile.source,
      hhaCoordinatorId: caseManagerProfile.hhaCoordinatorId,
      hhaLastSyncedAt: caseManagerProfile.hhaLastSyncedAt,

      // Regions
      regions,

      // Patients
      patients,
      assignedPatientsCount:
        caseManagerProfile._count?.caseManagerPatients ?? patients.length,

      createdAt: caseManagerProfile.createdAt,
      updatedAt: caseManagerProfile.updatedAt,
    };

    // Include user info if available
    if (includeUser && caseManagerProfile.user) {
      formatted.user = {
        id: caseManagerProfile.user.id,
        firstName: caseManagerProfile.user.firstName,
        lastName: caseManagerProfile.user.lastName,
        email: caseManagerProfile.user.email,
        phoneNo: caseManagerProfile.user.phoneNo,
        isVerified: caseManagerProfile.user.isVerified,

        // Lets the UI offer the one email edit that is allowed: replacing the
        // synthetic address sync minted for a coordinator HHAeXchange had none
        // for. See updateCaseManager.
        isPlaceholderEmail: isPlaceholderEmail({
          email: caseManagerProfile.user.email,
        }),
      };
    }

    return formatted;
  }

  static caseManagerProfileRetrieved({caseManager}) {
    return new AppResponse({
      message: 'Case manager profile retrieved successfully',
      statusCode: 200,
      body: {
        caseManager: CaseManagersResponsesFactories.formatCaseManager({
          caseManagerProfile: caseManager,
        }),
        type: CASE_MANAGER_SUCCESS_TYPES.caseManagerProfileRetrieved.value,
      },
    });
  }

  static caseManagerProfileUpdated({caseManager}) {
    return new AppResponse({
      message: 'Case manager profile updated successfully',
      statusCode: 200,
      body: {
        caseManager: CaseManagersResponsesFactories.formatCaseManager({
          caseManagerProfile: caseManager,
        }),
        type: CASE_MANAGER_SUCCESS_TYPES.caseManagerProfileUpdated.value,
      },
    });
  }

  static caseManagersListRetrieved({caseManagers, meta}) {
    return new AppResponse({
      message: 'Case managers list retrieved successfully',
      statusCode: 200,
      body: {
        caseManagers: caseManagers.map((cm) =>
          CaseManagersResponsesFactories.formatCaseManager({
            caseManagerProfile: cm,
          })
        ),
        meta,
        type: CASE_MANAGER_SUCCESS_TYPES.caseManagersListRetrieved.value,
      },
    });
  }

  static caseManagerProfileDeleted() {
    return new AppResponse({
      statusCode: 200,
      message: 'Case manager profile deleted successfully',
      body: {type: CASE_MANAGER_SUCCESS_TYPES.caseManagerProfileDeleted.value},
    });
  }

  static availablePatientsRetrieved({patients}) {
    return new AppResponse({
      message: 'Available patients retrieved successfully',
      statusCode: 200,
      body: {
        patients: patients.map((p) => ({
          value: p.id,
          label: `${p.firstName} ${p.lastName}`,
        })),
        type: CASE_MANAGER_SUCCESS_TYPES.availablePatientsRetrieved.value,
      },
    });
  }

  static caseManagerDashboardRetrieved({dashboard}) {
    return new AppResponse({
      message: 'Case manager dashboard retrieved successfully',
      statusCode: 200,
      body: {
        stats: dashboard.stats,
        checklistTasks: dashboard.checklistTasks,
        type: CASE_MANAGER_SUCCESS_TYPES.caseManagerDashboardRetrieved.value,
      },
    });
  }

  static caseManagerAdminStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Case manager admin stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: CASE_MANAGER_SUCCESS_TYPES.caseManagerAdminStatsRetrieved.value,
      },
    });
  }
};
