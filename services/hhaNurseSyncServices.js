/**
 * HHAeXchange -> PreventaTri nurse reconciliation.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * HHAeXchange has no nurse feed. GetNurses is a thin roster -- id, name,
 * offices, Active -- so this runner reads it once to learn WHO the nurses are,
 * then fetches each one's GetCaregiverDemographics (NurseID === CaregiverID)
 * for the address, email, phone, licence number and NPI the roster lacks.
 *
 * `runContext.nurseIds` is the roster's id set. The caregiver runner skips
 * those ids, and refuses to run at all while the set is null (roster
 * unavailable), because importing a nurse as a caregiver is the one mistake
 * this integration must never make twice -- hence NURSES precedes CAREGIVERS.
 *
 * PRIMARY REGION: after the people are reconciled, each HHA nurse's address
 * ZIP resolves to a county and so a region. While it resolves, that region is
 * the nurse's only PRIMARY region and isPrimaryRegionHhaManaged locks it; when
 * it does not, the flag drops and an admin may set primaries. Secondary regions
 * are never touched.
 *
 * RECLASSIFICATION: before the roster was consulted, the caregiver runner
 * imported every nurse as a caregiver (they carry an RN discipline and look
 * like any other caregiver on the wire). When this runner meets a roster nurse
 * whose id already owns an HHA-sourced caregiver_profiles row, it converts the
 * account in ONE transaction: the user keeps its id, email and login, the org
 * membership flips to the nurse role with nurse permissions, a nurse profile
 * is created, and the caregiver profile is HARD-deleted (cascading its patient
 * links) -- it was sync's own mistake, not an admin's archive decision, so it
 * must not linger as an archived caregiver.
 *
 * Everything else follows the caregiver rules through userProfileSyncUtils:
 * hash-gated writes, only HHA_MANAGED_NURSE_FIELDS ever written, email
 * matched second and only to adopt an unclaimed nurse profile, archived rows
 * updated in place. Sync sends NO invitation: an imported nurse exists
 * unverified until an admin reviews it and fills in the licence expiration
 * date HHAeXchange never publishes.
 */

const CountiesServices = require('./countiesServices');
const HhaExchangeServices = require('./hhaExchangeServices');
const NursesServices = require('./nursesServices');

const {CAREGIVER_SOURCES} = require('../constants/caregiversConstants');

