const AppResponse = require('./app');

const {NURSE_REGION_ROLES} = require('../../constants/nursesConstants');

const {
  NURSE_SUCCESS_TYPES,
} = require('../../constants/responses/success/nurses');

const {
  isPlaceholderEmail,
} = require('../../utils/hhaExchange/placeholderEmailUtils');

module.exports = class NursesResponsesFactories {
  /**
   * Internal helper to format nurse profile object from database model
   * Centralizes the mapping from Prisma model to API response shape
   *
   * `stats` (alert workload + avg response) is optional and supplied only by the
   * list endpoint, which computes it per page — single-nurse responses omit the
   * fields entirely rather than reporting a misleading zero.
   */
  static formatNurse({nurseProfile, includeUser = true, stats = null}) {
    const regionsByRole = ({role}) =>
      nurseProfile.regionalNurses
        ?.filter((nr) => nr.nurseRegionRole === role)
        .map((nr) => ({
          id: nr.region?.id || nr.regionId,
          name: nr.region?.name,
          code: nr.region?.code,
        })) || [];

    const primaryRegions = regionsByRole({role: NURSE_REGION_ROLES.PRIMARY});

    const secondaryRegions = regionsByRole({
      role: NURSE_REGION_ROLES.SECONDARY,
    });

    const formatted = {
      profileId: nurseProfile.id,
      archived: Boolean(nurseProfile.isDeleted),
      nurseId: nurseProfile.userId,
      organizationId: nurseProfile.organizationId,

      // Professional info
      professionalRole: nurseProfile.professionalRole,
      licenseNumber: nurseProfile.licenseNumber,
      licenseState: nurseProfile.licenseState,
      licenseExpirationDate: nurseProfile.licenseExpirationDate,
      status: nurseProfile.status,

      // Optional fields
      npi: nurseProfile.npi,
      onCallIndicator: nurseProfile.onCallIndicator,
      preferredContactMethod: nurseProfile.preferredContactMethod,
      notes: nurseProfile.notes,
      joiningDate: nurseProfile.joiningDate,

      // Regions
      primaryRegions,
      secondaryRegions,

      // HHAeXchange provenance. The frontend greys out the managed fields on
      // an HHA_EXCHANGE nurse, so `source` has to reach it. hhaSyncHash is
      // never exposed -- it is internal state and is not even in the model's
      // default field set.
      source: nurseProfile.source,
      hhaNurseId: nurseProfile.hhaNurseId,
      hhaLastSyncedAt: nurseProfile.hhaLastSyncedAt,
      hhaModifiedDate: nurseProfile.hhaModifiedDate,
      isPrimaryRegionHhaManaged: Boolean(
        nurseProfile.isPrimaryRegionHhaManaged
      ),

      createdAt: nurseProfile.createdAt,
      updatedAt: nurseProfile.updatedAt,
    };

    // Include user info if available
    if (includeUser && nurseProfile.user) {
      formatted.user = {
        id: nurseProfile.user.id,
        firstName: nurseProfile.user.firstName,
        lastName: nurseProfile.user.lastName,
        email: nurseProfile.user.email,
        phoneNo: nurseProfile.user.phoneNo,
        address: nurseProfile.user.address,
        city: nurseProfile.user.city,
        state: nurseProfile.user.state,
        zipCode: nurseProfile.user.zipCode,
        isVerified: nurseProfile.user.isVerified,

        // Lets the UI offer the one email edit that is allowed: replacing the
        // synthetic address sync minted for a nurse HHAeXchange had none for.
        isPlaceholderEmail: isPlaceholderEmail({
          email: nurseProfile.user.email,
        }),
      };
    }

    // Alert stats: list endpoint only. avgRespTimeSeconds is raw seconds (or null
    // when the nurse has never resolved an escalation) — the client formats it and
    // derives the chip color.
    if (stats) {
      formatted.assignedAlerts = stats.assignedAlerts;
      formatted.highAlerts = stats.highAlerts;
      formatted.avgRespTimeSeconds = stats.avgRespTimeSeconds;
    }

    return formatted;
  }

  /**
   * Nurse-specific response: Nurse profile retrieved
   */
  static nurseProfileRetrieved({nurse}) {
    return new AppResponse({
      message: 'Nurse profile retrieved successfully',
      statusCode: 200,
      body: {
        nurse: NursesResponsesFactories.formatNurse({
          nurseProfile: nurse,
        }),
        type: NURSE_SUCCESS_TYPES.nurseProfileRetrieved.value,
      },
    });
  }

  /**
   * Nurse-specific response: Nurse profile updated
   */
  static nurseProfileUpdated({nurse}) {
    return new AppResponse({
      message: 'Nurse profile updated successfully',
      statusCode: 200,
      body: {
        nurse: NursesResponsesFactories.formatNurse({
          nurseProfile: nurse,
        }),
        type: NURSE_SUCCESS_TYPES.nurseProfileUpdated.value,
      },
    });
  }

  /**
   * Nurse-specific response: Nurses list retrieved with pagination metadata
   */
  static nursesListRetrieved({nurses, meta, statsByUserId = new Map()}) {
    const data = nurses.map((n) =>
      NursesResponsesFactories.formatNurse({
        nurseProfile: n,
        stats: statsByUserId.get(n.userId) || null,
      })
    );

    return new AppResponse({
      message: 'Nurses list retrieved successfully',
      statusCode: 200,
      body: {
        nurses: data,
        meta,
        type: NURSE_SUCCESS_TYPES.nursesListRetrieved.value,
      },
    });
  }

  /**
   * Nurse-specific response: Nurse profile deleted
   * Kept as nurse-specific for consistency with nurse operations
   */
  static nurseProfileDeleted() {
    return new AppResponse({
      statusCode: 200,
      message: 'Nurse profile deleted successfully',
      body: {type: NURSE_SUCCESS_TYPES.nurseProfileDeleted.value},
    });
  }

  static nurseDashboardRetrieved({dashboard}) {
    return new AppResponse({
      message: 'Nurse dashboard retrieved successfully',
      statusCode: 200,
      body: {
        stats: dashboard.stats,
        myDay: dashboard.myDay,
        assessmentsSinceYesterday: dashboard.assessmentsSinceYesterday,
        type: NURSE_SUCCESS_TYPES.nurseDashboardRetrieved.value,
      },
    });
  }

  static nurseAdminStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Nurse admin stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: NURSE_SUCCESS_TYPES.nurseAdminStatsRetrieved.value,
      },
    });
  }
};
