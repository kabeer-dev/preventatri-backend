/**
 * HHAeXchange -> PreventaTri case manager reconciliation.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * HHAeXchange calls the role a Coordinator; PreventaTri calls it a Case
 * Manager. Same person, different word. This module speaks HHAeXchange on the
 * way in and PreventaTri on the way out, and "Coordinator" never reaches
 * product copy.
 *
 * ONE DIFFERENCE FROM THE CAREGIVER RUNNER, and it comes from the API rather
 * than from any choice made here: GetCoordinators is a FULL ROSTER read, not a
 * change feed. There is no GetCoordinatorChanges of any version, no
 * ModifiedAfter, no pagination and no ModifiedDate on the record. So this
 * runner makes ONE call, ignores the `modifiedAfter` window every other runner
 * honours, and gates writes on hhaSyncHash alone. Nothing is stored in an
 * hhaModifiedDate column because there is no such value to store --
 * hhaLastSyncedAt is the only "when" this integration can show for a case
 * manager.
 *
 * Everything else is the caregiver rules verbatim, through the shared helpers in
 * userProfileSyncUtils: hash-gated writes, only HHA_MANAGED_CASE_MANAGER_FIELDS
 * ever written, email matched second and only to adopt an unclaimed profile, and
 * archived rows updated in place.
 *
 * Sync deliberately sends NO invitation and assigns NO regions and NO patients.
 * addUserToSystem creates the user, the org membership and the permissions but
 * mails nothing, so an imported case manager exists unverified until an admin
 * reviews them. Regions and patient assignments are PreventaTri-owned on every
 * case manager, imported or not, and an admin sets them exactly as on a manual
 * one; the edit form requiring at least one region is the nudge that turns a
 * pending import into a working account. The sync never reads the patient
 * feed's coordinator element, so an assignment an admin makes is never undone.
 */

const CaseManagersServices = require('./caseManagersServices');
const HhaExchangeServices = require('./hhaExchangeServices');

const {CASE_MANAGER_SOURCES} = require('../constants/caseManagersConstants');

