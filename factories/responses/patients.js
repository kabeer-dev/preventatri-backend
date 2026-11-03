const AppResponse = require('./app');

const {
  PATIENTS_LIST_API_FIELDS_OPTIONS,
} = require('../../constants/patientsConstants');

const {
  PATIENT_SUCCESS_TYPES,
} = require('../../constants/responses/success/patients');

const {
  formatAssignedCaregivers,
  formatAssignedCaseManager,
  formatHhaCoordinators,
  formatPatientsListView,
  formatPendingPerson,
} = require('../../utils/patientUtils');
const {withMembershipDetails} = require('../../utils/userUtils');

module.exports = class PatientsResponsesFactories {
  /**
   * Internal helper to format patient object from database model
   * Centralizes the mapping from Prisma model to API response shape
   */
  static formatPatient({patient}) {
    const caregivers =
      patient.caregiverPatients?.map((cp) => {
        // Name and phone are per organization: they come from the profile's
        // membership.
        const user = withMembershipDetails({
          user: cp.caregiverProfile?.user,
          membership: cp.caregiverProfile?.userOrganization,
        });

        return {
          profileId: cp.caregiverProfile?.id || cp.caregiverProfileId,
          role: cp.caregiverProfile?.role,
          status: cp.caregiverProfile?.status,
          assignedAt: cp.assignedAt,
          user: user
            ? {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNo: user.phoneNo,
              }
            : null,
        };
      }) || [];

    const formatNurseRef = ({nurse}) =>
      nurse
        ? {
            id: nurse.id,
            user: nurse.user
              ? {
                  id: nurse.user.id,
                  firstName: nurse.user.firstName,
                  lastName: nurse.user.lastName,
                }
              : null,
          }
        : null;

    return {
      id: patient.id,
      organizationId: patient.organizationId,

      // Personal info
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,

      // Location
      county: patient.county
        ? {
            id: patient.county.id,
            name: patient.county.name,
          }
        : null,
      region: patient.county?.region
        ? {
            id: patient.county.region.id,
            name: patient.county.region.name,
            code: patient.county.region.code,
          }
        : null,

      // Address
      address: patient.address,
      city: patient.city,
      state: patient.state,
      zipCode: patient.zipCode,

      // Contact
      email: patient.email,
      phoneNo: patient.phoneNo,
      emergencyContact: patient.emergencyContact,

      // Medical
      medicaidId: patient.medicaidId,
      diagnoses: patient.diagnoses,
      riskLevel: patient.riskLevel,
      notes: patient.notes,

      // Status
      status: patient.status,

      // Provenance. The frontend maps `source` to a label and colour; the
      // backend returns the raw enum value only. hhaSyncHash is never exposed.
      source: patient.source,
      hhaPatientId: patient.hhaPatientId || null,
      hhaLastSyncedAt: patient.hhaLastSyncedAt || null,
      isCountyHhaManaged: Boolean(patient.isCountyHhaManaged),
      isPrimaryNurseHhaManaged: Boolean(patient.isPrimaryNurseHhaManaged),
      isCaseManagerHhaManaged: Boolean(patient.isCaseManagerHhaManaged),

      // Who HHAeXchange names but cannot be linked yet (detail view only).
      hhaPendingNurse: formatPendingPerson({profile: patient.hhaPendingNurse}),
      hhaPendingCaseManager: formatPendingPerson({
        profile: patient.hhaPendingCaseManager,
      }),

      // Soft-delete (archive) state. isDeleted holds the deletion timestamp
      // (null when active); archived is the derived boolean for the FE.
      deletedAt: patient.isDeleted || null,
      archived: Boolean(patient.isDeleted),

      // Nurse assignment (per-patient primary/secondary).
      // Prisma `select` on the relation may not surface the scalar FK; fall
      // back to the related object's id so the FE can preselect the dropdowns.
      primaryNurseProfileId:
        patient.primaryNurseProfileId || patient.primaryNurse?.id || null,
      secondaryNurseProfileId:
        patient.secondaryNurseProfileId || patient.secondaryNurse?.id || null,
      primaryNurse: formatNurseRef({nurse: patient.primaryNurse}),
      secondaryNurse: formatNurseRef({nurse: patient.secondaryNurse}),

      // Present only when the query loaded them (the detail view does).
      caseManager: formatAssignedCaseManager({patient}),
      hhaCoordinators: formatHhaCoordinators({patient}),
      hhaSelectedCaseManagerProfileId:
        patient.hhaSelectedCaseManagerProfileId || null,
      assignedCaregivers: formatAssignedCaregivers({patient}),

      // Caregivers
      caregivers,
      caregiverCount: caregivers.length,

      // Red flags
      redFlagCount: patient._count?.submissionFlags ?? 0,

      // Assignments
      checklistAssignments: patient.checklistAssignments || [],

      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }

  static patientCreated({patient}) {
    return new AppResponse({
      message: 'Patient created successfully',
      statusCode: 201,
      body: {
        patient: formatPatientsListView({
          patients: [patient],
          view: PATIENTS_LIST_API_FIELDS_OPTIONS.minimal.value,
        })[0],
        type: PATIENT_SUCCESS_TYPES.patientCreated.value,
      },
    });
  }

  static patientRetrieved({patient}) {
    return new AppResponse({
      message: 'Patient retrieved successfully',
      statusCode: 200,
      body: {
        patient: PatientsResponsesFactories.formatPatient({patient}),
        type: PATIENT_SUCCESS_TYPES.patientRetrieved.value,
      },
    });
  }

  static patientUpdated({patient}) {
    return new AppResponse({
      message: 'Patient updated successfully',
      statusCode: 200,
      body: {
        patient: formatPatientsListView({
          patients: [patient],
          view: PATIENTS_LIST_API_FIELDS_OPTIONS.minimal.value,
        })[0],
        type: PATIENT_SUCCESS_TYPES.patientUpdated.value,
      },
    });
  }

  static patientsListRetrieved({patients, meta, view}) {
    // When a list view is requested (e.g. view=minimal), return only its fields.
    const formattedPatients = view
      ? formatPatientsListView({patients, view})
      : patients.map((p) =>
          PatientsResponsesFactories.formatPatient({patient: p})
        );

    return new AppResponse({
      message: 'Patients list retrieved successfully',
      statusCode: 200,
      body: {
        patients: formattedPatients,
        meta,
        type: PATIENT_SUCCESS_TYPES.patientsListRetrieved.value,
      },
    });
  }

  static patientTimelineRetrieved({entries, meta}) {
    return new AppResponse({
      message: 'Patient timeline retrieved successfully',
      statusCode: 200,
      body: {
        timeline: entries.map((entry) => {
          const formatted = {
            type: entry.type,
            at: entry.at,
            user:
              entry.firstName || entry.lastName
                ? {firstName: entry.firstName, lastName: entry.lastName}
                : null,
            notes: entry.notes,
            refId: entry.refId,
          };

          // Flag colour is present only on FLAG_* entries.
          if (entry.flag) formatted.flag = entry.flag;

          return formatted;
        }),
        meta,
        type: PATIENT_SUCCESS_TYPES.patientTimelineRetrieved.value,
      },
    });
  }

  static patientUpcomingAssessmentsRetrieved({submissions}) {
    return new AppResponse({
      message: 'Patient upcoming assessments retrieved successfully',
      statusCode: 200,
      body: {
        submissions,
        type: PATIENT_SUCCESS_TYPES.patientUpcomingAssessmentsRetrieved.value,
      },
    });
  }

  static patientDeleted() {
    return new AppResponse({
      statusCode: 200,
      message: 'Patient deleted successfully',
      body: {type: PATIENT_SUCCESS_TYPES.patientDeleted.value},
    });
  }

  static patientStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Patient stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: PATIENT_SUCCESS_TYPES.patientStatsRetrieved.value,
      },
    });
  }
};