const {
  HHA_MANAGED_NURSE_FIELDS,
  HHA_SYNC_CHANGE_ACTIONS,
  HHA_SYNC_CHANGE_FIELDS,
  HHAX_NURSE_ELEMENTS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
  HHAX_SYNC_TRIGGERS,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');

const {
  NURSE_SOURCES,
  NURSE_REGION_ROLES,
} = require('../constants/nursesConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const {UsersControllerHelpers} = require('../helpers');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');
const {resolveCountyFromZip} = require('../utils/hhaExchange/countyResolver');

const {
  mapHhaNurse,
  computeNurseSyncHash,
  toUpdatableNurseUserFields,
} = require('../utils/hhaExchange/nurseMapper');
const {normalizeValue} = require('../utils/hhaExchange/soapClient');

const {
  buildRunContext,
  buildSummary,
  markRecordSeen,
  recordChange,
  recordException,
} = require('../utils/hhaExchange/syncRunUtils');

const {
  splitPreparedByHash,
  touchUnchanged,
  recordProfileCreate,
  recordProfileUpdate,
  updateUserAndProfile,
  reconcileHhaEmails,
  findOrgUserByEmail,
  resolveImportUserFields,
  runInParallelGroups,
  clearPendingImport,
  isAdoptableProfile,
} = require('../utils/hhaExchange/userProfileSyncUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

/** The field name the shared split helper matches profiles on. */
const HHA_NURSE_ID_FIELD = 'hhaNurseId';

/** Profile columns every nurse lookup below asks for. */
const NURSE_LOOKUP_FIELDS = [
  'id',
  'userId',
  HHA_NURSE_ID_FIELD,
  'hhaSyncHash',
  'isDeleted',
];

/**
 * GetNurses roster -> Map<NurseID, roster node>.
 *
 * Entries without an id are dropped and reported: there is nothing to match
 * them against.
 */
const buildRosterById = ({docs, summary}) => {
  const rosterById = new Map();

  for (const nurse of docs) {
    const nurseId = normalizeValue({
      value: nurse?.[HHAX_NURSE_ELEMENTS.NURSE_ID],
    });

    if (!nurseId) {
      recordException({
        summary,
        recordId: null,
        type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_CAREGIVER_ID,
      });

      continue;
    }

    rosterById.set(nurseId, nurse);
  }

  return rosterById;
};

/**
 * Fetch each roster nurse's demographics, one call per nurse. A failed call is
 * reported and skipped: the roster alone cannot create or refresh a nurse.
 *
 * @returns {{items: Object[], failed: number}} `items` pairs roster and record.
 */
const fetchNurseDemographics = async ({rosterById, summary}) => {
  const items = [];
  let failed = 0;

  await runInParallelGroups({
    items: Array.from(rosterById.entries()),
    keyOf: ({item}) => item[0],
    task: async ({item}) => {
      const [nurseId, rosterEntry] = item;

      const {success, doc} =
        await HhaExchangeServices.fetchCaregiverDemographics({
          caregiverId: nurseId,
        });

      if (!success || !doc) {
        failed += 1;
        summary.seen += 1;
        markRecordSeen({summary, recordId: nurseId});
        summary.failed += 1;

        recordException({
          summary,
          recordId: nurseId,
          type: HHAX_SYNC_EXCEPTION_TYPES.NURSE_DEMOGRAPHICS_UNAVAILABLE,
        });

        return;
      }

      items.push({rosterEntry, record: doc});
    },
  });

  return {items, failed};
};

/**
 * Map and fingerprint the nurses, without touching the database.
 *
 * @returns {Object[]} One prepared entry per importable record.
 */
const prepareRecords = ({items, summary}) => {
  const prepared = [];

  for (const {rosterEntry, record} of items) {
    summary.seen += 1;

    const {hhaNurseId, userFields, profileFields, exceptions, isValid} =
      mapHhaNurse({record, rosterEntry});

    markRecordSeen({summary, recordId: hhaNurseId});

    exceptions.forEach((exception) =>
      recordException({
        summary,
        recordId: hhaNurseId,
        type: exception.type,
        detail: exception.detail,
      })
    );

    // firstName / lastName back a User row that must be identifiable.
    if (!isValid) {
      summary.failed += 1;

      continue;
    }

    prepared.push({
      hhaNurseId,
      userFields,
      profileFields,
      syncHash: computeNurseSyncHash({userFields, profileFields}),
    });
  }

  return prepared;
};

/** The HHAeXchange provenance stamped onto every profile sync writes. */
const buildProvenance = ({entry}) => ({
  hhaSyncHash: entry.syncHash,
  hhaLastSyncedAt: getCurrentTime(),
});

/** The provenance PLUS the identity, for a profile sync is claiming. */
const buildClaim = ({entry}) =>
  Object.assign({}, buildProvenance({entry}), {
    source: NURSE_SOURCES.HHA_EXCHANGE.value,
    hhaNurseId: entry.hhaNurseId,
  });

/**
 * Refresh one nurse whose HHAeXchange-owned fields changed. Two statements,
 * one transaction (see updateUserAndProfile).
 */
const updateChangedNurse = async ({
  entry,
  existing,
  summary,
  extraProfileData = {},
  adoptedUserId = null,
}) => {
  const userData = toUpdatableNurseUserFields({userFields: entry.userFields});

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
      profileModel: modelConstants.MODELS.NURSE_PROFILE,
      profileId: existing.id,

      // email is absent by construction -- see toUpdatableNurseUserFields.
      userData,
      profileData,
    }));
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return {success: false};
  }

  summary.updated += 1;

  recordProfileUpdate({
    summary,
    recordId: entry.hhaNurseId,
    before,
    userData,
    profileData,
    fields: HHA_MANAGED_NURSE_FIELDS,
    adoptedUserId,
  });

  // Archive is a PreventaTri decision. The record is refreshed but stays
  // archived -- deleted_at is never in the update payload.
  if (existing.isDeleted) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_NURSE_UPDATED,
    });
  }

  return {success: true};
};