const {
  HHA_MANAGED_CASE_MANAGER_FIELDS,
  HHAX_COORDINATOR_ELEMENTS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
  HHAX_SYNC_TRIGGERS,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const {UsersControllerHelpers} = require('../helpers');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');

const {
  mapHhaCoordinator,
  computeCoordinatorSyncHash,
  toUpdatableCaseManagerUserFields,
} = require('../utils/hhaExchange/coordinatorMapper');

const {normalizeValue} = require('../utils/hhaExchange/soapClient');

const {
  buildSummary,
  markRecordSeen,
  recordException,
} = require('../utils/hhaExchange/syncRunUtils');

const {
  splitPreparedByHash,
  touchUnchanged,
  recordProfileCreate,
  recordProfileUpdate,
  updateUserAndProfile,
  findOrgUserByEmail,
  reconcileHhaEmails,
  resolveImportUserFields,
  runInParallelGroups,
  clearPendingImport,
  isAdoptableProfile,
} = require('../utils/hhaExchange/userProfileSyncUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

/** The field name the shared split helper matches profiles on. */
const HHA_COORDINATOR_ID_FIELD = 'hhaCoordinatorId';

/**
 * Map and fingerprint the roster, without touching the database.
 *
 * @returns {Object[]} One prepared entry per importable record.
 */
const prepareRecords = ({records, summary}) => {
  const prepared = [];

  for (const record of records) {
    summary.seen += 1;

    const {hhaCoordinatorId, userFields, profileFields, exceptions, isValid} =
      mapHhaCoordinator({record});

    markRecordSeen({summary, recordId: hhaCoordinatorId});

    if (!hhaCoordinatorId) {
      recordException({
        summary,
        recordId: null,
        type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_COORDINATOR_ID,
      });
      summary.failed += 1;

      continue;
    }

    exceptions.forEach((exception) =>
      recordException({
        summary,
        recordId: hhaCoordinatorId,
        type: exception.type,
        detail: exception.detail,
      })
    );

    // firstName backs a User row that must be identifiable. Skipping beats
    // letting the insert fail, so one incomplete record never costs the rest of
    // the roster.
    if (!isValid) {
      summary.failed += 1;

      continue;
    }

    prepared.push({
      hhaCoordinatorId,
      userFields,
      profileFields,
      syncHash: computeCoordinatorSyncHash({userFields, profileFields}),
    });
  }

  return prepared;
};

/** The HHAeXchange provenance stamped onto every profile sync writes. */
const buildProvenance = ({entry}) => ({
  hhaSyncHash: entry.syncHash,
  hhaLastSyncedAt: getCurrentTime(),
});

/**
 * Refresh one case manager whose HHAeXchange-owned fields changed.
 *
 * Two statements, one transaction (see updateUserAndProfile): the user row and
 * the profile row must move together or a case manager ends up with tomorrow's
 * name and yesterday's status.
 */
const updateChangedCaseManager = async ({
  entry,
  existing,
  summary,
  extraProfileData = {},
  adoptedUserId = null,
}) => {
  const userData = toUpdatableCaseManagerUserFields({
    userFields: entry.userFields,
  });

  const profileData = Object.assign(
    {},
    entry.profileFields,
    buildProvenance({entry}),
    extraProfileData
  );

  let before;

  try {
    ({before} = await updateUserAndProfile({
      userId: existing.userId,
      organizationId: existing.organizationId,
      profileModel: modelConstants.MODELS.CASE_MANAGER_PROFILE,
      profileId: existing.id,

      // email is absent by construction -- see toUpdatableCaseManagerUserFields.
      userData,
      profileData,
    }));
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaCoordinatorId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return {success: false};
  }

  summary.updated += 1;

  recordProfileUpdate({
    summary,
    recordId: entry.hhaCoordinatorId,
    before,
    userData,
    profileData,
    fields: HHA_MANAGED_CASE_MANAGER_FIELDS,
    adoptedUserId,
  });

  // Archive is a PreventaTri decision. The record is refreshed but stays
  // archived -- deleted_at is never in the update payload.
  if (existing.isDeleted) {
    recordException({
      summary,
      recordId: entry.hhaCoordinatorId,
      type: HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CASE_MANAGER_UPDATED,
    });
  }

  return {success: true};
};

/**
 * Take over an existing PreventaTri case manager profile whose user owns this
 * HHAeXchange email.
 *
 * The caller checks isAdoptableProfile first, for the same reason as on
 * caregivers: two coordinators sharing one inbox must not fight over a profile.
 */
const adoptExistingProfile = async ({entry, profile, summary}) => {
  // The provenance stamp rides along in the SAME transaction as the field
  // update, so a profile can never end up carrying HHAeXchange's data without
  // the id that says where it came from -- which is exactly what
  // case_manager_profiles_hha_identity_check forbids.
  const {success} = await updateChangedCaseManager({
    entry,
    existing: profile,
    summary,
    extraProfileData: {
      source: CASE_MANAGER_SOURCES.HHA_EXCHANGE.value,
      hhaCoordinatorId: entry.hhaCoordinatorId,
    },
    adoptedUserId: profile.userId,
  });

  return {success};
};

/**
 * Import one case manager PreventaTri has never seen.
 *
 * Resolves the email first, because that is what decides whether this is a new
 * person, an existing case manager to adopt, or somebody else entirely.
 *
 * No bulk create, unlike patients: every create writes to users,
 * user_organizations, permissions and case_manager_profiles, so there is no
 * single-table batch to do. That is the cost of CaseManagerProfile being a User
 * satellite, and it is paid only for genuinely new case managers -- after the
 * first run this path is nearly always empty.
 */
const createNewCaseManager = async ({entry, organizationId, summary}) => {
  const {success: lookupSucceeded, doc: existingUser} =
    await findOrgUserByEmail({email: entry.userFields.email, organizationId});

  // A failed lookup must never masquerade as "no such user" -- that would try to
  // create a duplicate account.
  if (!lookupSucceeded) {
    recordException({
      summary,
      recordId: entry.hhaCoordinatorId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: null,
    });
    summary.failed += 1;

    return {success: false};
  }

  if (existingUser) {
    // includeDeleted: a soft-deleted case manager profile must be found and
    // adopted, or it is re-created as a duplicate on every run.
    const {success: profileLookupSucceeded, doc: profile} =
      await PrismaFactory.findOne({
        model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
        query: {userId: existingUser.id, organizationId},
        options: {bypassExtraQueries: true, includeDeleted: true},
        fieldsInclusion: {
          includeSpecificFields: [
            'id',
            'userId',
            HHA_COORDINATOR_ID_FIELD,
            'isDeleted',
          ],
        },
      });

    // A failed lookup is not "no profile": that would import a duplicate.
    if (!profileLookupSucceeded) {
      recordException({
        summary,
        recordId: entry.hhaCoordinatorId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: null,
      });
      summary.failed += 1;

      return {success: false};
    }

    if (
      isAdoptableProfile({
        profile,
        hhaIdField: HHA_COORDINATOR_ID_FIELD,
        hhaId: entry.hhaCoordinatorId,
      })
    ) {
      return await adoptExistingProfile({entry, profile, summary});
    }
  }

  // Null when somebody else logs in with this address: the person is not
  // imported until an admin gives them their own email.
  const userFields = await resolveImportUserFields({
    userFields: entry.userFields,
    holderUserId: existingUser?.id || null,
    resource: HHAX_SYNC_RESOURCES.COORDINATORS.value,
    hhaId: entry.hhaCoordinatorId,
    organizationId,
    summary,
  });

  if (!userFields) {
    summary.failed += 1;

    return {success: false};
  }

  try {
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Reused rather than reimplemented: this is the same helper the invite
        // flow uses, so an imported case manager gets the identical
        // UserOrganization + Permission setup. It sends no email -- the
        // invitation is a separate call the invite controller makes.
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: userFields,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.case_manager.value,
          tx,
        });

        const {success, error} =
          await CaseManagersServices.createCaseManagerProfile(
            Object.assign({}, entry.profileFields, buildProvenance({entry}), {
              userId: createdUser.id,
              organizationId,
              hhaCoordinatorId: entry.hhaCoordinatorId,
              source: CASE_MANAGER_SOURCES.HHA_EXCHANGE.value,
              tx,
            })
          );

        if (!success) {
          throw error || new Error('Case manager profile create failed');
        }
      },
    });
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaCoordinatorId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return {success: false};
  }

  await clearPendingImport({
    organizationId,
    resource: HHAX_SYNC_RESOURCES.COORDINATORS.value,
    hhaId: entry.hhaCoordinatorId,
  });

  summary.created += 1;

  recordProfileCreate({
    summary,
    recordId: entry.hhaCoordinatorId,
    userFields: entry.userFields,
    profileFields: entry.profileFields,
    fields: HHA_MANAGED_CASE_MANAGER_FIELDS,
  });

  return {success: true};
};

