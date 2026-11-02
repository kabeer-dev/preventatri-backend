const AppResponse = require('./app');

const {
  CAREGIVER_SUCCESS_TYPES,
} = require('../../constants/responses/success/caregivers');

const {isPlaceholderEmail} = require('../../utils/hhaExchange/caregiverMapper');

module.exports = class CaregiversResponsesFactories {
  /**
   * Internal helper to format caregiver object from database model
   * Centralizes the mapping from Prisma model to API response shape
   */
  static formatCaregiver({caregiverProfile, includeUser = true}) {
    const patients =
      caregiverProfile.caregiverPatients?.map((cp) => ({
        id: cp.patient?.id || cp.patientId,
        firstName: cp.patient?.firstName,
        lastName: cp.patient?.lastName,
        status: cp.patient?.status,
        assignedAt: cp.assignedAt,
      })) || [];

    const formatted = {
      profileId: caregiverProfile.id,
      archived: Boolean(caregiverProfile.isDeleted),
      caregiverId: caregiverProfile.userId,
      organizationId: caregiverProfile.organizationId,

      // Professional info
      role: caregiverProfile.role,
      status: caregiverProfile.status,

      // Optional fields
      relationshipToPatient: caregiverProfile.relationshipToPatient,
      preferredContactMethod: caregiverProfile.preferredContactMethod,
      language: caregiverProfile.language,
      notes: caregiverProfile.notes,
      startDate: caregiverProfile.startDate,
      terminationDate: caregiverProfile.terminationDate,
      onCallIndicator: caregiverProfile.onCallIndicator,

      // HHAeXchange provenance. The frontend greys out the managed fields on
      // an HHA_EXCHANGE caregiver, so `source` has to reach it. hhaSyncHash is
      // never exposed -- it is internal state and is not even in the model's
      // default field set.
      source: caregiverProfile.source,
      hhaCaregiverId: caregiverProfile.hhaCaregiverId,
      hhaLastSyncedAt: caregiverProfile.hhaLastSyncedAt,
      hhaModifiedDate: caregiverProfile.hhaModifiedDate,

      // Patients
      patients,
      assignedPatientCount: new Set(
        (caregiverProfile.checklistAssignments || []).map((a) => a.patientId)
      ).size,

      // Red flags
      redFlagCount: caregiverProfile.user?._count?.submissionFlags ?? 0,

      createdAt: caregiverProfile.createdAt,
      updatedAt: caregiverProfile.updatedAt,
    };

    // Include user info if available
    if (includeUser && caregiverProfile.user) {
      formatted.user = {
        id: caregiverProfile.user.id,
        firstName: caregiverProfile.user.firstName,
        lastName: caregiverProfile.user.lastName,
        email: caregiverProfile.user.email,
        phoneNo: caregiverProfile.user.phoneNo,

        // Address lives on the user row, not the profile -- CaregiverProfile is
        // a User satellite -- but it is a caregiver field to every caller.
        address: caregiverProfile.user.address,
        city: caregiverProfile.user.city,
        state: caregiverProfile.user.state,
        zipCode: caregiverProfile.user.zipCode,
        isVerified: caregiverProfile.user.isVerified,

        // Lets the UI offer the one email edit that is allowed: replacing the
        // synthetic address sync minted for a caregiver HHAeXchange had none
        // for. See updateCaregiver.
        isPlaceholderEmail: isPlaceholderEmail({
          email: caregiverProfile.user.email,
        }),
      };
    }

    return formatted;
  }

  static caregiverProfileRetrieved({caregiver}) {
    return new AppResponse({
      message: 'Caregiver profile retrieved successfully',
      statusCode: 200,
      body: {
        caregiver: CaregiversResponsesFactories.formatCaregiver({
          caregiverProfile: caregiver,
        }),
        type: CAREGIVER_SUCCESS_TYPES.caregiverProfileRetrieved.value,
      },
    });
  }

  static caregiverProfileUpdated({caregiver}) {
    return new AppResponse({
      message: 'Caregiver profile updated successfully',
      statusCode: 200,
      body: {
        caregiver: CaregiversResponsesFactories.formatCaregiver({
          caregiverProfile: caregiver,
        }),
        type: CAREGIVER_SUCCESS_TYPES.caregiverProfileUpdated.value,
      },
    });
  }

  static caregiversListRetrieved({caregivers, meta}) {
    return new AppResponse({
      message: 'Caregivers list retrieved successfully',
      statusCode: 200,
      body: {
        caregivers: caregivers.map((c) =>
          CaregiversResponsesFactories.formatCaregiver({
            caregiverProfile: c,
          })
        ),
        meta,
        type: CAREGIVER_SUCCESS_TYPES.caregiversListRetrieved.value,
      },
    });
  }

  static caregiverProfileDeleted() {
    return new AppResponse({
      statusCode: 200,
      message: 'Caregiver profile deleted successfully',
      body: {type: CAREGIVER_SUCCESS_TYPES.caregiverProfileDeleted.value},
    });
  }

  static caregiverStatisticsRetrieved({statistics}) {
    return new AppResponse({
      message: 'Caregiver statistics retrieved successfully',
      statusCode: 200,
      body: {
        statistics,
        type: CAREGIVER_SUCCESS_TYPES.caregiverStatisticsRetrieved.value,
      },
    });
  }

  static caregiverStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Caregiver stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: CAREGIVER_SUCCESS_TYPES.caregiverStatsRetrieved.value,
      },
    });
  }

  static caregiverAdminStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Caregiver admin stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: CAREGIVER_SUCCESS_TYPES.caregiverAdminStatsRetrieved.value,
      },
    });
  }

  static caregiverPatientsAssigned({caregiver}) {
    return new AppResponse({
      message: 'Patients assigned to caregiver successfully',
      statusCode: 200,
      body: {
        caregiver: CaregiversResponsesFactories.formatCaregiver({
          caregiverProfile: caregiver,
        }),
        type: CAREGIVER_SUCCESS_TYPES.caregiverPatientsAssigned.value,
      },
    });
  }
};