/**
 * Take over an existing PreventaTri nurse profile whose user owns this
 * HHAeXchange email. The caller checks isAdoptableProfile first, exactly like
 * the caregiver adoption.
 */
const adoptExistingProfile = async ({entry, profile, summary}) => {
  return await updateChangedNurse({
    entry,
    existing: profile,
    summary,
    extraProfileData: buildClaim({entry}),
    adoptedUserId: profile.userId,
  });
};

/**
 * Convert an account the caregiver runner imported before the roster existed.
 *
 * One transaction, four steps, and the order matters: the role flip and the
 * permission reset come first so a failure there leaves the caregiver row
 * untouched; the caregiver row is deleted LAST so no window exists in which
 * the person has neither profile.
 */
const reclassifyCaregiverAsNurse = async ({
  entry,
  caregiverProfile,
  organizationId,
  summary,
}) => {
  try {
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        // Same helper the invite flow uses, in its "already a member" mode:
        // updates user_organizations.role and recalculates the permission
        // levels for the nurse role. Sends nothing.
        await UsersControllerHelpers.addUserToSystem({
          existingUserPrismaDoc: {id: caregiverProfile.userId},
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.nurse.value,
          isExistingOrgMember: true,
          tx,
        });

        const {success: userUpdated, error: userError} =
          await PrismaFactory.updateOne({
            model: modelConstants.MODELS.USER,
            query: {id: caregiverProfile.userId},
            data: toUpdatableNurseUserFields({userFields: entry.userFields}),
            options: {bypassExtraQueries: true, includeDeleted: true},
            tx,
          });

        if (!userUpdated) throw userError || new Error('User update failed');

        // A nurse profile may already exist for this user -- typically one an
        // admin archived before the caregiver import happened. Claim it in
        // place rather than creating a second row.
        const {
          success: nurseProfileLookupSucceeded,
          doc: existingNurseProfile,
          error: nurseProfileLookupError,
        } = await PrismaFactory.findOne({
          model: modelConstants.MODELS.NURSE_PROFILE,
          query: {userId: caregiverProfile.userId, organizationId},
          options: {bypassExtraQueries: true, includeDeleted: true},
          fieldsInclusion: {includeSpecificFields: NURSE_LOOKUP_FIELDS},
          tx,
        });

        // A failed lookup must roll the transaction back, not be read as
        // "no profile yet" and create a second row.
        if (!nurseProfileLookupSucceeded) {
          throw (
            nurseProfileLookupError || new Error('Nurse profile lookup failed')
          );
        }

        const profileData = Object.assign(
          {},
          entry.profileFields,
          buildClaim({entry})
        );

        if (existingNurseProfile) {
          const {success: profileUpdated, error: profileError} =
            await PrismaFactory.updateOne({
              model: modelConstants.MODELS.NURSE_PROFILE,
              query: {id: existingNurseProfile.id},
              data: profileData,
              options: {bypassExtraQueries: true, includeDeleted: true},
              tx,
            });

          if (!profileUpdated) {
            throw profileError || new Error('Nurse profile update failed');
          }
        } else {
          const {success: profileCreated, error: profileError} =
            await NursesServices.createNurseProfile(
              Object.assign({}, profileData, {
                userId: caregiverProfile.userId,
                organizationId,
                tx,
              })
            );

          if (!profileCreated) {
            throw profileError || new Error('Nurse profile create failed');
          }
        }

        // Hard, not soft: a soft-deleted caregiver row would still sit under
        // unique_hha_caregiver_per_org and show as an archived caregiver.
        // caregiver_patients cascades at the database level.
        // success only says the statement ran; isDocumentDeleted says a row
        // went. A zero-row delete would commit a half-converted account.
        const {
          success: caregiverDeleted,
          isDocumentDeleted,
          error: deleteError,
        } = await PrismaFactory.hardDeleteOne({
          model: modelConstants.MODELS.CAREGIVER_PROFILE,
          query: {id: caregiverProfile.id},
          options: {bypassExtraQueries: true, includeDeleted: true},
          tx,
        });

        if (!caregiverDeleted || !isDocumentDeleted) {
          throw deleteError || new Error('Caregiver profile delete failed');
        }
      },
    });
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return {success: false};
  }

  summary.created += 1;
  recordException({
    summary,
    recordId: entry.hhaNurseId,
    type: HHAX_SYNC_EXCEPTION_TYPES.CAREGIVER_RECLASSIFIED_AS_NURSE,
    detail: caregiverProfile.id,
  });
  recordChange({
    summary,
    recordId: entry.hhaNurseId,
    action: HHA_SYNC_CHANGE_ACTIONS.RECLASSIFIED.value,
    changes: [
      {
        field: HHA_SYNC_CHANGE_FIELDS.CAREGIVER_PROFILE,
        from: caregiverProfile.id,
        to: null,
      },
    ],
  });

  return {success: true};
};

