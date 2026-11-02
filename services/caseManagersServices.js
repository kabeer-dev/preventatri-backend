const {modelConstants} = require('../constants');

const {
  CASE_MANAGER_ASSESSMENT_RATE_SQL,
  CASE_MANAGER_DASHBOARD_CHECKLIST_LIMIT,
  CASE_MANAGER_DASHBOARD_ITEM_TYPES,
  CASE_MANAGER_DASHBOARD_RATE_WINDOW_DAYS,
} = require('../constants/caseManagersConstants');

const {
  ESCALATION_ACTIONS,
  ESCALATION_LEVELS,
} = require('../constants/escalationConstants');

const {
  FOLLOW_UP_TASK_OPEN_STATUS_VALUES,
} = require('../constants/followUpTasksConstants');

const {ENTITY_STATUSES} = require('../constants/generalConstant');
const {PATIENT_SOURCES} = require('../constants/patientsConstants');

const {
  SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
} = require('../constants/supervisoryVisitsConstants');

const {PrismaFactory, CaseManagersErrorsFactories} = require('../factories');

const {
  buildDateRangeClause,
  getCurrentTime,
  getDaysFromNow,
} = require('../utils/dateUtils');

const {
  buildNameSearchClause,
  calculateAverage,
  filterUndefined,
  safeMerge,
  isDocumentDuplicationError,
} = require('../utils/general');

