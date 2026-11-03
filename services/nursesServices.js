const FollowUpTasksServices = require('./followUpTasksServices');
const OrganizationsServices = require('./organizationsServices');
const PatientsServices = require('./patientsServices');
const RegionsServices = require('./regionsServices');
const SupervisoryVisitsServices = require('./supervisoryVisitsServices');
const {modelConstants} = require('../constants');

const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {
  ESCALATION_ACTIONS,
  NURSE_ESCALATION_LEVELS_VALUES,
  OPEN_ESCALATION_STATUSES,
} = require('../constants/escalationConstants');

const {ENTITY_STATUSES} = require('../constants/generalConstant');

const {
  NURSE_REGION_ROLES,
  NURSE_DEFAULT_LICENSE_STATE,
  NURSE_DASHBOARD_ITEM_TYPES,
  NURSE_DASHBOARD_SUBMITTED_STATUSES,
  NURSE_DASHBOARD_DUE_TIME_FORMAT,
} = require('../constants/nursesConstants');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_OPEN_STATUSES,
} = require('../constants/submissionFlagConstants');

const {
  NURSE_RESPONSE_TIME_BY_ASSIGNEE_SQL,
} = require('../constants/usersConstants');
const {PrismaFactory, NursesErrorsFactories} = require('../factories');
const EscalationAssignmentHelpers = require('../helpers/escalationAssignmentHelpers');

const {
  buildDateRangeClause,
  formatInZone,
  getCurrentTime,
  getDaysFromNow,
} = require('../utils/dateUtils');

const {
  buildNameSearchClause,
  calculateAverage,
  safeMerge,
} = require('../utils/general');

const {
  buildNursePatientScopeClause,
} = require('../utils/nursePatientScopeUtils');
const {computeRoleAssignmentPlan} = require('../utils/nurseRegionUtils');