/**
 * Remove a mis-imported caregiver row for a nurse that already HAS a nurse
 * profile.
 *
 * The reclassify path above handles the common case (no nurse profile yet).
 * This covers the leftovers: a run that created the nurse profile but whose
 * caregiver delete was turned into a soft delete, or an environment where a
 * nurse was adopted by email while its caregiver row lived on. Either way the
 * caregiver row is sync's own mistake and is removed outright, so it never
 * surfaces as an archived caregiver or blocks unique_hha_caregiver_per_org.
 */
const purgeMisImportedCaregiver = async ({
  entry,
  caregiverProfile,
  summary,
}) => {
  const {success, isDocumentDeleted, error} = await PrismaFactory.hardDeleteOne(
    {
      model: modelConstants.MODELS.CAREGIVER_PROFILE,
      query: {id: caregiverProfile.id},
      options: {bypassExtraQueries: true, includeDeleted: true},
    }
  );

  // A statement that ran but removed nothing is a failure too: reporting it
  // as CAREGIVER_RECLASSIFIED_AS_NURSE would hide a row that is still there.
  if (!success || !isDocumentDeleted) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });

    return;
  }

  recordException({
    summary,
    recordId: entry.hhaNurseId,
    type: HHAX_SYNC_EXCEPTION_TYPES.CAREGIVER_RECLASSIFIED_AS_NURSE,
    detail: caregiverProfile.id,
  });
  recordChange({
    summary,
    recordId: entry.hhaNurseId,
    action: HHA_SYNC_CHANGE_ACTIONS.PURGED.value,
    changes: [
      {
        field: HHA_SYNC_CHANGE_FIELDS.CAREGIVER_PROFILE,
        from: caregiverProfile.id,
        to: null,
      },
    ],
  });
};

/**
 * Import one nurse PreventaTri has never seen under this id.
 *
 * Resolves the email first, because that is what decides whether this is a new
 * person, an existing nurse to adopt, or somebody else entirely. The
 * mis-imported-caregiver case never reaches here: processNurseBatch routes it
 * to reclassifyCaregiverAsNurse by id, which is the stronger match.
 */