module.exports = class CaseManagersServices {
  /**
   * Get case manager profile by ID
   */
  static async getCaseManagerProfileById({id, options = {}}) {
    try {
      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
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
   * Get case manager profile by query
   */
  static async getCaseManagerProfile({query, options = {}}) {
    try {
      const result = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query,
        options,
        fieldsInclusion: options.fieldsInclusion,
      });

      return result;
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getCaseManagerProfileByUser({userId, additionalFilters} = {}) {
    try {
      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query: Object.assign({userId}, additionalFilters),
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Create case manager profile
   */
  static async createCaseManagerProfile({
    userId,
    organizationId,
    status,
    preferredContactMethod,
    language,
    startDate,
    title,
    notes,

    // HHAeXchange provenance. Only the sync engine passes these; the invite
    // flow leaves them undefined and filterUndefined drops them, so the row
    // keeps the MANUAL default and a NULL hhaCoordinatorId -- which is exactly
    // what case_manager_profiles_hha_identity_check requires.
    source,
    hhaCoordinatorId,
    hhaSyncHash,
    hhaLastSyncedAt,
    tx,
  }) {
    try {
      const data = filterUndefined({
        obj: {
          userId,
          organizationId,
          status,
          preferredContactMethod,
          language,
          startDate,
          title,
          notes,
          source,
          hhaCoordinatorId,
          hhaSyncHash,
          hhaLastSyncedAt,
        },
      });

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Update case manager profile
   */
  static async updateCaseManagerProfile({id, updateData, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
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
   * Soft delete case manager profile
   */
  static async deleteCaseManagerProfile({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Count patients currently assigned to a case manager
   */
  static async getAssignedPatientsCount({caseManagerProfileId}) {
    try {
      const {count} = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
        query: {caseManagerProfileId},
      });

      return {success: true, count: count ?? 0};
    } catch (error) {
      return {success: false, count: 0, error};
    }
  }

  /**
   * List case manager profiles with filters
   */
  static async listCaseManagerProfiles({
    status,
    regionId,
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
      if (regionId) {
        query.caseManagerRegions = {some: {regionId}};
      }

      const nameClause = buildNameSearchClause({
        name,
        fields: ['user.firstName', 'user.lastName'],
      });
      if (nameClause) {
        Object.assign(query, nameClause);
      }

      // The patient form's picker: only people who accepted an invitation.
      if (isVerified !== undefined) {
        query.AND = (query.AND || []).concat([{user: {isVerified}}]);
      }

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: safeMerge({
          originalObj: options.fieldsInclusion || {},
          deep: true,
          newObj: {
            include: {
              _count: {
                select: {caseManagerPatients: true},
              },
            },
          },
        }),
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query,
      });

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.success ? countResult.count : 0},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  /**
   * Get patients not yet assigned to any case manager within the organization.
   * Optionally filter by region IDs (via patient → county → region).
   */
  static async getAvailablePatients({regionIds, caseManagerProfileId}) {
    try {
      // An HHA patient's case manager comes from the patient sync.
      const query = {source: {not: PATIENT_SOURCES.HHA_EXCHANGE.value}};

      if (regionIds?.length) query.county = {regionId: {in: regionIds}};

      if (caseManagerProfileId)
        query.OR = [
          {caseManagerPatients: {none: {}}},
          {caseManagerPatients: {some: {caseManagerProfileId}}},
        ];
      else query.caseManagerPatients = {none: {}};

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query,
        fieldsInclusion: {
          includeSpecificFields: ['id', 'firstName', 'lastName'],
        },
      });

      return result;
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  // ==========================================
  // REGION ASSIGNMENT METHODS
  // ==========================================

  /**
   * Assign regions to a case manager (replaces all existing assignments)
   */
  static async assignRegionsToCaseManager({
    caseManagerProfileId,
    regionIds,
    organizationId,
    tx,
  }) {
    try {
      // Remove existing region assignments
      await PrismaFactory.hardDeleteMany({
        model: modelConstants.MODELS.CASE_MANAGER_REGION,
        query: {caseManagerProfileId},
        tx,
      });

      // Create new region assignments
      const assignments = regionIds.map((regionId) => ({
        caseManagerProfileId,
        regionId,
        organizationId,
      }));

      const {success, docs, error} = await PrismaFactory.createManyAndReturn({
        model: modelConstants.MODELS.CASE_MANAGER_REGION,
        data: assignments,
        tx,
      });
      if (!success || error) throw error;

      return {success: true, docs, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  // ==========================================
  // PATIENT ASSIGNMENT METHODS
  // ==========================================

  /**
   * Split patient ids by source. HHA patients' case manager comes from the
   * patient sync, so only the manual ones may be assigned by hand.
   */
  static async splitPatientIdsBySource({patientIds, tx}) {
    if (!patientIds?.length) {
      return {success: true, hhaPatientIds: [], manualPatientIds: []};
    }

    const {success, docs, error} = await PrismaFactory.find({
      model: modelConstants.MODELS.PATIENT,
      query: {
        id: {in: patientIds},
        source: PATIENT_SOURCES.HHA_EXCHANGE.value,
      },
      fieldsInclusion: {includeSpecificFields: ['id']},
      tx,
    });

    if (!success) return {success: false, error};

    const hhaIds = new Set(docs.map((doc) => doc.id));

    return {
      success: true,
      hhaPatientIds: patientIds.filter((id) => hhaIds.has(id)),
      manualPatientIds: patientIds.filter((id) => !hhaIds.has(id)),
    };
  }

  /**
   * Replace a case manager's MANUAL patient roster. Links to HHA patients
   * belong to the patient sync and survive; pass manual patient ids only.
   */
  static async assignPatientsToCaseManager({
    caseManagerProfileId,
    patientIds,
    organizationId,
    tx,
  }) {
    try {
      await PrismaFactory.hardDeleteMany({
        model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
        query: {
          caseManagerProfileId,
          patient: {source: {not: PATIENT_SOURCES.HHA_EXCHANGE.value}},
        },
        tx,
      });

      // Create new patient assignments
      const assignments = patientIds.map((patientId) => ({
        caseManagerProfileId,
        patientId,
        organizationId,
      }));

      const {success, docs, error} = await PrismaFactory.createManyAndReturn({
        model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
        data: assignments,
        tx,
      });

      if (error && isDocumentDuplicationError({error})) {
        const conflictingPatients = await PrismaFactory.find({
          model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
          query: {
            patientId: {in: patientIds},
            caseManagerProfileId: {not: caseManagerProfileId},
          },
          fieldsInclusion: {includeSpecificFields: ['patient']},
          tx,
        });

        const patientNames = (conflictingPatients.docs ?? []).map((a) =>
          a.patient
            ? `${a.patient.firstName} ${a.patient.lastName}`
            : 'A patient'
        );

        throw CaseManagersErrorsFactories.patientAlreadyAssignedErr({
          patientNames: patientNames.length ? patientNames : ['A patient'],
        });
      }

      if (!success || error) throw error;

      // Open follow-up tasks and supervisory visits survive a roster change:
      // they belong to their assignee (any care-team role), not the caseload.
      return {success: true, docs, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Point one patient at one case manager. The table is unique on patientId,
   * so an existing link is moved rather than added to.
   */
  static async setPatientCaseManager({
    patientId,
    caseManagerProfileId,
    organizationId,
    tx,
  }) {
    const {
      success: lookedUp,
      doc: link,
      error: lookupError,
    } = await PrismaFactory.findOne({
      model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
      query: {patientId},
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!lookedUp) return {success: false, error: lookupError};

    if (link?.caseManagerProfileId === caseManagerProfileId) {
      return {success: true, error: null};
    }

    const {success, error} = link
      ? await PrismaFactory.updateOne({
          model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
          query: {id: link.id},
          data: {caseManagerProfileId, assignedAt: getCurrentTime()},
          options: {bypassExtraQueries: true},
          tx,
        })
      : await PrismaFactory.create({
          model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
          data: {caseManagerProfileId, patientId, organizationId},
          options: {bypassExtraQueries: true},
          tx,
        });

    return {success, error};
  }

  /**
   * Resolve the case manager's UserOrganization for a patient.
   * CaseManagerPatient is unique on patientId — each patient has at most one.
   */
  static async resolveCaseManagerForPatient({patientId, organizationId, tx}) {
    try {
      // Only an ACTIVE, non-deleted case manager with a verified user is
      // eligible — otherwise resolve to null so the escalation cascade
      // advances to the next level instead of assigning a deactivated CM.
      const {doc: assignment} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
        query: {
          patientId,
          organizationId,
          caseManagerProfile: {
            status: ENTITY_STATUSES.ACTIVE.value,
            isDeleted: null,
            user: {isVerified: true},
          },
        },
        fieldsInclusion: {
          include: {
            caseManagerProfile: {select: {userId: true}},
          },
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      const userId = assignment?.caseManagerProfile?.userId || null;

      if (!userId) {
        return {success: true, userOrgId: null, userId: null};
      }

      const {doc: userOrg} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId, organizationId, isActive: true},
        options: {bypassExtraQueries: true},
        tx,
      });

      return {
        success: true,
        userOrgId: userOrg?.id || null,
        userId,
      };
    } catch (error) {
      return {success: false, userOrgId: null, userId: null, error};
    }
  }

  // Dashboard for the logged-in case manager: pending tasks and visits,
  // assigned patients, their escalation resolution rate, and the nearest-due
  // checklist items across both work types.
  static async getCaseManagerDashboard({userId, organizationId}) {
    try {
      // Escalations are keyed by UserOrganization.id; patients, tasks and
      // visits by CaseManagerProfile.id.
      const [userOrgResult, caseManagerProfileResult] = await Promise.all([
        PrismaFactory.findOne({
          model: modelConstants.MODELS.USER_ORGANIZATION,
          query: {userId, organizationId, isActive: true},
          fieldsInclusion: {includeSpecificFields: ['id']},
          options: {bypassExtraQueries: true},
        }),
        PrismaFactory.findOne({
          model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
          query: {userId, organizationId, isDeleted: null},
          fieldsInclusion: {includeSpecificFields: ['id']},
          options: {bypassExtraQueries: true},
        }),
      ]);

      if (!userOrgResult.success || !caseManagerProfileResult.success) {
        return {
          success: false,
          doc: null,
          error: userOrgResult.error || caseManagerProfileResult.error,
        };
      }

      const userOrgId = userOrgResult.doc?.id || null;
      const caseManagerProfileId = caseManagerProfileResult.doc?.id || null;

      const [
        followUpsResult,
        visitsResult,
        patientsResult,
        assessmentRateResult,
      ] = await Promise.all([
        // Both are keyed by assignee (UserOrganization).
        this.getPendingWorkItems({
          model: modelConstants.MODELS.FOLLOW_UP_TASK,
          type: CASE_MANAGER_DASHBOARD_ITEM_TYPES.FOLLOW_UP.value,
          sortField: 'dueAt',
          query: userOrgId
            ? {
                organizationId,
                isDeleted: null,
                status: {in: FOLLOW_UP_TASK_OPEN_STATUS_VALUES},
                assigneeUserOrganizationId: userOrgId,
              }
            : null,
        }),
        this.getPendingWorkItems({
          model: modelConstants.MODELS.SUPERVISORY_VISIT,
          type: CASE_MANAGER_DASHBOARD_ITEM_TYPES.SUPERVISORY_VISIT.value,
          sortField: 'scheduledStartAt',
          query: userOrgId
            ? {
                organizationId,
                isDeleted: null,
                status: {in: SUPERVISORY_VISIT_OPEN_STATUS_VALUES},
                assigneeUserOrganizationId: userOrgId,
              }
            : null,
        }),
        caseManagerProfileId
          ? this.getAssignedPatientsCount({caseManagerProfileId})
          : Promise.resolve({success: true, count: 0}),
        this.getAssessmentRate({userOrgId}),
      ]);

      const failed = [
        followUpsResult,
        visitsResult,
        patientsResult,
        assessmentRateResult,
      ].find(({success}) => !success);
      if (failed) return {success: false, doc: null, error: failed.error};

      const checklistTasks = followUpsResult.items
        .concat(visitsResult.items)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        .slice(0, CASE_MANAGER_DASHBOARD_CHECKLIST_LIMIT);

      const doc = {
        stats: {
          tasksAssignedToMe: {
            total: followUpsResult.count + visitsResult.count,
            followUps: followUpsResult.count,
            supervisoryVisits: visitsResult.count,
          },
          myPatients: patientsResult.count,
          assessmentRate: assessmentRateResult.rate,
          assessmentRateCounts: assessmentRateResult.counts,
        },
        checklistTasks,
      };

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  // Pending follow-ups or visits for a case manager, nearest due first. The
  // caller passes the same scope the lists use so the counts agree with them
  // (null query = nothing to scope by).
  static async getPendingWorkItems({model, type, query, sortField}) {
    if (!query) return {success: true, count: 0, items: []};

    const [listResult, countResult] = await Promise.all([
      PrismaFactory.find({
        model,
        query,
        options: {
          sort: {[sortField]: 'asc'},
          take: CASE_MANAGER_DASHBOARD_CHECKLIST_LIMIT,
          bypassExtraQueries: true,
        },
        fieldsInclusion: {
          include: {
            patient: {select: {firstName: true, lastName: true}},
            checklistTemplate: {select: {title: true}},
          },
        },
      }),
      PrismaFactory.countDocuments({model, query}),
    ]);

    if (!listResult.success || !countResult.success) {
      return {
        success: false,
        count: 0,
        items: [],
        error: listResult.error || countResult.error,
      };
    }

    const items = listResult.docs.map((doc) => ({
      id: doc.id,
      type,
      title: doc.title || doc.checklistTemplate?.title || null,
      dueDate: doc.dueAt || doc.scheduledStartAt || doc.dueDate,
      flagType: doc.flagType,
      checklistTitle: doc.checklistTemplate?.title || null,
      patientName: [doc.patient?.firstName, doc.patient?.lastName]
        .filter(Boolean)
        .join(' '),
    }));

    return {success: true, count: countResult.count ?? 0, items};
  }

  // Share of escalations assigned to this case manager that they resolved,
  // versus let expire up to admin, within the dashboard window. Null when
  // none ended in the window, so the card shows no data instead of 0%.
  static async getAssessmentRate({userOrgId}) {
    const counts = {resolved: 0, skipped: 0};

    if (!userOrgId) return {success: true, rate: null, counts};

    const result = await PrismaFactory.aggregate({
      query: CASE_MANAGER_ASSESSMENT_RATE_SQL({
        resolvedAction: ESCALATION_ACTIONS.RESOLVED.value,
        escalatedAction: ESCALATION_ACTIONS.ESCALATED.value,
        level: ESCALATION_LEVELS.CASE_MANAGER.value,
        userOrgId,
        since: getDaysFromNow({
          days: -CASE_MANAGER_DASHBOARD_RATE_WINDOW_DAYS,
          isStartOfDay: false,
        }),
      }),
    });

    if (!result.success) {
      return {success: false, rate: null, counts, error: result.error};
    }

    const [row] = result.docs || [];
    counts.resolved = Number(row?.resolved) || 0;
    counts.skipped = Number(row?.skipped) || 0;

    const total = counts.resolved + counts.skipped;
    const rate = total ? Math.round((counts.resolved / total) * 100) : null;

    return {success: true, rate, counts};
  }

  // Org-wide case manager stats for the admin dashboard: total case managers,
  // case managers currently active, and the average number of cases routed to
  // case managers. The optional from/to window applies to createdAt and
  // defaults to all time.
  static async getCaseManagerAdminStats({organizationId, from, to}) {
    try {
      const dateClause = buildDateRangeClause({from, to});

      const countSpecs = {
        totalCaseManagers: {
          model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
          query: Object.assign({organizationId, isDeleted: null}, dateClause),
        },
        activeCaseManagers: {
          model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
          query: Object.assign(
            {
              organizationId,
              isDeleted: null,
              status: ENTITY_STATUSES.ACTIVE.value,
            },
            dateClause
          ),
        },

        // A case = an escalation event assigned at the case-manager stage (a
        // case landed on a case manager's desk). The event model has no
        // organizationId column, so it's scoped through the parent escalation
        // and bypassExtraQueries stops the ACL layer injecting a column that
        // isn't there.
        caseManagerCases: {
          model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
          query: Object.assign(
            {
              level: ESCALATION_LEVELS.CASE_MANAGER.value,
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

      const averageCasesPerCaseManager = calculateAverage({
        total: counts.caseManagerCases,
        count: counts.totalCaseManagers,
      });

      const doc = {
        totalCaseManagers: counts.totalCaseManagers,
        averageCasesPerCaseManager,
        activeCaseManagers: counts.activeCaseManagers,
      };

      return {success: true, doc};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
