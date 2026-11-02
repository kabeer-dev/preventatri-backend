/**
 * HHAeXchange -> PreventaTri caregiver reconciliation.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * Sibling of hhaPatientSyncServices and follows the same rules — agency-wide
 * feed with OfficeID omitted, full pass, writes gated on hhaSyncHash, and only
 * the fields in HHA_MANAGED_CAREGIVER_FIELDS ever written. relationshipToPatient,
 * preferredContactMethod, notes, onCallIndicator and the patient assignments are
 * PreventaTri-owned and never appear in a payload this module builds.
 *
 * ONE STRUCTURAL DIFFERENCE FROM PATIENTS, and it shapes everything below: a
 * CaregiverProfile is a satellite of User. Names, phone and address live on
 * `users`; discipline, status, language and the dates live on
 * `caregiver_profiles`. So a changed caregiver cannot be one UPDATE the way a
 * changed patient can — it is two, wrapped in a transaction so a half-applied
 * caregiver is impossible.
 *
 * Identity is `email`, and it is the delicate part:
 *  - HHAeXchange treats it as optional, but User.email is NOT NULL and unique
 *    per organization, so a missing address is replaced with a non-routable
 *    placeholder rather than costing us the caregiver (see caregiverMapper).
 *  - It stays out of the hash-gated update. reconcileHhaEmails moves it to a
 *    new HHA address, and keeps the current one when HHA has none or another
 *    account already owns it.
 *  - When the address already belongs to somebody here, sync refuses to guess.
 *    It adopts only a caregiver profile that is unclaimed or already this
 *    caregiver's; anything else is skipped with a DUPLICATE_EMAIL exception,
 *    because both alternatives silently rewrite a real person's identity.
 *
 * Sync deliberately sends NO invitation. addUserToSystem creates the user, the
 * org membership and the permissions but mails nothing — the invite controller
 * sends the email in a separate call this module simply does not make. An
 * imported caregiver therefore exists, unverified, until an admin invites them.
 */

const CaregiversServices = require('./caregiversServices');
const HhaExchangeServices = require('./hhaExchangeServices');

const {CAREGIVER_SOURCES} = require('../constants/caregiversConstants');

const {
  HHA_MANAGED_CAREGIVER_FIELDS,
  HHAX_CAREGIVER_ELEMENTS,
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
  mapHhaCaregiver,
  toCaregiverFeedRecord,
  computeCaregiverSyncHash,
  toUpdatableUserFields,
} = require('../utils/hhaExchange/caregiverMapper');

const {normalizeValue} = require('../utils/hhaExchange/soapClient');