const createNewNurse = async ({entry, organizationId, summary}) => {
  const {success: lookupSucceeded, doc: existingUser} =
    await findOrgUserByEmail({email: entry.userFields.email, organizationId});

  if (!lookupSucceeded) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: null,
    });
    summary.failed += 1;

    return {success: false};
  }

  if (existingUser) {
    const {success: profileLookupSucceeded, doc: profile} =
      await PrismaFactory.findOne({
        model: modelConstants.MODELS.NURSE_PROFILE,
        query: {userId: existingUser.id, organizationId},
        options: {bypassExtraQueries: true, includeDeleted: true},
        fieldsInclusion: {includeSpecificFields: NURSE_LOOKUP_FIELDS},
      });

    // A failed lookup is reported as such, not as a duplicate email, so the
    // operator is pointed at the real cause.
    if (!profileLookupSucceeded) {
      recordException({
        summary,
        recordId: entry.hhaNurseId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: null,
      });
      summary.failed += 1;

      return {success: false};
    }

    if (
      isAdoptableProfile({
        profile,
        hhaIdField: HHA_NURSE_ID_FIELD,
        hhaId: entry.hhaNurseId,
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
    resource: HHAX_SYNC_RESOURCES.NURSES.value,
    hhaId: entry.hhaNurseId,
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
        const createdUser = await UsersControllerHelpers.addUserToSystem({
          dataToCreateOrUpdate: userFields,
          organizationIdToAddTo: organizationId,
          role: SYSTEM_ROLES.nurse.value,
          tx,
        });

        const {success, error} = await NursesServices.createNurseProfile(
          Object.assign({}, entry.profileFields, buildClaim({entry}), {
            userId: createdUser.id,
            organizationId,
            tx,
          })
        );

        if (!success) {
          throw error || new Error('Nurse profile create failed');
        }
      },
    });
  } catch (error) {
    recordException({
      summary,
      recordId: entry.hhaNurseId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    });
    summary.failed += 1;

    return {success: false};
  }

  await clearPendingImport({
    organizationId,
    resource: HHAX_SYNC_RESOURCES.NURSES.value,
    hhaId: entry.hhaNurseId,
  });

  summary.created += 1;

  recordProfileCreate({
    summary,
    recordId: entry.hhaNurseId,
    userFields: entry.userFields,
    profileFields: entry.profileFields,
    fields: HHA_MANAGED_NURSE_FIELDS,
  });

  return {success: true};
};

/**
 * Reconcile the fetched nurses.
 *
 * Two reads for the whole batch -- the nurse profiles already stored and the
 * caregiver profiles that need reclassifying -- then one bulk touch for the
 * unchanged majority and per-record work only where something differs.
 */
const processNurseBatch = async ({items, organizationId, summary}) => {
  const prepared = prepareRecords({items, summary});

  if (prepared.length === 0) return {success: true};

  const ids = prepared.map((entry) => entry.hhaNurseId);

  // hhaSyncHash MUST be requested explicitly -- see the caregiver runner.
  const {success: nurseLookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.NURSE_PROFILE,
      query: {organizationId, hhaNurseId: {in: ids}},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {includeSpecificFields: NURSE_LOOKUP_FIELDS},
    });

  // The mis-import lookup is by HHA id, not by email: the caregiver runner
  // minted its placeholder emails under a different prefix, so an email match
  // would miss exactly the accounts this exists to fix.
  const {success: caregiverLookupSucceeded, docs: misImportedDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.CAREGIVER_PROFILE,
      query: {
        organizationId,
        hhaCaregiverId: {in: ids},
        source: CAREGIVER_SOURCES.HHA_EXCHANGE.value,
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        includeSpecificFields: ['id', 'userId', 'hhaCaregiverId'],
      },
    });

  // A failed lookup must never masquerade as an empty result: every record
  // would be classified as new and re-imported as a duplicate.
  if (!nurseLookupSucceeded || !caregiverLookupSucceeded) {
    return {success: false};
  }

  const misImportedById = new Map(
    misImportedDocs.map((doc) => [doc.hhaCaregiverId, doc])
  );

  const {unchangedIds, unchanged, toUpdate, toCreate} = splitPreparedByHash({
    prepared,
    existingDocs,
    hhaIdField: HHA_NURSE_ID_FIELD,
  });

  await touchUnchanged({
    model: modelConstants.MODELS.NURSE_PROFILE,
    ids: unchangedIds,
  });
  summary.skipped += unchangedIds.length;

  await runInParallelGroups({
    items: toUpdate,
    keyOf: ({item}) => item.entry.hhaNurseId,
    task: async ({item}) =>
      await updateChangedNurse({
        entry: item.entry,
        existing: item.existing,
        summary,
      }),
  });

  // A nurse profile already exists for these, so any caregiver row still
  // carrying the same HHA id is a leftover to remove, not an account to
  // convert.
  for (const {entry} of unchanged.concat(toUpdate)) {
    const caregiverProfile = misImportedById.get(entry.hhaNurseId);

    if (caregiverProfile) {
      await purgeMisImportedCaregiver({entry, caregiverProfile, summary});
    }
  }

  await reconcileHhaEmails({
    pairs: unchanged.concat(toUpdate),
    organizationId,
    hhaIdField: HHA_NURSE_ID_FIELD,
    summary,
  });

  // Grouped by email, so people sharing one are still checked in turn.
  await runInParallelGroups({
    items: toCreate,
    keyOf: ({item}) => item.userFields.email,
    task: async ({item}) => {
      const caregiverProfile = misImportedById.get(item.hhaNurseId);

      if (caregiverProfile) {
        await reclassifyCaregiverAsNurse({
          entry: item,
          caregiverProfile,
          organizationId,
          summary,
        });

        return;
      }

      await createNewNurse({entry: item, organizationId, summary});
    },
  });

  return {success: true};
};