/**
 * Reconcile the whole coordinator roster.
 *
 * One read for the roster, one bulk touch for the unchanged majority, and
 * per-record work only where something actually differs -- the same shape as the
 * caregiver reconciler, minus the paging it does not need.
 *
 * @returns {Promise<{success: boolean}>}
 */
const processCoordinators = async ({records, organizationId, summary}) => {
  const prepared = prepareRecords({records, summary});

  if (prepared.length === 0) return {success: true};

  // hhaSyncHash MUST be requested explicitly. It is deliberately absent from the
  // CaseManagerProfile default field set (see modelSchemaConfig) because it is
  // internal state that never leaves the server -- but that also means a plain
  // read returns it as undefined, which would never match a freshly computed
  // hash and would send every record down the write path on every run.
  const {success: lookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
      query: {
        organizationId,
        hhaCoordinatorId: {
          in: prepared.map((entry) => entry.hhaCoordinatorId),
        },
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        includeSpecificFields: [
          'id',
          'userId',
          'hhaCoordinatorId',
          'hhaSyncHash',
          'isDeleted',
        ],
      },
    });

  // A failed lookup must never masquerade as an empty result: every record would
  // be classified as new and re-imported as a duplicate.
  if (!lookupSucceeded) {
    return {success: false};
  }

  const {unchangedIds, unchanged, toUpdate, toCreate} = splitPreparedByHash({
    prepared,
    existingDocs,
    hhaIdField: HHA_COORDINATOR_ID_FIELD,
  });

  // The unchanged majority costs exactly one statement for the whole roster:
  // nothing HHAeXchange owns has changed, so only the sync timestamp moves.
  await touchUnchanged({
    model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
    ids: unchangedIds,
  });
  summary.skipped += unchangedIds.length;

  await runInParallelGroups({
    items: toUpdate,
    keyOf: ({item}) => item.entry.hhaCoordinatorId,
    task: async ({item}) =>
      await updateChangedCaseManager({
        entry: item.entry,
        existing: item.existing,
        summary,
      }),
  });

  // Grouped by email, so people sharing one are still checked in turn.
  await runInParallelGroups({
    items: toCreate,
    keyOf: ({item}) => item.userFields.email,
    task: async ({item}) =>
      await createNewCaseManager({entry: item, organizationId, summary}),
  });

  await reconcileHhaEmails({
    pairs: unchanged.concat(toUpdate),
    organizationId,
    hhaIdField: HHA_COORDINATOR_ID_FIELD,
    summary,
  });

  return {success: true};
};