const {
  buildRunContext,
  buildSummary,
  markRecordSeen,
  recordException,
  walkPagedFeed,
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
const HHA_CAREGIVER_ID_FIELD = 'hhaCaregiverId';

/**
 * Map and fingerprint one page, without touching the database.
 *
 * @returns {Object[]} One prepared entry per importable record.
 */
const prepareRecords = ({records, languageNamesById, nurseIds, summary}) => {
  const prepared = [];

  for (const record of records) {
    // HHAeXchange lists nurses inside this feed. The nurse runner already
    // reconciled every id on the roster, so those records are not seen,
    // skipped or counted here at all -- they are simply not caregivers.
    const feedId = normalizeValue({
      value: record[HHAX_CAREGIVER_ELEMENTS.CAREGIVER_ID],
    });

    if (feedId && nurseIds.has(feedId)) continue;

    summary.seen += 1;

    const {hhaCaregiverId, userFields, profileFields, exceptions, isValid} =
      mapHhaCaregiver({record, languageNamesById});

    markRecordSeen({summary, recordId: hhaCaregiverId});

    if (!hhaCaregiverId) {
      recordException({
        summary,
        recordId: null,
        type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_CAREGIVER_ID,
      });
      summary.failed += 1;

      continue;
    }

    exceptions.forEach((exception) =>
      recordException({
        summary,
        recordId: hhaCaregiverId,
        type: exception.type,
        detail: exception.detail,
      })
    );

    // firstName / lastName back a User row that must be identifiable. Skipping
    // beats letting the insert fail, so one incomplete record never costs the
    // rest of the page.
    if (!isValid) {
      summary.failed += 1;

      continue;
    }

    prepared.push({
      hhaCaregiverId,
      userFields,
      profileFields,
      syncHash: computeCaregiverSyncHash({userFields, profileFields}),
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
 * Refresh one caregiver whose HHAeXchange-owned fields changed.
 *
 * Two statements, one transaction (see updateUserAndProfile): the user row and
 * the profile row must move together or a caregiver ends up with tomorrow's
 * name and yesterday's status.
 */
const updateChangedCaregiver = async ({
  entry,
  existing,
  summary,
  extraProfileData = {},
  adoptedUserId = null,
}) => {
  const userData = toUpdatableUserFields({userFields: entry.userFields});

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
      profileModel: modelConstants.MODELS.CAREGIVER_PROFILE,
      profileId: existing.id,

      // email is absent by construction — see toUpdatableUserFields.
      userData,
      profileData,
    }));
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaCaregiverId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return;
  }

  summary.updated += 1;

  recordProfileUpdate({
    summary,
    recordId: entry.hhaCaregiverId,
    before,
    userData,
    profileData,
    fields: HHA_MANAGED_CAREGIVER_FIELDS,
    adoptedUserId,
  });

  // Archive is a PreventaTri decision. The record is refreshed but stays
  // archived — deleted_at is never in the update payload.
  if (existing.isDeleted) {
    recordException({
      summary,
      recordId: entry.hhaCaregiverId,
      type: HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_CAREGIVER_UPDATED,
    });
  }
};

/**
 * Take over an existing PreventaTri caregiver profile whose user owns this
 * HHAeXchange email.
 *
 * The caller checks isAdoptableProfile first: two HHAeXchange caregivers with
 * one email are realistic, and adopting a claimed profile would flip its
 * hhaCaregiverId between them on every run.
 */
const adoptExistingProfile = async ({entry, profile, summary}) => {
  // The provenance stamp rides along in the SAME transaction as the field
  // update, so a profile can never end up carrying HHAeXchange's data without
  // the id that says where it came from -- which is exactly what
  // caregiver_profiles_hha_identity_check forbids.
  await updateChangedCaregiver({
    entry,
    existing: profile,
    summary,
    extraProfileData: {
      source: CAREGIVER_SOURCES.HHA_EXCHANGE.value,
      hhaCaregiverId: entry.hhaCaregiverId,
    },
    adoptedUserId: profile.userId,
  });
};

/**
 * Import one caregiver PreventaTri has never seen.
 *
 * Resolves the email first, because that is what decides whether this is a new
 * person, an existing caregiver to adopt, or somebody else entirely.
 *
 * No bulk createMany here, unlike patients: every create writes to users,
 * user_organizations, permissions and caregiver_profiles, so there is no
 * single-table batch to do. That is the cost of CaregiverProfile being a User
 * satellite, and it is paid only for genuinely new caregivers — after the first
 * run this path is nearly always empty.
 */
const createNewCaregiver = async ({entry, organizationId, summary}) => {
  const {success: lookupSucceeded, doc: existingUser} =
    await findOrgUserByEmail({email: entry.userFields.email, organizationId});

  // A failed lookup must never masquerade as "no such user" — that would try to
  // create a duplicate account.
  if (!lookupSucceeded) {
    recordException({
      summary,
      recordId: entry.hhaCaregiverId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: null,
    });
    summary.failed += 1;

    return;
  }

  if (existingUser) {
    // includeDeleted: a soft-deleted caregiver profile must be found and
    // adopted, or it is re-created as a duplicate on every run.
    const {success: profileLookupSucceeded, doc: profile} =
      await PrismaFactory.findOne({
        model: modelConstants.MODELS.CAREGIVER_PROFILE,
        query: {userId: existingUser.id, organizationId},
        options: {bypassExtraQueries: true, includeDeleted: true},
        fieldsInclusion: {
          includeSpecificFields: [
            'id',
            'userId',
            HHA_CAREGIVER_ID_FIELD,
            'isDeleted',
          ],
        },
      });

    // A failed lookup is not "no profile": that would import a duplicate.
    if (!profileLookupSucceeded) {
      recordException({
        summary,
        recordId: entry.hhaCaregiverId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: null,
      });
      summary.failed += 1;

      return;
    }

    if (
      isAdoptableProfile({
        profile,
        hhaIdField: HHA_CAREGIVER_ID_FIELD,
        hhaId: entry.hhaCaregiverId,
      })
    ) {
      await adoptExistingProfile({entry, profile, summary});

      return;
    }
  }

  // Null when somebody else logs in with this address: the person is not
  // imported until an admin gives them their own email.
  const userFields = await resolveImportUserFields({
    userFields: entry.userFields,
    holderUserId: existingUser?.id || null,
    resource: HHAX_SYNC_RESOURCES.CAREGIVERS.value,
    hhaId: entry.hhaCaregiverId,
    organizationId,
    summary,
  });

  if (!userFields) {
    summary.failed += 1;

    return;
  }

  try {
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Reused rather than reimplemented: this is the same helper the invite
        // flow uses, so an imported caregiver gets the identical
        // UserOrganization + Permission setup. It sends no email — the
        // invitation is a separate call the invite controller makes.
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: userFields,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.caregiver.value,
          tx,
        });

        const {success, error} =
          await CaregiversServices.createCaregiverProfile(
            Object.assign({}, entry.profileFields, buildProvenance({entry}), {
              userId: createdUser.id,
              organizationId,
              hhaCaregiverId: entry.hhaCaregiverId,
              source: CAREGIVER_SOURCES.HHA_EXCHANGE.value,
              tx,
            })
          );

        if (!success) {
          throw error || new Error('Caregiver profile create failed');
        }
      },
    });
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaCaregiverId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return;
  }

  await clearPendingImport({
    organizationId,
    resource: HHAX_SYNC_RESOURCES.CAREGIVERS.value,
    hhaId: entry.hhaCaregiverId,
  });

  summary.created += 1;

  recordProfileCreate({
    summary,
    recordId: entry.hhaCaregiverId,
    userFields: entry.userFields,
    profileFields: entry.profileFields,
    fields: HHA_MANAGED_CAREGIVER_FIELDS,
  });
};