/** The region ids a nurse currently holds as PRIMARY. */
const readPrimaryRegionIds = ({nurse}) =>
  (nurse.regionalNurses || [])
    .filter((row) => row.nurseRegionRole === NURSE_REGION_ROLES.PRIMARY)
    .map((row) => row.regionId);

const setPrimaryRegionFlag = async ({nurseProfileId, isManaged, tx}) => {
  const {success, error} = await PrismaFactory.updateOne({
    model: modelConstants.MODELS.NURSE_PROFILE,
    query: {id: nurseProfileId},
    data: {isPrimaryRegionHhaManaged: isManaged},
    options: {bypassExtraQueries: true},
    tx,
  });

  if (!success) throw error || new Error('Nurse region flag update failed');
};

/**
 * Make `regionId` the nurse's only PRIMARY region and lock it. Former primaries
 * are dropped, a SECONDARY row for the region is promoted, and patient slots
 * the nurse no longer covers are cleared -- the same path as an admin edit.
 */
const applyHhaPrimaryRegion = async ({nurse, regionId, organizationId}) =>
  await wrapWithPrismaTransaction({
    fn: async (tx) => {
      const {success, error} = await NursesServices.applyRegionAssignment({
        nurseProfileId: nurse.id,
        organizationId,
        primaryRegionIds: [regionId],
        tx,
      });

      if (!success) throw error || new Error('Nurse region update failed');

      await setPrimaryRegionFlag({
        nurseProfileId: nurse.id,
        isManaged: true,
        tx,
      });
    },
  });

/**
 * Derive every HHA nurse's PRIMARY region from their synced address.
 *
 * Runs over the stored rows rather than this run's roster, so a nurse whose
 * demographics call failed tonight still keeps a region that matches the
 * address already on file.
 */
const reconcilePrimaryRegions = async ({
  organizationId,
  countyLookup,
  summary,
}) => {
  const {success, docs} = await PrismaFactory.find({
    model: modelConstants.MODELS.NURSE_PROFILE,
    query: {organizationId, source: NURSE_SOURCES.HHA_EXCHANGE.value},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {
      include: {
        user: {select: {state: true, zipCode: true}},
        regionalNurses: {select: {regionId: true, nurseRegionRole: true}},
      },
    },
  });

  if (!success) {
    recordException({
      summary,
      recordId: null,
      type: HHAX_SYNC_EXCEPTION_TYPES.LINK_LOOKUP_FAILED,
    });

    return;
  }

  for (const nurse of docs) {
    const {regionId, exceptionType, detail} = resolveCountyFromZip({
      state: nurse.user?.state,
      zipCode: nurse.user?.zipCode,
      countyLookup,
    });

    try {
      if (!regionId) {
        if (exceptionType) {
          recordException({
            summary,
            recordId: nurse.hhaNurseId,
            type: exceptionType,
            detail,
          });
        }

        // Unresolvable: keep whatever primaries exist, hand them to the admin.
        if (nurse.isPrimaryRegionHhaManaged) {
          await setPrimaryRegionFlag({
            nurseProfileId: nurse.id,
            isManaged: false,
          });
        }

        continue;
      }

      const currentPrimaryIds = readPrimaryRegionIds({nurse});

      const isCurrent =
        nurse.isPrimaryRegionHhaManaged &&
        currentPrimaryIds.length === 1 &&
        currentPrimaryIds[0] === regionId;

      if (isCurrent) continue;

      await applyHhaPrimaryRegion({nurse, regionId, organizationId});
      summary.primaryRegionsChanged += 1;

      const previousPrimaries = currentPrimaryIds.join(', ') || null;

      // A lock-only change (same region, flag set) is not a history entry.
      if (previousPrimaries !== regionId) {
        recordChange({
          summary,
          recordId: nurse.hhaNurseId,
          action: HHA_SYNC_CHANGE_ACTIONS.LINK_CHANGED.value,
          changes: [
            {
              field: HHA_SYNC_CHANGE_FIELDS.PRIMARY_REGIONS,
              from: previousPrimaries,
              to: regionId,
            },
          ],
        });
      }
    } catch (error) {
      recordException({
        summary,
        recordId: nurse.hhaNurseId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: error?.code || null,
      });
    }
  }
};