module.exports = class HhaCoordinatorSyncServices {
  /**
   * Import one case manager by id, outside a run: an admin has just given them
   * a login email. HHAeXchange has no single-coordinator call, so this reads
   * the roster (one call) and takes that one record.
   *
   * @returns {Promise<{success: boolean}>}
   */
  static async importOne({hhaId, organizationId}) {
    const summary = buildSummary({
      trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
      resource: HHAX_SYNC_RESOURCES.COORDINATORS.value,
      organizationId,
    });

    const {success, docs} = await HhaExchangeServices.fetchCoordinators({
      organizationId,
    });

    const record = success
      ? docs.find(
          (doc) =>
            normalizeValue({
              value: doc?.[HHAX_COORDINATOR_ELEMENTS.COORDINATOR_ID],
            }) === String(hhaId)
        )
      : null;

    if (!record) return {success: false};

    await processCoordinators({records: [record], organizationId, summary});

    return {success: summary.created > 0};
  }

  /**
   * Reconcile the agency-wide coordinator roster.
   *
   * One of the runners HhaSyncServices.runSync iterates. The lock, the
   * organization resolution and the summary lifecycle belong to the
   * orchestrator; this only reads the roster and writes.
   *
   * `modifiedAfter` is deliberately absent from the signature even though the
   * orchestrator passes it -- GetCoordinators has no such filter. Writes are
   * gated on hhaSyncHash instead, so a full roster read costs one statement per
   * run when nothing changed.
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {Object} params.summary - Mutated in place with the counters.
   * @returns {Promise<{success: boolean, error: Object|null}>}
   */
  static async runResourceSync({organizationId, summary}) {
    const {success, docs, error} = await HhaExchangeServices.fetchCoordinators({
      organizationId,
    });

    if (!success) return {success: false, error};

    const outcome = await processCoordinators({
      records: docs,
      organizationId,
      summary,
    });

    if (!outcome.success) {
      return {
        success: false,
        error: {reason: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED},
      };
    }

    // A successful call that returned nobody is NOT a failure -- an agency may
    // genuinely have no coordinators -- but it is worth one log line, because
    // the far likelier cause is that the response element name moved and
    // fetchCoordinators unwrapped an empty list.
    if (summary.seen === 0) {
      logger.warn('[HHA Sync] Coordinator roster returned no records');
    }

    return {success: true, error: null};
  }
};