/**
 * Reconcile one page of the caregiver change feed.
 *
 * One read for the whole page, one bulk touch for the unchanged majority, and
 * per-record work only where something actually differs — the same shape as the
 * patient reconciler, minus the batched create it cannot use.
 */
const processCaregiverPage = async ({
  records,
  organizationId,
  languageNamesById,
  nurseIds,
  summary,
}) => {
  const prepared = prepareRecords({
    records,
    languageNamesById,
    nurseIds,
    summary,
  });

  if (prepared.length === 0) return {success: true};

  // hhaSyncHash MUST be requested explicitly. It is deliberately absent from the
  // CaregiverProfile default field set (see modelSchemaConfig) because it is
  // internal state that never leaves the server — but that also means a plain
  // read returns it as undefined, which would never match a freshly computed
  // hash and would send every record down the write path on every run.
  const {success: lookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.CAREGIVER_PROFILE,
      query: {
        organizationId,
        hhaCaregiverId: {in: prepared.map((entry) => entry.hhaCaregiverId)},
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        includeSpecificFields: [
          'id',
          'userId',
          'hhaCaregiverId',
          'hhaSyncHash',
          'isDeleted',
        ],
      },
    });

  // A failed lookup must never masquerade as an empty result: every record on
  // the page would be classified as new and re-imported as a duplicate.
  if (!lookupSucceeded) {
    return {success: false};
  }

  const {unchangedIds, unchanged, toUpdate, toCreate} = splitPreparedByHash({
    prepared,
    existingDocs,
    hhaIdField: HHA_CAREGIVER_ID_FIELD,
  });

  // The unchanged majority costs exactly one statement for the whole page:
  // nothing HHAeXchange owns has changed, so only the sync timestamp moves.
  await touchUnchanged({
    model: modelConstants.MODELS.CAREGIVER_PROFILE,
    ids: unchangedIds,
  });
  summary.skipped += unchangedIds.length;

  await runInParallelGroups({
    items: toUpdate,
    keyOf: ({item}) => item.entry.hhaCaregiverId,
    task: async ({item}) =>
      await updateChangedCaregiver({
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
      await createNewCaregiver({entry: item, organizationId, summary}),
  });

  await reconcileHhaEmails({
    pairs: unchanged.concat(toUpdate),
    organizationId,
    hhaIdField: HHA_CAREGIVER_ID_FIELD,
    summary,
  });

  return {success: true};
};

module.exports = class HhaCaregiverSyncServices {
  /**
   * Import one caregiver by id, outside a run: an admin has just given them a
   * login email. One GetCaregiverDemographics call instead of the whole feed.
   *
   * @returns {Promise<{success: boolean}>}
   */
  static async importOne({hhaId, organizationId}) {
    const summary = buildSummary({
      trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
      resource: HHAX_SYNC_RESOURCES.CAREGIVERS.value,
      organizationId,
    });

    const {success, doc} = await HhaExchangeServices.fetchCaregiverDemographics(
      {caregiverId: hhaId}
    );

    if (!success || !doc) return {success: false};

    const {languageNamesById} = await HhaExchangeServices.fetchLanguages();

    await processCaregiverPage({
      records: [toCaregiverFeedRecord({demographics: doc})],
      organizationId,
      languageNamesById,
      nurseIds: new Set(),
      summary,
    });

    return {success: summary.created > 0};
  }

  /**
   * Reconcile every page of the agency-wide caregiver change feed.
   *
   * One of the runners HhaSyncServices.runSync iterates. The lock, the
   * organization resolution and the summary lifecycle belong to the
   * orchestrator; this only walks the feed and writes.
   *
   * Depends on the nurse runner having gone first (see HHAX_SYNC_RESOURCES):
   * HHAeXchange lists nurses inside this feed, and only the nurse roster can
   * tell them apart. Without `runContext.nurseIds` this runner cannot classify
   * a single record, so it declines rather than re-import every nurse as a
   * caregiver -- the caregiver resource fails for the run, patients and case
   * managers are unaffected.
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {string} params.modifiedAfter - Already formatted per HHAX_MODIFIED_AFTER_FORMAT.
   * @param {Object} params.summary - Mutated in place with the counters.
   * @param {Object} params.runContext - Shared with the other runners; read
   *   for `nurseIds`.
   * @returns {Promise<{success: boolean, error: Object|null}>}
   */
  static async runResourceSync({
    organizationId,
    modifiedAfter,
    summary,
    runContext = buildRunContext(),
  }) {
    if (runContext.nurseIds === null) {
      return {
        success: false,
        error: {reason: HHAX_SYNC_EXCEPTION_TYPES.NURSE_ROSTER_UNAVAILABLE},
      };
    }

    // Once per run, not per page or per record: Language1 on the change feed is
    // a numeric LanguageID and the agency's master list is what turns it into a
    // name. A failure here is NOT fatal — every caregiver language then records
    // an UNMAPPED_LANGUAGE exception and the rest of the record still imports,
    // which beats failing a whole roster over one lookup call.
    const {success: languagesResolved, languageNamesById} =
      await HhaExchangeServices.fetchLanguages();

    if (!languagesResolved) {
      logger.warn(
        '[HHA Sync] Language list unavailable — caregiver languages will not be mapped this run'
      );
    }

    return await walkPagedFeed({
      fetchPage: async ({pageNumber}) =>
        await HhaExchangeServices.fetchCaregiverChanges({
          modifiedAfter,
          pageNumber,
        }),
      processPage: async ({records}) =>
        await processCaregiverPage({
          records,
          organizationId,
          languageNamesById,
          nurseIds: runContext.nurseIds,
          summary,
        }),
    });
  }
};