module.exports = class HhaNurseSyncServices {
  /**
   * Import one nurse by id, outside a run: an admin has just given them a
   * login email. The roster (one call) supplies the status, one
   * GetCaregiverDemographics call the rest; regions follow on the next sync.
   *
   * @returns {Promise<{success: boolean}>}
   */
  static async importOne({hhaId, organizationId}) {
    const summary = buildSummary({
      trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
      resource: HHAX_SYNC_RESOURCES.NURSES.value,
      organizationId,
    });

    const {success, docs} = await HhaExchangeServices.fetchNurses();

    const rosterEntry = success
      ? buildRosterById({docs, summary}).get(String(hhaId))
      : null;

    if (!rosterEntry) return {success: false};

    const {items} = await fetchNurseDemographics({
      rosterById: new Map([[String(hhaId), rosterEntry]]),
      summary,
    });

    await processNurseBatch({items, organizationId, summary});

    return {success: summary.created > 0};
  }

  /**
   * Reconcile the agency's nurses: one roster read, one demographics call per
   * roster nurse, then the primary regions derived from their addresses.
   *
   * One of the runners HhaSyncServices.runSync iterates, and the one that has
   * to run BEFORE the caregiver runner (see the module docblock).
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {Object} params.summary - Mutated in place with the counters.
   * @param {Object} params.runContext - Shared with the other runners; this
   *   runner sets `nurseIds`.
   * @returns {Promise<{success: boolean, error: Object|null}>}
   */
  static async runResourceSync({
    organizationId,
    summary,
    runContext = buildRunContext(),
  }) {
    const {success, docs, error} = await HhaExchangeServices.fetchNurses();

    // nurseIds stays null: the caregiver runner reads that as "cannot
    // classify" and declines to run.
    if (!success) return {success: false, error};

    const rosterById = buildRosterById({docs, summary});

    // An empty roster is indistinguishable from a roster the parser missed
    // (an element renamed, say). Treat it as "cannot classify": nurseIds stays
    // null so the caregiver runner declines to run, rather than importing every
    // nurse in the feed as a caregiver again.
    if (rosterById.size === 0) {
      logger.warn('[HHA Sync] Nurse roster returned no records');

      return {
        success: false,
        error: {reason: HHAX_SYNC_EXCEPTION_TYPES.NURSE_ROSTER_UNAVAILABLE},
      };
    }

    runContext.nurseIds = new Set(rosterById.keys());

    const {items, failed} = await fetchNurseDemographics({rosterById, summary});

    // Every call failing is an outage (or a revoked method), not bad records.
    if (items.length === 0 && failed > 0) {
      return {
        success: false,
        error: {
          reason: HHAX_SYNC_EXCEPTION_TYPES.NURSE_DEMOGRAPHICS_UNAVAILABLE,
        },
      };
    }

    const outcome = await processNurseBatch({items, organizationId, summary});

    if (!outcome.success) {
      return {
        success: false,
        error: {reason: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED},
      };
    }

    const {success: countiesLoaded, countyLookup} =
      await CountiesServices.buildCountyLookupForOrganization({organizationId});

    if (!countiesLoaded) {
      logger.error(
        `[HhaNurseSync] could not load counties for organization ${organizationId}; primary regions left as they are`
      );

      return {success: true, error: null};
    }

    await reconcilePrimaryRegions({organizationId, countyLookup, summary});

    return {success: true, error: null};
  }
};