module.exports = class NursesServices {
  /**
   * Validate that every given NurseProfile id references a nurse that is
   * ACTIVE and whose user is verified. Fetches all nurses in a single query.
   * Returns {valid: true} on success, otherwise {valid: false, reason}.
   */
  static async validateNurses({ids}) {
    if (!ids || ids.length === 0) {
      return {valid: true};
    }

    const {success, docs, error} = await PrismaFactory.find({
      model: modelConstants.MODELS.NURSE_PROFILE,
      query: {id: {in: ids}},
      fieldsInclusion: {
        include: {user: {select: {id: true, isVerified: true}}},
      },
    });

    if (!success) return {valid: false, reason: 'Lookup failed', error};

    if ((docs || []).length !== ids.length)
      return {valid: false, reason: 'Nurse not found'};

    for (const nurse of docs) {
      if (nurse.status !== ENTITY_STATUSES.ACTIVE.value)
        return {valid: false, reason: 'Nurse is not active'};

      if (!nurse.user || nurse.user.isVerified !== true)
        return {valid: false, reason: 'Nurse user is not verified'};
    }

    return {valid: true};
  }

  /**
   * Get total patient count assigned to a nurse based on their covered regions
   */
  static async getNursePatientCount({nurseProfileId, organizationId}) {
    try {
      // 1. Get region IDs assigned to this nurse
      const nurseRegionsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfileId, organizationId},
      });

      if (!nurseRegionsResult.success) {
        return {success: false, count: 0, error: nurseRegionsResult.error};
      }

      if (nurseRegionsResult.docs.length === 0) {
        return {success: true, count: 0};
      }

      const regionIds = nurseRegionsResult.docs.map((nr) => nr.regionId);

      // 2. Count patients whose county belongs to these regions
      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.PATIENT,
        query: {
          county: {
            regionId: {in: regionIds},
          },
          organizationId,
          isDeleted: null,
        },
      });

      return countResult;
    } catch (error) {
      return {success: false, count: 0, error};
    }
  }

  /**
   * Get the nurse profile a user holds, optionally narrowed (e.g. by source).
   * Mirrors CaregiversServices.getCaregiverProfileByUser for the self-service
   * HHAeXchange-managed-field guard in usersController.updateProfile.
   */
  static async getNurseProfileByUser({userId, additionalFilters} = {}) {
    try {
      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: Object.assign({userId}, additionalFilters),
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Get nurse profile by ID
   */
  static async getNurseProfileById({id, options = {}}) {
    try {
      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: {id},
        options,
        fieldsInclusion: options.fieldsInclusion,
      });

      return result;
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Create nurse profile with all required fields
   */
  static async createNurseProfile({
    userId,
    organizationId,
    professionalRole,
    licenseNumber,
    licenseState = NURSE_DEFAULT_LICENSE_STATE,
    licenseExpirationDate,
    status = ENTITY_STATUSES.ACTIVE.value,
    npi,
    onCallIndicator = false,
    preferredContactMethod,
    notes,
    joiningDate,

    // HHAeXchange provenance. Only the sync engine passes these; the invite
    // flow leaves them undefined and they are dropped below, so the row keeps
    // the MANUAL default and a NULL hhaNurseId -- which is exactly what
    // nurse_profiles_hha_identity_check requires.
    source,
    hhaNurseId,
    hhaSyncHash,
    hhaLastSyncedAt,
    hhaModifiedDate,
    tx,
  }) {
    try {
      const data = {
        userId,
        organizationId,
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
        source,
        hhaNurseId,
        hhaSyncHash,
        hhaLastSyncedAt,
        hhaModifiedDate,
      };

      // Remove undefined values
      Object.keys(data).forEach((key) => {
        if (data[key] === undefined) {
          delete data[key];
        }
      });

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.NURSE_PROFILE,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Update nurse profile
   */
  static async updateNurseProfile({id, updateData, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
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
   * Soft delete nurse profile
   */
  static async deleteNurseProfile({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Take an archived nurse off every patient's primary and secondary slot.
   * Escalation never pages an archived nurse, so a kept link silently sent
   * flags to the region nurse while the patient still showed this one.
   */
  static async releaseNursePatients({nurseProfileId, tx}) {
    const release = ({field, data}) =>
      PrismaFactory.updateMany({
        model: modelConstants.MODELS.PATIENT,
        query: {[field]: nurseProfileId},
        data,
        options: {bypassExtraQueries: true, includeDeleted: true},
        tx,
      });

    // An HHA-managed slot is freed too: the admin may pick, the next sync decides.
    const primary = await release({
      field: 'primaryNurseProfileId',
      data: {primaryNurseProfileId: null, isPrimaryNurseHhaManaged: false},
    });

    if (!primary.success) return {success: false, error: primary.error};

    const secondary = await release({
      field: 'secondaryNurseProfileId',
      data: {secondaryNurseProfileId: null},
    });

    return {success: secondary.success, error: secondary.error};
  }

  /**
   * Get list of nurse profiles with filters (organization-scoped)
   * NOTE: organizationId is automatically scoped via request context
   */
  static async listNurseProfiles({
    status,
    regionId,
    nurseRegionRole,
    isVerified,
    name,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};

      if (status && status !== 'all') {
        query.status = status;
      }

      // If filtering by region, we need to filter through nurseRegions.
      // When `nurseRegionRole` is also provided, narrow to nurses whose role
      // for the given region matches (PRIMARY or SECONDARY).
      if (regionId) {
        const nurseRegionsSome = {regionId};

        if (nurseRegionRole) {
          nurseRegionsSome.nurseRegionRole = nurseRegionRole;
        }

        query.regionalNurses = {some: nurseRegionsSome};
      }

      // Filter by linked User.isVerified — used by region modal to surface only
      // verified nurses as primary/secondary candidates.
      if (isVerified !== undefined) {
        query.user = Object.assign({}, query.user, {isVerified});
      }

      const nameClause = buildNameSearchClause({
        name,
        fields: ['userOrganization.firstName', 'userOrganization.lastName'],
      });
      if (nameClause) {
        Object.assign(query, nameClause);
      }

      // Build options with pagination and sorting using safeMerge
      const queryOptions = safeMerge({
        originalObj: {
          skip,
          take,
        },
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion,
      });

      // Fetch count for pagination
      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query,
      });

      return safeMerge({
        originalObj: result,
        newObj: {
          count: countResult.success ? countResult.count : 0,
        },
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  /**
   * Per-nurse alert workload + all-time average response, for the ASSIGNED ALERTS
   * and AVG RESP TIME columns on the nurses list. Batched for one page of nurses:
   * three queries total (membership resolution, then the two metric queries in
   * parallel) — a constant, never one per nurse.
   *
   * • assignedAlerts / highAlerts — ACTIVE escalations currently assigned to the
   *   nurse (RED-flagged subset for "high"). This is present workload, NOT the
   *   historical times-paged that getNurseAdminStats' averageAlertsPerNurse
   *   counts — the two intentionally measure different things.
   * • avgRespTimeSeconds — mean assigned_at → ended_at across the nurse's RESOLVED
   *   nurse-level events, all-time. null when they have never resolved one; the
   *   client renders that as a placeholder rather than a fast/slow judgment.
   *
   * Identity note: escalations key on UserOrganization.id while the nurse list
   * keys on NurseProfile.userId, so callers pass userIds and this resolves the
   * mapping. Keyed by userId on the way out to match what formatNurse exposes.
   *
   * Every requested userId is present in the returned map, so the list response
   * carries the three fields for every nurse — including one with no active
   * membership (invited, never accepted), who reads as an explicit 0/0/null
   * rather than a hole the client has to paper over.
   */
  static async getNurseAlertStatsByUserIds({userIds = [], organizationId}) {
    try {
      // Seeded up front so every early return below still answers for each nurse.
      const statsByUserId = NursesServices.buildDefaultNurseAlertStats({
        userIds,
      });

      if (userIds.length === 0) {
        return {success: true, statsByUserId};
      }

      const {
        success: userOrgsSuccess,
        docs: userOrgs = [],
        error: userOrgsError,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId: {in: userIds}, organizationId, isActive: true},
        fieldsInclusion: {includeSpecificFields: ['id', 'userId']},
        options: {bypassExtraQueries: true},
      });

      if (!userOrgsSuccess) {
        return {success: false, statsByUserId, error: userOrgsError};
      }

      // Carrying both ids per candidate *is* the bidirectional map — UserOrganization
      // is unique per (user, organization), so each userOrgId folds back to exactly
      // one userId. It is also the shape buildNurseLoadMap expects.
      const candidates = userOrgs.map((userOrg) => ({
        userOrgId: userOrg.id,
        userId: userOrg.userId,
      }));

      const userOrgIds = candidates.map((candidate) => candidate.userOrgId);

      // Nobody on this page has an active membership (e.g. all invited but never
      // accepted) — return the seeded defaults, since Prisma.join([]) in the SQL
      // below throws on an empty list.
      if (userOrgIds.length === 0) {
        return {success: true, statsByUserId};
      }

      const [escalationsResult, respTimeResult] = await Promise.all([
        PrismaFactory.find({
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
          query: {
            status: {in: OPEN_ESCALATION_STATUSES},
            currentAssigneeId: {in: userOrgIds},
          },
          fieldsInclusion: {include: {submissionFlag: {select: {flag: true}}}},
          options: {bypassExtraQueries: true},
        }),
        PrismaFactory.aggregate({
          query: NURSE_RESPONSE_TIME_BY_ASSIGNEE_SQL({
            resolvedAction: ESCALATION_ACTIONS.RESOLVED.value,
            nurseLevels: NURSE_ESCALATION_LEVELS_VALUES,
            userOrgIds,
          }),
        }),
      ]);

      if (!escalationsResult.success) {
        return {
          success: false,
          statsByUserId,
          error: escalationsResult.error,
        };
      }

      if (!respTimeResult.success) {
        return {
          success: false,
          statsByUserId,
          error: respTimeResult.error,
        };
      }

      const loadByUserOrgId = EscalationAssignmentHelpers.buildNurseLoadMap({
        candidates,
        activeEscalations: escalationsResult.docs || [],
      });

      // calculateAverage is deliberately not used here: AVG() already averaged in
      // the database, and it would return 0 for an empty population where this
      // metric must stay null ("never resolved one" is not "resolves instantly").
      const avgByUserOrgId = new Map(
        (respTimeResult.docs || []).map((row) => [
          row.assignee_id,
          row.avg_seconds === null || row.avg_seconds === undefined
            ? null
            : Math.round(Number(row.avg_seconds)),
        ])
      );

      // Overwrite the seeded default for each candidate that has a membership;
      // nurses without one keep their 0/0/null seed.
      candidates.forEach((candidate) => {
        const load = loadByUserOrgId.get(candidate.userOrgId);

        statsByUserId.set(candidate.userId, {
          assignedAlerts: load?.activeCount || 0,
          highAlerts: load?.redCount || 0,
          avgRespTimeSeconds: avgByUserOrgId.get(candidate.userOrgId) ?? null,
        });
      });

      return {success: true, statsByUserId};
    } catch (error) {
      return {
        success: false,
        statsByUserId: NursesServices.buildDefaultNurseAlertStats({userIds}),
        error,
      };
    }
  }

  /**
   * Seed a userId → {assignedAlerts, highAlerts, avgRespTimeSeconds} map with the
   * zero/null defaults, so getNurseAlertStatsByUserIds can answer for every
   * requested nurse — including those with no active membership — and every early
   * return still carries a full set of rows.
   */
  static buildDefaultNurseAlertStats({userIds = []}) {
    return new Map(
      userIds.map((userId) => [
        userId,
        {assignedAlerts: 0, highAlerts: 0, avgRespTimeSeconds: null},
      ])
    );
  }

  // ==========================================
  // NURSE REGION ASSIGNMENT METHODS
  // ==========================================

  /**
   * Validate that the provided primary/secondary region IDs exist in the DB.
   * Overlap is enforced upstream by the Yup request validator.
   * Returns { valid: boolean, error: Error|null }
   */
  static async validateRegionAssignment({
    primaryRegionIds,
    secondaryRegionIds,
  }) {
    const allRegionIds = (primaryRegionIds || []).concat(
      secondaryRegionIds || []
    );

    if (allRegionIds.length > 0) {
      const {valid: regionsValid, error: regionValidationError} =
        await RegionsServices.validateRegionIds({regionIds: allRegionIds});

      if (!regionsValid) {
        return {
          valid: false,
          error: NursesErrorsFactories.invalidRegionAssignmentErr({
            customMessage: regionValidationError?.message,
          }),
        };
      }
    }

    return {valid: true, error: null};
  }

  /**
   * Build the nurse-region assignment plan (toDelete/toCreate/toUpdate) for the
   * requested primary/secondary region IDs against the nurse's current rows, and
   * report whether it changes anything. Reuses computeRoleAssignmentPlan so
   * PATCH semantics (undefined role = untouched) match assignNurseToRegions.
   * Returns { success, plan, error } where `plan` is null when the request would
   * not change anything, otherwise the {toDelete, toCreate, toUpdate} object that
   * can be handed to assignNurseToRegions to apply it without re-loading the rows.
   */
  static async buildRegionAssignmentPlan({
    nurseProfileId,
    organizationId,
    primaryRegionIds,
    secondaryRegionIds,
    tx,
  }) {
    try {
      const currentRegionsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfileId, organizationId},
        tx,
      });

      if (!currentRegionsResult.success) {
        return {success: false, plan: null, error: currentRegionsResult.error};
      }

      const plan = computeRoleAssignmentPlan({
        currentRows: currentRegionsResult.docs || [],
        keyField: 'regionId',
        primaryIds: primaryRegionIds,
        secondaryIds: secondaryRegionIds,
      });

      const hasChanges =
        plan.toDelete.length > 0 ||
        plan.toCreate.length > 0 ||
        plan.toUpdate.length > 0;

      return {success: true, plan: hasChanges ? plan : null, error: null};
    } catch (error) {
      return {success: false, plan: null, error};
    }
  }

  /**
   * Assign nurse to regions using a merge/diff approach.
   * Handles adding new regions, removing old ones, and updating region roles.
   * Proper PATCH semantics: only the provided role collections are fully replaced.
   *
   * Pass a precomputed `plan` (from buildRegionAssignmentPlan) to skip re-loading
   * the current rows; otherwise the current assignments are loaded and diffed here.
   */
  static async assignNurseToRegions({
    nurseProfileId,
    primaryRegionIds,
    secondaryRegionIds,
    organizationId,
    plan,
    tx,
  }) {
    try {
      if (primaryRegionIds === undefined && secondaryRegionIds === undefined) {
        return {success: true, error: null};
      }

      // 1-2. Use the supplied plan, or load current assignments and compute it.
      let assignmentPlan = plan;

      if (!assignmentPlan) {
        const currentRegionsResult = await PrismaFactory.find({
          model: modelConstants.MODELS.NURSE_REGION,
          query: {nurseProfileId, organizationId},
          tx,
        });

        if (!currentRegionsResult.success) {
          return {success: false, docs: [], error: currentRegionsResult.error};
        }

        assignmentPlan = computeRoleAssignmentPlan({
          currentRows: currentRegionsResult.docs || [],
          keyField: 'regionId',
          primaryIds: primaryRegionIds,
          secondaryIds: secondaryRegionIds,
        });
      }

      const {toDelete, toCreate, toUpdate} = assignmentPlan;

      // 3. Apply the plan
      if (toDelete.length > 0) {
        const {success, error} = await PrismaFactory.hardDeleteMany({
          model: modelConstants.MODELS.NURSE_REGION,
          query: {nurseProfileId, regionId: {in: toDelete}},
          tx,
        });

        if (!success) return {success: false, docs: [], error};
      }

      if (toCreate.length > 0) {
        const data = toCreate.map(({regionId, nurseRegionRole}) => ({
          nurseProfileId,
          regionId,
          organizationId,
          nurseRegionRole,
        }));

        const {success, error} = await PrismaFactory.create({
          model: modelConstants.MODELS.NURSE_REGION,
          data,
          tx,
        });

        if (!success) return {success: false, docs: [], error};
      }

      for (const {regionId, nurseRegionRole} of toUpdate) {
        const {success, error} = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.NURSE_REGION,
          query: {nurseProfileId, regionId},
          data: {nurseRegionRole},
          tx,
        });

        if (!success) return {success: false, docs: [], error};
      }

      return {success: true, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Apply a region change and drop the patient slots it no longer covers.
   * The one path for both the admin edit and the HHAeXchange sync.
   */
  static async applyRegionAssignment({
    nurseProfileId,
    organizationId,
    primaryRegionIds,
    secondaryRegionIds,
    plan,
    tx,
  }) {
    const assigned = await NursesServices.assignNurseToRegions({
      nurseProfileId,
      primaryRegionIds,
      secondaryRegionIds,
      organizationId,
      plan,
      tx,
    });

    if (!assigned.success) return {success: false, error: assigned.error};

    return await PatientsServices.unassignNurseFromMismatchedRegions({
      nurseProfileId,
      tx,
    });
  }

  /**
   * Bulk-verify that each (nurseProfileId, role) pair covers the given
   * region with the expected role (PRIMARY or SECONDARY). Used to validate
   * per-patient nurse assignment: a single DB query fetches every relevant
   * NurseRegion row and we check the expected pairs against the result.
   *
   * Entries with no nurseProfileId are skipped so callers can pass through
   * optional fields without extra guards.
   *
   * @param {object[]} assignments  [{nurseProfileId, role}, ...]
   * @param {string}   regionId     Region to check role membership against
   */
  static async validateNurseRegionRoleAssignments({assignments, regionId}) {
    const filtered = (assignments || []).filter((a) => a && a.nurseProfileId);

    if (filtered.length === 0) return {valid: true};

    const nurseProfileIds = filtered.map((a) => a.nurseProfileId);

    const {success, docs, error} = await PrismaFactory.find({
      model: modelConstants.MODELS.NURSE_REGION,
      query: {
        nurseProfileId: {in: nurseProfileIds},
        regionId,
      },
    });

    if (!success) return {valid: false, reason: 'Lookup failed', error};

    const foundPairs = new Set(
      (docs || []).map((d) => `${d.nurseProfileId}:${d.nurseRegionRole}`)
    );

    const missing = filtered.find(
      ({nurseProfileId, role}) => !foundPairs.has(`${nurseProfileId}:${role}`)
    );

    if (missing)
      return {
        valid: false,
        reason: `Nurse is not assigned to this region as ${missing.role}`,
      };

    return {valid: true};
  }

  /**
   * Add nurse to a single region with an explicit primary/secondary role.
   */
  static async addNurseToRegion({
    nurseProfileId,
    regionId,
    organizationId,
    nurseRegionRole = NURSE_REGION_ROLES.SECONDARY,
    tx,
  }) {
    try {
      const {doc, success, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.NURSE_REGION,
        data: {
          nurseProfileId,
          regionId,
          organizationId,
          nurseRegionRole,
        },
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Remove nurse from a region
   */
  static async removeNurseFromRegion({nurseProfileId, regionId, tx}) {
    try {
      const result = await PrismaFactory.deleteMany({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfileId, regionId},
        tx,
      });

      return {
        success: result.success,
        doc: result.responseObj,
        error: result.error,
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Get nurse's assigned regions
   */
  static async getNurseRegionIdsByUserId({userId}) {
    try {
      const {docs, success, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfile: {userId}},
        fieldsInclusion: {
          includeSpecificFields: ['regionId'],
        },
      });

      if (!success) return {success, docs: [], error};

      return {
        success,
        docs: (docs ?? []).map((nr) => nr.regionId),
        error,
      };
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Mark a nurse-region assignment as primary without affecting other primaries.
   */
  static async setPrimaryRegion({nurseProfileId, regionId, tx}) {
    try {
      const {doc, success, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.NURSE_REGION,
        query: {nurseProfileId, regionId},
        data: {nurseRegionRole: NURSE_REGION_ROLES.PRIMARY},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /** Look up the active UserOrganization for a NurseProfile in this org. Returns `{success: true, userOrgId: null, userId: null}` when the profile is missing, soft-deleted, in another org, not ACTIVE, unverified, or has no active org membership — callers treat that as an unstaffed slot (the escalation cascade then advances to the next level). */
  static async resolveUserOrgForNurseProfile({
    nurseProfileId,
    organizationId,
    tx,
  }) {
    try {
      if (!nurseProfileId) {
        return {success: true, userOrgId: null, userId: null};
      }

      // Same eligibility bar as resolveRegionNurseByRole / validateNurses(): a
      // deactivated nurse or unverified user must never be assigned an
      // escalation even if their UserOrganization is still active.
      const {doc: nurseProfile} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: {
          id: nurseProfileId,
          organizationId,
          status: ENTITY_STATUSES.ACTIVE.value,
          user: {isVerified: true},
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      const userId = nurseProfile?.userId || null;

      if (!userId) {
        return {success: true, userOrgId: null, userId: null};
      }

      const {doc: userOrg} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
        tx,
      });

      return {success: true, userOrgId: userOrg?.id || null, userId};
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  /** Resolve `patient.primaryNurseProfileId` → UserOrganization. */
  static async resolvePatientPrimaryNurse({patientId, organizationId, tx}) {
    try {
      const {doc: patient} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id: patientId, organizationId},
        options: {bypassExtraQueries: true},
        tx,
      });

      return this.resolveUserOrgForNurseProfile({
        nurseProfileId: patient?.primaryNurseProfileId || null,
        organizationId,
        tx,
      });
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  /** Resolve `patient.secondaryNurseProfileId` → UserOrganization. */
  static async resolvePatientSecondaryNurse({patientId, organizationId, tx}) {
    try {
      const {doc: patient} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PATIENT,
        query: {id: patientId, organizationId},
        options: {bypassExtraQueries: true},
        tx,
      });

      return this.resolveUserOrgForNurseProfile({
        nurseProfileId: patient?.secondaryNurseProfileId || null,
        organizationId,
        tx,
      });
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  /** Resolve the region's PRIMARY regional nurse (load-balanced across all primaries). */
  static async resolveRegionPrimaryNurse({
    regionId,
    organizationId,
    alreadyAssignedIds = new Set(),
    tx,
  }) {
    return this.resolveRegionNurseByRole({
      regionId,
      organizationId,
      role: NURSE_REGION_ROLES.PRIMARY,
      alreadyAssignedIds,
      tx,
    });
  }

  /** Resolve the region's SECONDARY regional nurse (load-balanced across all secondaries). */
  static async resolveRegionSecondaryNurse({
    regionId,
    organizationId,
    alreadyAssignedIds = new Set(),
    tx,
  }) {
    return this.resolveRegionNurseByRole({
      regionId,
      organizationId,
      role: NURSE_REGION_ROLES.SECONDARY,
      alreadyAssignedIds,
      tx,
    });
  }

  /**
   * Pick one regional nurse for a region+role using the load-balancing policy:
   *   1. prefer a nurse who is FREE (zero ACTIVE assigned escalations of any color);
   *   2. otherwise the nurse with the FEWEST active RED escalations;
   *   3. tie-break on whoever's next escalation expires soonest (frees up first).
   * Candidates already notified earlier in this escalation (alreadyAssignedIds) are
   * dropped before ranking, so a busy/duplicate top pick doesn't skip the whole
   * region level while other regional nurses are still available. Returns a null
   * userOrgId (not an error) when the region has no eligible nurse for the role.
   */
  static async resolveRegionNurseByRole({
    regionId,
    organizationId,
    role,
    alreadyAssignedIds = new Set(),
    tx,
  }) {
    try {
      if (!regionId) {
        return {success: true, userOrgId: null, userId: null};
      }

      // Region's DEFAULT nurses holding this role (region-owned
      // RegionDefaultNurse roster), used for escalation routing. A lookup
      // *failure* must propagate
      // (not masquerade as an unstaffed region) so the cascade retries instead
      // of silently skipping the region level.
      const {
        success: regionDefaultNursesSuccess,
        docs: regionDefaultNurses = [],
        error: regionDefaultNursesError,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
        query: {regionId, organizationId, nurseRegionRole: role},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!regionDefaultNursesSuccess) {
        return {
          success: false,
          userOrgId: null,
          userId: null,
          error: regionDefaultNursesError,
        };
      }

      const nurseProfileIds = regionDefaultNurses
        .map((regionDefaultNurse) => regionDefaultNurse.nurseProfileId)
        .filter(Boolean);

      if (nurseProfileIds.length === 0) {
        return {success: true, userOrgId: null, userId: null};
      }

      // nurseProfileId → userId. Narrow to ACTIVE, verified nurses only — same
      // eligibility bar as validateNurses(); a deactivated nurse or unverified
      // user must never be picked even if their UserOrganization is still active.
      const {
        success: nurseProfilesSuccess,
        docs: nurseProfiles = [],
        error: nurseProfilesError,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: {
          id: {in: nurseProfileIds},
          organizationId,
          status: ENTITY_STATUSES.ACTIVE.value,
          user: {isVerified: true},
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!nurseProfilesSuccess) {
        return {
          success: false,
          userOrgId: null,
          userId: null,
          error: nurseProfilesError,
        };
      }

      const userIds = nurseProfiles
        .map((nurseProfile) => nurseProfile.userId)
        .filter(Boolean);

      if (userIds.length === 0) {
        return {success: true, userOrgId: null, userId: null};
      }

      // userId → active UserOrganization id.
      const {
        success: userOrgsSuccess,
        docs: userOrgs = [],
        error: userOrgsError,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId: {in: userIds}, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!userOrgsSuccess) {
        return {
          success: false,
          userOrgId: null,
          userId: null,
          error: userOrgsError,
        };
      }

      // Build the candidate pool (userOrgId + userId), dropping anyone already
      // notified earlier in this escalation.
      const candidates = userOrgs
        .filter((userOrg) => !alreadyAssignedIds.has(userOrg.id))
        .map((userOrg) => ({userOrgId: userOrg.id, userId: userOrg.userId}));

      if (candidates.length === 0) {
        return {success: true, userOrgId: null, userId: null};
      }

      const candidateUserOrgIds = candidates.map(
        (candidate) => candidate.userOrgId
      );

      // Every ACTIVE escalation currently assigned to any candidate, with the
      // color (for the RED count) and expiry (for the tie-break) we need.
      const {
        success: activeEscalationsSuccess,
        docs: activeEscalations = [],
        error: activeEscalationsError,
      } = await PrismaFactory.find({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {
          status: {in: OPEN_ESCALATION_STATUSES},
          currentAssigneeId: {in: candidateUserOrgIds},
        },
        fieldsInclusion: {include: {submissionFlag: {select: {flag: true}}}},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!activeEscalationsSuccess) {
        return {
          success: false,
          userOrgId: null,
          userId: null,
          error: activeEscalationsError,
        };
      }

      // Rank by load (free → fewest red → soonest-to-free) and take the winner.
      const winner = EscalationAssignmentHelpers.pickLeastLoadedNurse({
        candidates,
        activeEscalations,
      });

      if (!winner) {
        return {success: true, userOrgId: null, userId: null};
      }

      return {
        success: true,
        userOrgId: winner.userOrgId,
        userId: winner.userId,
      };
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  // Dashboard for the logged-in nurse, scoped like the patients and
  // emergency-flags lists (buildNursePatientScopeClause) so counts match.
  static async getNurseDashboard({nurseScope, organizationId, userId}) {
    try {
      const dueTodayResult = await this.buildDueToday({userId, organizationId});
      if (!dueTodayResult.success)
        return {success: false, doc: null, error: dueTodayResult.error};

      const {dueToday} = dueTodayResult;

      if (!nurseScope) {
        return {
          success: true,
          doc: {
            stats: {
              openAlerts: {total: 0, red: 0, yellow: 0},
              dueToday: dueToday.stats,
              myPatients: 0,
            },
            myDay: dueToday.items,
            assessmentsSinceYesterday: {submitted: 0, missed: 0, skipped: 0},
          },
        };
      }

      // Soft-delete is only applied to the top-level model, not nested relations.
      const regionPatientClause = Object.assign(
        {isDeleted: null},
        buildNursePatientScopeClause({nurseScope})
      );
      const startOfYesterday = getDaysFromNow({days: -1});
      const now = getCurrentTime();

      const openFlagQuery = ({threshold}) => ({
        model: modelConstants.MODELS.SUBMISSION_FLAG,
        query: {
          organizationId,
          status: {in: SUBMISSION_FLAG_OPEN_STATUSES},
          flag: threshold.flag,
          category: threshold.category,
          patient: regionPatientClause,
        },
      });

      const submissionQuery = ({clause}) => ({
        model: modelConstants.MODELS.CHECKLIST_SUBMISSION,
        query: Object.assign(
          {organizationId, patient: regionPatientClause},
          clause
        ),
      });

      const countSpecs = {
        red: openFlagQuery({threshold: RISK_SCORE_THRESHOLDS.RED}),
        yellow: openFlagQuery({threshold: RISK_SCORE_THRESHOLDS.YELLOW}),
        myPatients: {
          model: modelConstants.MODELS.PATIENT,
          query: Object.assign({organizationId}, regionPatientClause),
        },
        submitted: submissionQuery({
          clause: {
            status: {in: NURSE_DASHBOARD_SUBMITTED_STATUSES},
            submittedAt: {gte: startOfYesterday},
          },
        }),

        // Missed rows are set by the cron and never touched again, so dueDate
        // is the only reliable "when".
        missed: submissionQuery({
          clause: {
            status: CHECKLIST_SUBMISSION_STATUSES.MISSED.value,
            dueDate: {gte: startOfYesterday, lte: now},
          },
        }),

        // No skippedAt column; a skip is terminal, so updatedAt is the skip time.
        skipped: submissionQuery({
          clause: {
            status: CHECKLIST_SUBMISSION_STATUSES.SKIPPED.value,
            updatedAt: {gte: startOfYesterday},
          },
        }),
      };

      const metrics = Object.keys(countSpecs);

      const results = await Promise.all(
        metrics.map((metric) =>
          PrismaFactory.countDocuments(countSpecs[metric])
        )
      );

      const failed = results.find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const counts = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );

      return {
        success: true,
        doc: {
          stats: {
            openAlerts: {
              total: counts.red + counts.yellow,
              red: counts.red,
              yellow: counts.yellow,
            },
            dueToday: dueToday.stats,
            myPatients: counts.myPatients,
          },
          myDay: dueToday.items,
          assessmentsSinceYesterday: {
            submitted: counts.submitted,
            missed: counts.missed,
            skipped: counts.skipped,
          },
        },
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  // "Due today" / "My day": open follow-up tasks and supervisory visits
  // assigned to the nurse and due / starting within today in the
  // organization's time zone.
  static async buildDueToday({userId, organizationId}) {
    const [{doc: userOrg}, zone] = await Promise.all([
      PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        fieldsInclusion: {includeSpecificFields: ['id']},
        options: {bypassExtraQueries: true},
      }),
      OrganizationsServices.getOrganizationTimeZone({id: organizationId}),
    ]);

    const empty = {success: true, docs: [], count: 0};

    const [tasks, visits] = userOrg
      ? await Promise.all([
          FollowUpTasksServices.listDueTodayForAssignee({
            userOrgId: userOrg.id,
            organizationId,
            zone,
          }),
          SupervisoryVisitsServices.listDueTodayForAssignee({
            userOrgId: userOrg.id,
            organizationId,
            zone,
          }),
        ])
      : [empty, empty];

    const failed = [tasks, visits].find(({success}) => !success);
    if (failed) return {success: false, error: failed.error};

    const toItem = ({doc, type, title, dueDate}) => ({
      id: doc.id,
      type,
      title,
      patientName: [doc.patient?.firstName, doc.patient?.lastName]
        .filter(Boolean)
        .join(' '),
      dueDate,
      dueTime: formatInZone({
        date: dueDate,
        zone,
        format: NURSE_DASHBOARD_DUE_TIME_FORMAT,
      }),
      priority: doc.priority || null,
      status: doc.status,
    });

    const items = tasks.docs
      .map((task) =>
        toItem({
          doc: task,
          type: NURSE_DASHBOARD_ITEM_TYPES.FOLLOW_UP.value,
          title: task.title,
          dueDate: task.dueAt,
        })
      )
      .concat(
        visits.docs.map((visit) =>
          toItem({
            doc: visit,
            type: NURSE_DASHBOARD_ITEM_TYPES.SUPERVISORY_VISIT.value,
            title: NURSE_DASHBOARD_ITEM_TYPES.SUPERVISORY_VISIT.label,
            dueDate: visit.scheduledStartAt,
          })
        )
      )
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    return {
      success: true,
      dueToday: {
        items,
        stats: {
          total: tasks.count + visits.count,
          followUps: tasks.count,
          supervisoryVisits: visits.count,
        },
      },
    };
  }

  // Org-wide nurse stats for the admin dashboard: total nurses, nurses
  // currently available (ACTIVE status), and the average number of alerts
  // routed to nurses. The optional from/to window applies to createdAt and
  // defaults to all time.
  static async getNurseAdminStats({organizationId, from, to}) {
    try {
      const dateClause = buildDateRangeClause({from, to});

      const countSpecs = {
        totalNurses: {
          model: modelConstants.MODELS.NURSE_PROFILE,
          query: Object.assign({organizationId, isDeleted: null}, dateClause),
        },
        availableNurses: {
          model: modelConstants.MODELS.NURSE_PROFILE,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              status: ENTITY_STATUSES.ACTIVE.value,
            },
            dateClause
          ),
        },

        // An alert = an escalation event assigned at a nurse stage (a nurse
        // was paged). The event model has no organizationId column, so it's
        // scoped through the parent escalation and bypassExtraQueries stops
        // the ACL layer injecting a column that isn't there.
        nurseAlerts: {
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
          query: Object.assign(
            {
              level: {in: NURSE_ESCALATION_LEVELS_VALUES},
              escalation: {organizationId},
            },
            dateClause
          ),
          options: {bypassExtraQueries: true},
        },
      };

      const metrics = Object.keys(countSpecs);

      const results = await Promise.all(
        metrics.map((metric) =>
          PrismaFactory.countDocuments(countSpecs[metric])
        )
      );

      const failed = results.find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const counts = Object.fromEntries(
        metrics.map((metric, index) => [metric, results[index].count])
      );

      const averageAlertsPerNurse = calculateAverage({
        total: counts.nurseAlerts,
        count: counts.totalNurses,
      });

      const doc = {
        totalNurses: counts.totalNurses,
        averageAlertsPerNurse,
        availableNurses: counts.availableNurses,
      };

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
