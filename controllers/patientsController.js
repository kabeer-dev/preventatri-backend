const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');

const {
  PATIENTS_SORT_FIELDS,
  PATIENT_STATUSES,
  PATIENT_SOURCES,
} = require('../constants/patientsConstants');

const {
  GeneralErrorsFactories,
  PatientsErrorsFactories,
  PatientsResponsesFactories,
} = require('../factories');

const {
  PatientsServices,
  CountiesServices,
  CaregiversServices,
  AssessmentsServices,
  HhaSyncWorklistServices,
  NursesServices,
} = require('../services');

// Validate a patient's primary/secondary nurse selection.
// - Each nurse must be ACTIVE + verified (NursesServices.validateNurses).
// - Each nurse must cover the patient's region in the matching role
//   (PRIMARY nurse has NurseRegion role PRIMARY, etc.) — fetched in a
//   single bulk query via NursesServices.validateNurseRegionRoleAssignments.
// The "primary !== secondary" check is enforced upstream by the request
// validator (distinctPrimarySecondaryNursesTest in patientsSchema.js).
// Throws PatientsErrorsFactories.invalidNurseAssignmentErr on any failure.
async function validatePatientNurseAssignment({
  primaryNurseProfileId,
  secondaryNurseProfileId,
  regionId,
}) {
  if (!primaryNurseProfileId && !secondaryNurseProfileId) return;

  const idsToValidate = [primaryNurseProfileId, secondaryNurseProfileId].filter(
    Boolean
  );

  const {valid, reason} = await NursesServices.validateNurses({
    ids: idsToValidate,
  });

  if (!valid)
    throw PatientsErrorsFactories.invalidNurseAssignmentErr({
      customMessage: reason || 'Invalid nurse assignment',
    });

  const {valid: rolesValid, reason: rolesReason} =
    await NursesServices.validateNurseRegionRoleAssignments({
      assignments: [
        {
          nurseProfileId: primaryNurseProfileId,
          role: NURSE_REGION_ROLES.PRIMARY,
        },
        {
          nurseProfileId: secondaryNurseProfileId,
          role: NURSE_REGION_ROLES.SECONDARY,
        },
      ],
      regionId,
    });

  if (!rolesValid)
    throw PatientsErrorsFactories.invalidNurseAssignmentErr({
      customMessage: rolesReason,
    });
}

// An admin puts a case manager on an HHAeXchange patient (null clears it). A
// manual patient's case manager is set from the case manager's own roster.
async function pickPatientCaseManager({
  patient,
  isHhaPatient,
  caseManagerProfileId,
}) {
  if (!isHhaPatient) {
    throw PatientsErrorsFactories.invalidCaseManagerAssignmentErr({
      customMessage:
        "Assign this patient from the case manager's own patient list",
    });
  }

  const {success, isEligible} =
    await HhaSyncWorklistServices.pickPatientCaseManager({
      patient,
      caseManagerProfileId,
    });

  if (!isEligible) {
    throw PatientsErrorsFactories.invalidCaseManagerAssignmentErr({
      customMessage: 'Case manager is not active',
    });
  }

  if (!success) {
    throw GeneralErrorsFactories.internalErr({
      customMessage: 'Failed to update the case manager of this patient',
    });
  }
}

const {resolveCaregiverProfileId} = require('../utils/caregiverScopingUtils');

const {
  resolveCaseManagerProfileId,
} = require('../utils/caseManagerScopingUtils');

const {
  getListParams,
  buildOrderByClause,
  withIdTieBreaker,
  filterUndefined,
} = require('../utils/general');

