const {modelConstants} = require('../constants');

const {OPEN_ESCALATION_STATUSES} = require('../constants/escalationConstants');

const {
  AVERAGE_RESOLUTION_MINUTES_SQL,
} = require('../constants/escalationStatsSql');

const {ENTITY_STATUSES} = require('../constants/generalConstant');

const {PATIENT_IDS_BY_LAST_FLAG} = require('../constants/patientLastFlagSql');

const {
  PATIENT_STATUSES,
  PATIENT_ARCHIVE_FILTERS,
} = require('../constants/patientsConstants');

const {
  PATIENT_TIMELINE_PAGE_SQL,
  PATIENT_TIMELINE_COUNT_SQL,
} = require('../constants/patientTimelineSql');

const {
  ESCALATABLE_FLAGS,
  RISK_SCORE_THRESHOLDS,
} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
} = require('../constants/submissionFlagConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {PrismaFactory} = require('../factories');
const logger = require('../middleware/loggerMiddleware');

const {
  buildLiveAssignmentClause,
} = require('../utils/checklistAssignmentUtils');

const {
  buildSlaBreachQuery,
  getAlertStatsWindowStart,
} = require('../utils/escalationUtils');

const {
  buildNameSearchClause,
  filterUndefined,
  safeMerge,
} = require('../utils/general');

const {
  buildNursePatientScopeClause,
} = require('../utils/nursePatientScopeUtils');

const {
  computeNursePatientUnassignPlan,
} = require('../utils/nursePatientUnassignUtils');

const {
  assignedCaseManagerSelect,
  buildPatientsListViewFieldsInclusion,
  hhaCoordinatorsSelect,
  hhaPendingPeopleSelect,
} = require('../utils/patientUtils');
const {withMembershipDetails} = require('../utils/userUtils');

// A staff member's name is per organization, so it is read off the profile's
// membership and folded back onto `user` (see foldPatientStaffNames).
const staffNameSelect = {
  id: true,
  user: {select: {id: true}},
  userOrganization: {select: {firstName: true, lastName: true}},
};

// Default include for primary/secondary nurse on patient reads.
// Returns minimal user fields so the FE can render "First Last" without an extra fetch.
const patientNurseRelationsInclude = {
  primaryNurse: {select: staffNameSelect},
  secondaryNurse: {select: staffNameSelect},
};

// Puts the membership's name on the profile's `user`, keeping the old shape.
const foldStaffName = ({profile}) => {
  if (!profile?.userOrganization) return;

  profile.user = withMembershipDetails({
    user: profile.user,
    membership: profile.userOrganization,
  });
  delete profile.userOrganization;
};

const foldPatientStaffNames = ({patient}) => {
  if (!patient) return patient;

  foldStaffName({profile: patient.primaryNurse});
  foldStaffName({profile: patient.secondaryNurse});
  (patient.checklistAssignments || []).forEach((assignment) =>
    foldStaffName({profile: assignment.caregiverProfile})
  );

  return patient;
};

module.exports = class PatientsServices {
  /**
   * Get patient by ID
   */
  static async getPatientById({id, options = {}}) {
    try {
      const callerFieldsInclusion = options.fieldsInclusion || {};

      const fieldsInclusion = safeMerge({
        originalObj: callerFieldsInclusion,
        deep: true,
        newObj: {include: patientNurseRelationsInclude},
      });

      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id},
        options,
        fieldsInclusion,
      });

      foldPatientStaffNames({patient: result.doc});

      return result;
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Get patient by ID with checklist assignments included
   */
  static async getPatientWithAssignments({
    id,
    caregiverProfileId,
    nurseScope,
    caseManagerProfileId,
  }) {
    try {
      const query = {id};

      if (nurseScope) {
        Object.assign(query, buildNursePatientScopeClause({nurseScope}));
      }

      if (caregiverProfileId) {
        // Caregivers only reach a patient while an assignment of theirs is live.
        query.checklistAssignments = {
          some: Object.assign(
            {caregiverProfileId},
            buildLiveAssignmentClause()
          ),
        };
      }

      if (caseManagerProfileId) {
        query.caseManagerPatients = {
          some: {caseManagerProfileId},
        };
      }

      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PATIENT,
        query,

        // Detail view is read-only; allow viewing archived (soft-deleted) patients
        options: {includeDeleted: true},
        fieldsInclusion: {
          include: Object.assign(
            {},
            patientNurseRelationsInclude,
            assignedCaseManagerSelect,

            // Staff only: a caregiver has no use for HHA's coordinator list.
            caregiverProfileId ? {} : hhaCoordinatorsSelect,
            caregiverProfileId ? {} : hhaPendingPeopleSelect,
            {
              checklistAssignments: {
                where: caregiverProfileId
                  ? Object.assign(
                      {caregiverProfileId},
                      buildLiveAssignmentClause()
                    )
                  : {isDeleted: null},
                select: {
                  id: true,
                  startDate: true,
                  endDate: true,
                  type: true,
                  createdAt: true,
                  checklistTemplate: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                  caregiverProfile: {select: staffNameSelect},
                },
              },
            }
          ),
          exclude: [
            'createdAt',
            'updatedAt',
            'organizationId',
            'riskLevel',
            'notes',
          ],
        },
      });

      foldPatientStaffNames({patient: result.doc});

      return result;
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * One page of the patient's activity timeline, newest first, plus the total
   * entry count. Read-only; the caller has already verified access to the
   * patient (the SQL is keyed on the patient id alone).
   */
  static async getPatientTimeline({patientId, limit, skip}) {
    try {
      const [{docs, success, error}, countResult] = await Promise.all([
        PrismaFactory.aggregate({
          query: PATIENT_TIMELINE_PAGE_SQL({patientId, limit, skip}),
        }),
        PrismaFactory.aggregate({
          query: PATIENT_TIMELINE_COUNT_SQL({patientId}),
        }),
      ]);

      if (!success || !countResult.success) {
        return {
          success: false,
          docs: [],
          count: 0,
          error: error || countResult.error,
        };
      }

      return {
        success: true,
        docs,
        count: countResult.docs[0]?.count || 0,
        error: null,
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /**
   * Create a patient
   */
  static async createPatient({
    firstName,
    lastName,
    dateOfBirth,
    gender,
    countyId,
    organizationId,
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
    primaryNurseProfileId,
    secondaryNurseProfileId,
    tx,
  }) {
    try {
      const data = filterUndefined({
        obj: {
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
        },
      });

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.PATIENT,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Update a patient
   */
  static async updatePatient({id, updateData, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id},
        data: updateData,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Clear stale patient nurse assignments after a nurse's regions change.
   *
   * A patient's primary nurse must cover the patient's region with role PRIMARY
   * (and secondary with SECONDARY). When the nurse loses a region or has their
   * role there downgraded/swapped, patients pointing at that nurse in the now
   * un-covered role have the matching field nulled. Runs inside the caller's
   * transaction so it commits atomically with the region update.
   */
  static async unassignNurseFromMismatchedRegions({nurseProfileId, tx}) {
    try {
      // 1. Load the nurse's NEW region coverage -> Map<regionId, role>.
      const regionsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfileId},
        tx,
      });

      if (!regionsResult.success) {
        return {success: false, error: regionsResult.error};
      }

      const nurseRegionMap = new Map(
        (regionsResult.docs || []).map((region) => [
          region.regionId,
          region.nurseRegionRole,
        ])
      );

      // 2. Find patients currently assigned to this nurse (either role).
      const patientsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query: {
          OR: [
            {primaryNurseProfileId: nurseProfileId},
            {secondaryNurseProfileId: nurseProfileId},
          ],
        },
        fieldsInclusion: {
          include: {county: {select: {regionId: true}}},
        },
        tx,
      });

      if (!patientsResult.success) {
        return {success: false, error: patientsResult.error};
      }

      // 3. Decide which assignments are no longer valid (pure).
      const {primaryPatientIds, secondaryPatientIds} =
        computeNursePatientUnassignPlan({
          patients: patientsResult.docs || [],
          nurseProfileId,
          nurseRegionMap,
        });

      // 4. Null the stale assignments in two batched writes.
      if (primaryPatientIds.length > 0) {
        const {success, error} = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.PATIENT,

          // Re-assert the nurse is still the primary at write time so a
          // concurrent reassignment between the read and this write is never
          // clobbered (idempotent / concurrency-safe compare-and-swap).
          query: {
            id: {in: primaryPatientIds},
            primaryNurseProfileId: nurseProfileId,
          },
          data: {primaryNurseProfileId: null},
          tx,
        });

        if (!success) return {success: false, error};
      }

      if (secondaryPatientIds.length > 0) {
        const {success, error} = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.PATIENT,

          // Same compare-and-swap guard for the secondary role.
          query: {
            id: {in: secondaryPatientIds},
            secondaryNurseProfileId: nurseProfileId,
          },
          data: {secondaryNurseProfileId: null},
          tx,
        });

        if (!success) return {success: false, error};
      }

      return {success: true, error: null};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Soft delete a patient
   */
  static async deletePatient({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * List patients with filters
   */
  static async listPatients({
    status,
    source,
    nurseScope,
    countyId,
    regionIds,
    nurseProfileIds,
    lastFlags,
    organizationId,
    caregiverId,
    caseManagerProfileId,
    name,
    archiveFilter = PATIENT_ARCHIVE_FILTERS.ACTIVE.value,
    skip = 0,
    take = 25,
    sort = null,
    view,
    options = {},
  }) {
    try {
      // active   -> exclude soft-deleted (default soft-delete filter applies)
      // all      -> include soft-deleted alongside active
      // archived -> only soft-deleted patients
      const includeDeleted =
        archiveFilter === PATIENT_ARCHIVE_FILTERS.ALL.value ||
        archiveFilter === PATIENT_ARCHIVE_FILTERS.ARCHIVED.value;

      const query = {};

      if (archiveFilter === PATIENT_ARCHIVE_FILTERS.ARCHIVED.value) {
        query.isDeleted = {not: null};
      }

      if (status && status !== 'all') {
        query.status = status;
      }
      if (source?.length) {
        query.source = {in: source};
      }
      if (nurseScope) {
        Object.assign(query, buildNursePatientScopeClause({nurseScope}));
      }
      if (countyId) {
        query.countyId = countyId;
      }
      if (regionIds?.length) {
        query.county = {regionId: {in: regionIds}};
      }
      if (caregiverId) {
        // Caregivers only list patients with at least one live assignment.
        query.checklistAssignments = {
          some: Object.assign(
            {caregiverProfileId: caregiverId},
            buildLiveAssignmentClause()
          ),
        };
      }
      if (caseManagerProfileId) {
        query.caseManagerPatients = {
          some: {caseManagerProfileId},
        };
      }

      const nameClause = buildNameSearchClause({name});
      if (nameClause) {
        Object.assign(query, nameClause);
      }
      if (nurseProfileIds?.length) {
        query.AND = (query.AND || []).concat({
          OR: [
            {primaryNurseProfileId: {in: nurseProfileIds}},
            {secondaryNurseProfileId: {in: nurseProfileIds}},
          ],
        });
      }

      if (lastFlags?.length) {
        const lastFlagResult = await PrismaFactory.aggregate({
          query: PATIENT_IDS_BY_LAST_FLAG({
            organizationId,
            flags: lastFlags,
            caregiverId,
          }),
        });

        if (!lastFlagResult.success) {
          return {
            success: false,
            docs: [],
            error: lastFlagResult.error,
            count: 0,
          };
        }

        query.id = {in: lastFlagResult.docs.map((row) => row.id)};
      }

      const queryOptions = safeMerge({
        originalObj: {skip, take, includeDeleted},
        newObj: sort ? {sort} : {},
      });

      // Caregivers only see flags they submitted.
      const flagWhere = Object.assign(
        {isDeleted: null, status: {not: SUBMISSION_FLAG_STATUS.VOIDED}},
        caregiverId
          ? {submitter: {caregiverProfiles: {some: {id: caregiverId}}}}
          : {}
      );

      const redFlagCountSelect = {
        select: {
          submissionFlags: {
            where: Object.assign({}, flagWhere, {
              flag: RISK_SCORE_THRESHOLDS.RED.flag,
            }),
          },
        },
      };

      const lastFlagSelect = {
        submissionFlags: {
          where: Object.assign({}, flagWhere, {flag: {in: ESCALATABLE_FLAGS}}),
          orderBy: {createdAt: 'desc'},
          take: 1,
          select: {flag: true},
        },
      };

      // When a list "view" is requested, select only that view's fields
      // (from PATIENTS_LIST_API_FIELDS_OPTIONS).
      const fieldsInclusion = view
        ? buildPatientsListViewFieldsInclusion({view, lastFlagSelect})
        : safeMerge({
            originalObj: options.fieldsInclusion || {},
            deep: true,
            newObj: {
              include: Object.assign({}, patientNurseRelationsInclude, {
                _count: redFlagCountSelect,
              }),
            },
          });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion,
      });

      (result.docs || []).forEach((patient) =>
        foldPatientStaffNames({patient})
      );

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.PATIENT,
        query,
        options: {includeDeleted},
      });

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.success ? countResult.count : 0},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  // ==========================================
  // PATIENT-CAREGIVER ASSIGNMENT METHODS
  // ==========================================

  /**
   * Assign caregivers to a patient (replaces all existing assignments)
   * Delegates to the shared CaregiverPatient logic in CaregiversServices
   */
  static async assignCaregiversToPatient({
    patientId,
    caregiverProfileIds,
    organizationId,
    tx,
  }) {
    // Lazy-require to avoid circular dependency
    const CaregiversServices = require('./caregiversServices');

    return CaregiversServices.assignCaregiverPatients({
      deleteQuery: {patientId},
      assignments: caregiverProfileIds.map((caregiverProfileId) => ({
        caregiverProfileId,
        patientId,
        organizationId,
      })),
      tx,
    });
  }

  /**
   * Find a live checklist assignment linking this user (as caregiver) to the
   * patient. Returns no doc once every assignment has ended (grace window
   * included) or has yet to start — which is what gates the red flag.
   */
  static async getAssignment({userId, patientId}) {
    try {
      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query: Object.assign(
          {patientId, caregiverProfile: {userId}},
          buildLiveAssignmentClause()
        ),
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * User ids of the active caregivers with a live checklist assignment to the
   * patient (the getAssignment bar). `userIds` narrows the lookup.
   *
   * @returns {Promise<{success, userIds, error}>}
   */
  static async getLiveCaregiverUserIds({
    patientId,
    organizationId,
    userIds,
    tx,
  }) {
    try {
      const caregiverProfile = {
        status: ENTITY_STATUSES.ACTIVE.value,
        isDeleted: null,
      };

      if (userIds) caregiverProfile.userId = {in: userIds};

      const {success, docs, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query: Object.assign(
          {patientId, organizationId, caregiverProfile},
          buildLiveAssignmentClause()
        ),
        fieldsInclusion: {
          include: {caregiverProfile: {select: {userId: true}}},
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!success) return {success: false, userIds: [], error};

      return {
        success: true,
        userIds: Array.from(
          new Set(
            docs
              .map((assignment) => assignment.caregiverProfile?.userId)
              .filter(Boolean)
          )
        ),
      };
    } catch (error) {
      return {success: false, userIds: [], error};
    }
  }

  /**
   * Drops caregiver recipients without a live assignment to the patient; staff
   * pass through. A failed assignment lookup drops only the caregivers.
   *
   * @returns {Promise<string[]>}
   */
  static async filterRecipientsByPatientAccess({
    recipientIds,
    patientId,
    organizationId,
  }) {
    const uniqueRecipientIds = Array.from(
      new Set((recipientIds || []).filter(Boolean))
    );

    if (!patientId || uniqueRecipientIds.length === 0)
      return uniqueRecipientIds;

    const logFailure = ({error}) =>
      logger.error(
        `[Patients] failed to check caregiver access to patient ${patientId}: ${error?.message || error}`
      );

    const findCaregiverOrgs = async () => {
      try {
        return await PrismaFactory.find({
          model: modelConstants.MODELS.USER_ORGANIZATION,
          query: {
            userId: {in: uniqueRecipientIds},
            organizationId,
            role: SYSTEM_ROLES.caregiver.value,
          },
          options: {bypassExtraQueries: true},
        });
      } catch (error) {
        return {success: false, docs: [], error};
      }
    };

    let caregiverOrgs = await findCaregiverOrgs();
    if (!caregiverOrgs.success) caregiverOrgs = await findCaregiverOrgs();

    // Without roles caregivers can't be told apart from staff, so nobody is notified.
    if (!caregiverOrgs.success) {
      logFailure({error: caregiverOrgs.error});

      return [];
    }

    const caregivers = new Set(caregiverOrgs.docs.map((doc) => doc.userId));

    if (caregivers.size === 0) return uniqueRecipientIds;

    const live = await PatientsServices.getLiveCaregiverUserIds({
      patientId,
      organizationId,
      userIds: Array.from(caregivers),
    });

    if (!live.success) logFailure({error: live.error});

    // userIds is [] on failure, so only the caregivers are dropped.
    const withAccess = new Set(live.userIds);

    return uniqueRecipientIds.filter(
      (userId) => !caregivers.has(userId) || withAccess.has(userId)
    );
  }

  static async validatePatientIds({patientIds}) {
    try {
      const {success, docs: patients} = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query: {id: {in: patientIds}},
      });

      if (!success) {
        return {
          valid: false,
          invalidIds: patientIds,
        };
      }

      const validIds = new Set(patients.map((p) => p.id));
      const invalidIds = patientIds.filter((id) => !validIds.has(id));

      return {
        valid: invalidIds.length === 0,
        invalidIds,
      };
    } catch (error) {
      return {valid: false, invalidIds: patientIds, error};
    }
  }

  static async getPatientStats({organizationId}) {
    try {
      // "Active" red/yellow flags are those whose escalation is still open
      // (ACTIVE or accepted, i.e. not resolved/failed/expired/voided). Green flags never escalate,
      // so they're counted outright. All tallies are all-time totals — no
      // trailing-window filter, unlike the admin dashboard.
      const flagBaseQuery = {organizationId, isDeleted: null};

      const activeEscalation = {
        escalation: {status: {in: OPEN_ESCALATION_STATUSES}},
      };

      // Single source of truth: every response key maps to exactly one count
      // query, so the parallel dispatch and the result assembly can't desync.
      const countQueries = {
        activeRedFlags: {
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: Object.assign({}, flagBaseQuery, activeEscalation, {
            flag: RISK_SCORE_THRESHOLDS.RED.flag,
          }),
        },
        activeYellowFlags: {
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: Object.assign({}, flagBaseQuery, activeEscalation, {
            flag: RISK_SCORE_THRESHOLDS.YELLOW.flag,
          }),
        },
        greenFlags: {
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query: Object.assign({}, flagBaseQuery, {
            flag: RISK_SCORE_THRESHOLDS.GREEN.flag,
          }),
        },
        slaBreaches: {
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
          query: buildSlaBreachQuery({organizationId}),
          options: {bypassExtraQueries: true},
        },
      };

      const metrics = Object.keys(countQueries);

      const [results, averageResult] = await Promise.all([
        Promise.all(
          metrics.map((metric) =>
            PrismaFactory.countDocuments(countQueries[metric])
          )
        ),
        PrismaFactory.aggregate({
          query: AVERAGE_RESOLUTION_MINUTES_SQL({
            organizationId,
            since: getAlertStatsWindowStart(),
          }),
        }),
      ]);

      const failed = results
        .concat(averageResult)
        .find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const doc = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );

      const [averageRow] = averageResult.docs || [];
      doc.averageResolutionMinutes = averageRow?.avg_minutes ?? null;

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async resolvePatientName({patientId}) {
    try {
      const {doc: patient} = await PatientsServices.getPatientById({
        id: patientId,
      });

      return patient
        ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim()
        : '';
    } catch (error) {
      return '';
    }
  }
};