const {
  assertHhaManagedFieldsNotEdited,
  resolvePatientHhaManagedFields,
} = require('../utils/hhaExchange/managedFieldsUtils');
const {resolveNurseScope} = require('../utils/nurseScopingUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

module.exports = class PatientsController {
  /**
   * Get patient dashboard stats
   * GET /patients/stats
   */
  static async getPatientStats(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {
      success,
      doc: stats,
      error,
    } = await PatientsServices.getPatientStats({
      organizationId,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve patient stats',
      });
    }

    return PatientsResponsesFactories.patientStatsRetrieved({stats});
  }

  /**
   * Create a patient
   * POST /patients
   */
  static async createPatient(req, res, next) {
    const {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      countyId,
      status = PATIENT_STATUSES.ACTIVE.value,
      address,
      city,
      state,
      zipCode,
      email,
      phoneNo,
      emergencyContact,
      medicaidId,
      diagnoses,
      notes,
      riskLevel,
      caregiverProfileIds,
      primaryNurseProfileId,
      secondaryNurseProfileId,
    } = req.body;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // Validate county exists before transaction
    const {success: countySuccess, doc: county} =
      await CountiesServices.getCountyById({id: countyId});

    if (!countySuccess || !county) {
      throw PatientsErrorsFactories.invalidCountyAssignmentErr({
        customMessage: 'County not found',
      });
    }

    // Validate nurse assignment: nurses must differ, must be active+verified,
    // and must cover this patient's region in the matching role.
    await validatePatientNurseAssignment({
      primaryNurseProfileId,
      secondaryNurseProfileId,
      regionId: county.regionId,
    });

    // Validate caregiver profile IDs if provided
    if (caregiverProfileIds && caregiverProfileIds.length > 0) {
      const {valid, invalidIds} =
        await CaregiversServices.validateCaregiverProfileIds({
          caregiverProfileIds,
        });

      if (!valid) {
        throw PatientsErrorsFactories.invalidCaregiverAssignmentErr({
          customMessage: `Invalid caregiver profile IDs: ${invalidIds.join(', ')}`,
        });
      }
    }

    // Create patient in transaction
    const createdPatient = await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {
          success: createSuccess,
          doc: patient,
          error: createError,
        } = await PatientsServices.createPatient({
          firstName,
          lastName,
          dateOfBirth,
          gender,
          countyId,
          organizationId,
          status,
          address,
          city,
          state,
          zipCode,
          email,
          phoneNo,
          emergencyContact,
          medicaidId,
          diagnoses,
          notes,
          riskLevel,
          primaryNurseProfileId,
          secondaryNurseProfileId,
          tx,
        });

        if (!createSuccess || createError) {
          throw (
            createError ||
            GeneralErrorsFactories.internalErr({
              customMessage: 'Failed to create patient',
            })
          );
        }

        // Assign caregivers if provided
        if (caregiverProfileIds && caregiverProfileIds.length > 0) {
          const {success: assignSuccess, error: assignError} =
            await PatientsServices.assignCaregiversToPatient({
              patientId: patient.id,
              caregiverProfileIds,
              organizationId,
              tx,
            });

          if (!assignSuccess || assignError) {
            throw (
              assignError ||
              GeneralErrorsFactories.internalErr({
                customMessage: 'Failed to assign caregivers to patient',
              })
            );
          }
        }

        return patient;
      },
    });

    // Response only needs the minimal fields (id, names), which the created
    // record already has — no need to re-fetch with relations.
    return PatientsResponsesFactories.patientCreated({patient: createdPatient});
  }

  /**
   * Get patient upcoming assessments for the next 7 days
   * GET /patients/:id/assessments
   */
  static async getPatientUpcomingAssessments(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;

    const caregiverProfileId = await resolveCaregiverProfileId({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {success, docs: submissions} =
      await AssessmentsServices.listPatientUpcomingAssessments({
        patientId: id,
        caregiverProfileId,
        caseManagerProfileId,
      });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch patient assessments',
      });
    }

    return PatientsResponsesFactories.patientUpcomingAssessmentsRetrieved({
      submissions,
    });
  }

  /**
   * Get patient details
   * GET /patients/:id
   */
  static async getPatient(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;

    const caregiverProfileId = await resolveCaregiverProfileId({token});
    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {success, doc: patient} =
      await PatientsServices.getPatientWithAssignments({
        id,
        caregiverProfileId,
        nurseScope,
        caseManagerProfileId,
      });

    if (!success || !patient) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    return PatientsResponsesFactories.patientRetrieved({patient});
  }

  /**
   * Get the patient's activity timeline, newest first, one page at a time
   * GET /patients/:id/timeline?page=&limit=
   */
  static async getPatientTimeline(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;
    const {page, limit, skip} = getListParams({req});

    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    // Same visibility rules as the details endpoint: a nurse or case manager
    // only reaches a patient in their scope. A caregiver never gets here (ACL).
    const {success: patientSuccess, doc: patient} =
      await PatientsServices.getPatientWithAssignments({
        id,
        nurseScope,
        caseManagerProfileId,
      });

    if (!patientSuccess || !patient) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    const {success, docs, count} = await PatientsServices.getPatientTimeline({
      patientId: id,
      limit,
      skip,
    });

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to load patient timeline',
      });
    }

    return PatientsResponsesFactories.patientTimelineRetrieved({
      entries: docs,
      meta: {page, limit, count, totalPages: Math.ceil(count / limit)},
    });
  }

  /**
   * Update patient
   * PATCH /patients/:id
   */
  static async updatePatient(req, res, next) {
    const {id} = req.params;

    const {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      countyId,
      status,
      address,
      city,
      state,
      zipCode,
      email,
      phoneNo,
      emergencyContact,
      medicaidId,
      diagnoses,
      notes,
      riskLevel,
      primaryNurseProfileId,
      secondaryNurseProfileId,
      caseManagerProfileId,
    } = req.body;

    // Get patient (include county to know the current regionId for nurse role checks)
    const {success, doc: patient} = await PatientsServices.getPatientById({
      id,
      options: {fieldsInclusion: {include: {county: true}}},
    });

    if (!success || !patient) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    const isHhaPatient = patient.source === PATIENT_SOURCES.HHA_EXCHANGE.value;

    // HHAeXchange owns the demographics, the primary nurse it names and (while
    // the ZIP resolves) the county; the sync would overwrite an edit, so it is refused.
    // In the controller, not Yup: the validator cannot see the patient's source.
    assertHhaManagedFieldsNotEdited({
      body: req.body,
      isHhaManaged: isHhaPatient,
      managedFields: resolvePatientHhaManagedFields({patient}),
    });

    // Build update data
    const updateData = filterUndefined({
      obj: {
        firstName,
        lastName,
        dateOfBirth,
        gender,
        status,
        address,
        city,
        state,
        zipCode,
        email,
        phoneNo,
        emergencyContact,
        medicaidId,
        diagnoses,
        notes,
        riskLevel,
        primaryNurseProfileId,
        secondaryNurseProfileId,
      },
    });

    // Resolve the regionId to validate nurse roles against:
    // - if the request changes countyId, use the new county's region
    // - otherwise use the patient's current county region
    let effectiveRegionId = patient.county?.regionId;

    // If countyId changes, validate it exists
    if (countyId !== undefined) {
      const {success: countySuccess, doc: county} =
        await CountiesServices.getCountyById({
          id: countyId,
        });

      if (!countySuccess || !county) {
        throw PatientsErrorsFactories.invalidCountyAssignmentErr({
          customMessage: 'County not found',
        });
      }

      updateData.countyId = countyId;
      effectiveRegionId = county.regionId;
    }

    // Determine which nurse IDs will be in effect after this update
    // (PATCH semantics: only fields explicitly sent are considered).
    const effectivePrimaryNurseId =
      primaryNurseProfileId !== undefined
        ? primaryNurseProfileId
        : patient.primaryNurseProfileId;

    const effectiveSecondaryNurseId =
      secondaryNurseProfileId !== undefined
        ? secondaryNurseProfileId
        : patient.secondaryNurseProfileId;

    // The nurse an admin puts on an HHA patient is theirs from then on, so the
    // sync asks before replacing it. A kept HHA nurse stays HHA's.
    const isPrimaryNurseChanged =
      primaryNurseProfileId !== undefined &&
      primaryNurseProfileId !== patient.primaryNurseProfileId;

    const isPrimaryNurseAdminPicked =
      isPrimaryNurseChanged || !patient.isPrimaryNurseHhaManaged;

    if (isHhaPatient && isPrimaryNurseChanged) {
      updateData.isPrimaryNurseHhaManaged = false;
    }

    if (
      primaryNurseProfileId !== undefined ||
      secondaryNurseProfileId !== undefined ||
      countyId !== undefined
    ) {
      if (
        effectivePrimaryNurseId != null &&
        effectiveSecondaryNurseId != null &&
        effectivePrimaryNurseId === effectiveSecondaryNurseId
      )
        throw PatientsErrorsFactories.invalidNurseAssignmentErr({
          customMessage: 'Primary and secondary nurse must be different',
        });

      // countyId is nullable since the HHAeXchange import (HHA supplies county
      // only as a free-text name, which may not match any County row). Region
      // is derived from county, so without one there is no region to validate
      // against — and passing `undefined` would be worse than useless: Prisma
      // DROPS an undefined filter, so the role lookup would match a nurse from
      // ANY region and quietly pass.
      //
      // HHAeXchange assigns its primary nurse regardless of region, so that
      // one is not checked; a primary an admin picked is.
      const validatedPrimaryNurseId =
        isHhaPatient && !isPrimaryNurseAdminPicked
          ? null
          : effectivePrimaryNurseId;

      // Only required when a nurse would actually remain assigned. CLEARING
      // the last nurse needs no region, and refusing it would strand a
      // county-less patient with a nurse nobody could remove.
      const hasRemainingNurseAssignment =
        validatedPrimaryNurseId != null || effectiveSecondaryNurseId != null;

      if (hasRemainingNurseAssignment && !effectiveRegionId) {
        throw PatientsErrorsFactories.missingCountyForNurseAssignmentErr();
      }

      await validatePatientNurseAssignment({
        primaryNurseProfileId: validatedPrimaryNurseId,
        secondaryNurseProfileId: effectiveSecondaryNurseId,
        regionId: effectiveRegionId,
      });
    }

    if (caseManagerProfileId !== undefined) {
      await pickPatientCaseManager({
        patient,
        isHhaPatient,
        caseManagerProfileId,
      });
    }

    const {success: updateSuccess, error: updateError} =
      await PatientsServices.updatePatient({id, updateData});

    if (!updateSuccess || updateError) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update patient',
      });
    }

    // Response only needs the minimal fields (id, names): apply the update on
    // top of the already-fetched patient instead of re-fetching it.
    return PatientsResponsesFactories.patientUpdated({
      patient: Object.assign({}, patient, updateData),
    });
  }

  /**
   * Delete (soft-delete) a patient
   * DELETE /patients/:id
   */
  static async deletePatient(req, res, next) {
    const {id} = req.params;

    const {success, doc: patient} = await PatientsServices.getPatientById({id});

    if (!success || !patient) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    const futureSubmissionStatuses = [
      CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
      CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
      CHECKLIST_SUBMISSION_STATUSES.LATE.value,
    ];

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {
          success: submissionsDeleteSuccess,
          error: submissionsDeleteError,
        } = await AssessmentsServices.deleteSubmissionsByPatient({
          patientId: id,
          statuses: futureSubmissionStatuses,
          tx,
        });

        if (!submissionsDeleteSuccess || submissionsDeleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete patient future assessments',
          });
        }

        const {success: deleteSuccess, error: deleteError} =
          await PatientsServices.deletePatient({id, tx});

        if (!deleteSuccess || deleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete patient',
          });
        }
      },
    });

    return PatientsResponsesFactories.patientDeleted();
  }

  /**
   * List patients in organization
   * GET /patients
   */
  static async listPatients(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {
      status,
      source,
      countyId,
      regionId,
      nurseProfileId,
      lastFlag,
      caregiverId,
      search,
      archiveFilter,
      view,
    } = req.query;

    const token = req.extra.jwtToken;

    const scopedCaregiverId =
      (await resolveCaregiverProfileId({token})) || caregiverId;

    const nurseScope = await resolveNurseScope({token});

    // Case managers are always scoped to their own patients via the token.
    // Admins may optionally narrow the list to a specific case manager's
    // patients by passing caseManagerProfileId in the query.
    const scopedCaseManagerProfileId = await resolveCaseManagerProfileId({
      token,
    });

    const caseManagerProfileId =
      scopedCaseManagerProfileId || req.query.caseManagerProfileId;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: PATIENTS_SORT_FIELDS,
    });

    const {
      success,
      docs: patients,
      error,
      count,
    } = await PatientsServices.listPatients({
      status,
      source,
      countyId,
      regionIds: regionId,
      nurseProfileIds: nurseProfileId,
      lastFlags: lastFlag,
      organizationId: token.user.currentActiveOrganization.organizationId,
      caregiverId: scopedCaregiverId,
      nurseScope,
      caseManagerProfileId,
      name: search,
      archiveFilter,
      skip,
      take: limit,
      sort: withIdTieBreaker({orderBy}),
      view,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch patients',
      });
    }

    return PatientsResponsesFactories.patientsListRetrieved({
      patients,
      view,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
