/**
 * The reconciliation steps shared by every HHAeXchange import that lands on a
 * User satellite profile.
 *
 * Caregivers and case managers have the same structural problem and therefore
 * the same solution: one HHAeXchange record maps onto TWO tables, because both
 * CaregiverProfile and CaseManagerProfile are satellites of User. Names live on
 * `users`, the role-specific columns on the profile table, and the two must move
 * together or a person ends up with tomorrow's name and yesterday's status.
 *
 * Everything here is deliberately model-agnostic -- the profile model, the HHA
 * id field and the exception type names are parameters -- so the two reconcilers
 * share ONE implementation of the three-way hash split, the bulk touch, the
 * transactional two-table update and the org-scoped email lookup. Only the
 * fetch, the mapping and the create differ between them.
 *
 * `includeDeleted: true` is load-bearing on every read and write below. An
 * archived record must be found and updated IN PLACE, leaving deleted_at
 * untouched -- without it the soft-delete extension hides the row, the update
 * fails, and the admin's archive decision would appear to undo itself on every
 * nightly run.
 */

const {isPlaceholderEmail} = require('./placeholderEmailUtils');
const {diffFields, snapshotFields} = require('./syncChangeUtils');
const {recordChange, recordException} = require('./syncRunUtils');

const {getCurrentTime} = require('../dateUtils');
const {chunkArray, isDocumentDuplicationError} = require('../general');

const {wrapWithPrismaTransaction} = require('../prismaTransactionUtils');
const {buildEmailChangeInvalidation} = require('../userHelpers');
const {getFullName} = require('../userUtils');

const {
  HHA_EMAIL_CHANGE_SEPARATOR,
  HHA_EMAIL_NONE_LABEL,
  HHA_EMAIL_STORE_CONCURRENCY,
  HHA_SYNC_CHANGE_ACTIONS,
  HHA_SYNC_CHANGE_FIELDS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_WRITE_CONCURRENCY,
} = require('../../constants/hhaExchangeConstants');
const modelConstants = require('../../constants/modelConstants');
const {EMAIL_PATTERN} = require('../../constants/usersConstants');
const {HhaExchangeErrorsFactories} = require('../../factories/errors');
const PrismaFactory = require('../../factories/PrismaFactory');

/**
 * Split one page of prepared records into unchanged / changed / new.
 *
 * The hash is what gates writes: an unchanged roster produces zero field
 * updates, which is what makes a full pass affordable.
 *
 * @param {Object} params
 * @param {Object[]} params.prepared - Entries carrying `syncHash` and the id.
 * @param {Object[]} params.existingDocs - Profiles already stored, including
 *   soft-deleted ones.
 * @param {string} params.hhaIdField - 'hhaCaregiverId' or 'hhaCoordinatorId'.
 * @returns {{unchangedIds: string[], unchanged: Object[], toUpdate: Object[],
 *   toCreate: Object[]}} `unchangedIds` is the bulk-touch list; `unchanged`
 *   pairs each of those with its entry, for callers that still need the record
 *   itself (the nurse runner purges mis-imported caregivers for them).
 */
const splitPreparedByHash = ({prepared, existingDocs, hhaIdField}) => {
  const existingByHhaId = new Map(
    existingDocs.map((doc) => [doc[hhaIdField], doc])
  );

  const unchangedIds = [];
  const unchanged = [];
  const toUpdate = [];
  const toCreate = [];

  for (const entry of prepared) {
    const existing = existingByHhaId.get(entry[hhaIdField]);

    if (!existing) {
      toCreate.push(entry);

      continue;
    }

    if (existing.hhaSyncHash === entry.syncHash) {
      unchangedIds.push(existing.id);
      unchanged.push({entry, existing});

      continue;
    }

    toUpdate.push({entry, existing});
  }

  return {unchangedIds, unchanged, toUpdate, toCreate};
};

/**
 * Stamp the sync timestamp on the unchanged majority.
 *
 * One statement for the whole page: nothing HHAeXchange owns has changed, so
 * only hhaLastSyncedAt moves.
 *
 * @param {Object} params
 * @param {string} params.model - A modelConstants.MODELS value.
 * @param {string[]} params.ids - Profile ids to touch.
 */
const touchUnchanged = async ({model, ids}) => {
  if (ids.length === 0) return;

  // Thrown rather than swallowed: updateMany returns an envelope instead of
  // throwing, and a caller that counted these ids as "skipped" after a failed
  // write would report profiles as synced whose timestamp never moved. Letting
  // it surface marks the resource failed, which is what actually happened.
  const {success, error} = await PrismaFactory.updateMany({
    model,
    query: {id: {in: ids}},
    data: {hhaLastSyncedAt: getCurrentTime()},
    options: {bypassExtraQueries: true, includeDeleted: true},
  });

  if (!success) throw error;
};

/**
 * Write one record's user row and profile row inside a single transaction.
 *
 * Throws on failure rather than returning an envelope, so the caller decides
 * how to record it -- the two reconcilers count it differently.
 *
 * `userData` must already have the create-only fields removed (see
 * omitCreateOnlyFields): `email` is written by reconcileHhaEmails instead.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.profileModel - A modelConstants.MODELS value.
 * @param {string} params.profileId
 * @param {Object} params.userData - Updatable `users` columns.
 * @param {Object} params.profileData - Updatable profile columns, provenance
 *   included.
 * @returns {Promise<{before: Object}>} The written columns' previous values,
 *   read in the same transaction, for the change history.
 */
const updateUserAndProfile = async ({
  userId,
  profileModel,
  profileId,
  userData,
  profileData,
}) => {
  return await wrapWithPrismaTransaction({
    fn: async (tx) => {
      const {doc: userBefore} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER,
        query: {id: userId},
        options: {bypassExtraQueries: true, includeDeleted: true},
        fieldsInclusion: {includeSpecificFields: Object.keys(userData)},
        tx,
      });

      const {doc: profileBefore} = await PrismaFactory.findOne({
        model: profileModel,
        query: {id: profileId},
        options: {bypassExtraQueries: true, includeDeleted: true},
        fieldsInclusion: {includeSpecificFields: Object.keys(profileData)},
        tx,
      });

      // PrismaFactory directly rather than UsersServices.updateOne, which is a
      // pass-through to exactly this call. A util must not require a service:
      // every service already requires utils, and the edge would be a cycle
      // waiting for someone to export this module from utils/hhaExchange/index.
      const {success: userUpdated, error: userError} =
        await PrismaFactory.updateOne({
          model: modelConstants.MODELS.USER,
          query: {id: userId},
          data: userData,
          options: {bypassExtraQueries: true, includeDeleted: true},
          tx,
        });

      if (!userUpdated) throw userError || new Error('User update failed');

      const {success: profileUpdated, error: profileError} =
        await PrismaFactory.updateOne({
          model: profileModel,
          query: {id: profileId},
          data: profileData,
          options: {bypassExtraQueries: true, includeDeleted: true},
          tx,
        });

      if (!profileUpdated) {
        throw profileError || new Error('Profile update failed');
      }

      return {before: Object.assign({}, userBefore, profileBefore)};
    },
  });
};

/**
 * Record a refreshed person. An adoption also names the user it attached to,
 * so it is kept even when no field changed.
 */
const recordProfileUpdate = ({
  summary,
  recordId,
  before,
  userData,
  profileData,
  fields,
  adoptedUserId = null,
}) => {
  const changes = diffFields({
    before,
    after: Object.assign({}, userData, profileData),
    fields,
  });

  if (adoptedUserId) {
    recordChange({
      summary,
      recordId,
      action: HHA_SYNC_CHANGE_ACTIONS.ADOPTED.value,
      changes: [
        {field: HHA_SYNC_CHANGE_FIELDS.USER, from: null, to: adoptedUserId},
      ].concat(changes),
    });

    return;
  }

  recordChange({
    summary,
    recordId,
    action: HHA_SYNC_CHANGE_ACTIONS.UPDATED.value,
    changes,
  });
};

/** Record a newly imported person with the HHA-owned fields it was given. */
const recordProfileCreate = ({
  summary,
  recordId,
  userFields,
  profileFields,
  fields,
}) =>
  recordChange({
    summary,
    recordId,
    action: HHA_SYNC_CHANGE_ACTIONS.CREATED.value,
    changes: snapshotFields({
      after: Object.assign({}, userFields, profileFields),
      fields,
    }),
  });

/**
 * Find the user in THIS organization holding an address.
 *
 * Scoped to the organization deliberately: email is unique per org, so the same
 * address may legitimately exist under another org. bypassExtraQueries disables
 * ACL injection, and an email-only match could otherwise grab that other org's
 * user and mis-report the import as DUPLICATE_EMAIL forever.
 *
 * `success` is returned separately from `doc` because a FAILED lookup must never
 * masquerade as "no such user" -- that would try to create a duplicate account.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.organizationId
 * @returns {Promise<{success: boolean, doc: Object|null}>}
 */
const findOrgUserByEmail = async ({email, organizationId}) => {
  const {success, doc} = await PrismaFactory.findOne({
    model: modelConstants.MODELS.USER,
    query: {email, userOrganizations: {some: {organizationId}}},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {includeSpecificFields: ['id', 'email']},
  });

  return {success, doc: doc || null};
};

/** A same-role profile is adopted only when unclaimed or already this record's. */
const isAdoptableProfile = ({profile, hhaIdField, hhaId}) =>
  Boolean(profile) && (!profile[hhaIdField] || profile[hhaIdField] === hhaId);

/**
 * Run `task` for every item, a few groups at a time. Items sharing a key run
 * one after another: two new people with one email must not both see it free.
 *
 * @param {Object} params
 * @param {Object[]} params.items
 * @param {Function} params.keyOf - ({item}) => the key items are grouped by.
 * @param {Function} params.task - async ({item}) => void
 */
const runInParallelGroups = async ({items, keyOf, task}) => {
  const groups = new Map();

  items.forEach((item) => {
    const key = keyOf({item});

    if (!groups.has(key)) groups.set(key, []);

    groups.get(key).push(item);
  });

  for (const batch of chunkArray({
    items: Array.from(groups.values()),
    size: HHAX_SYNC_WRITE_CONCURRENCY,
  })) {
    await Promise.all(
      batch.map(async (group) => {
        for (const item of group) await task({item});
      })
    );
  }
};

/** HHAeXchange's own address for a person; null when sync minted a placeholder. */
const toHhaEmail = ({email}) => (isPlaceholderEmail({email}) ? null : email);

const findPendingImport = async ({organizationId, resource, hhaId}) =>
  await PrismaFactory.findOne({
    model: modelConstants.MODELS.HHA_PENDING_IMPORT,
    query: {organizationId, resource, hhaRecordId: hhaId},
    options: {bypassExtraQueries: true},
  });

/** Remember who is waiting for a unique email, for the Shared emails view. */
const savePendingImport = async ({
  pending,
  organizationId,
  resource,
  hhaId,
  userFields,
  hhaEmail,
}) => {
  const data = {name: getFullName({user: userFields}), hhaEmail};

  // A changed HHA address is a new question: the saved answer no longer applies.
  if (pending) {
    return await PrismaFactory.updateOne({
      model: modelConstants.MODELS.HHA_PENDING_IMPORT,
      query: {id: pending.id},
      data:
        pending.hhaEmail === hhaEmail
          ? data
          : Object.assign({loginEmail: null}, data),
      options: {bypassExtraQueries: true},
    });
  }

  return await PrismaFactory.create({
    model: modelConstants.MODELS.HHA_PENDING_IMPORT,
    data: Object.assign({organizationId, resource, hhaRecordId: hhaId}, data),
    options: {bypassExtraQueries: true},
  });
};

/** Drop the waiting entry of a person who has now been imported. */
const clearPendingImport = async ({organizationId, resource, hhaId}) => {
  await PrismaFactory.hardDeleteMany({
    model: modelConstants.MODELS.HHA_PENDING_IMPORT,
    query: {organizationId, resource, hhaRecordId: hhaId},
    options: {bypassExtraQueries: true},
  });
};

/**
 * The `users` columns for a new import, or null when the person must wait.
 *
 * A person whose HHA address belongs to someone else is NOT created: they are
 * kept as DUPLICATE_EMAIL until an admin gives them a login email, and the
 * next sync then imports them with it.
 *
 * @param {Object} params
 * @param {Object} params.userFields - From the mapper; `email` is HHA's or a placeholder.
 * @param {string|null} params.holderUserId - Who already logs in with the address.
 * @param {string} params.resource - An HHAX_SYNC_RESOURCES value.
 * @param {string} params.hhaId
 * @param {string} params.organizationId
 * @param {Object} params.summary
 * @returns {Promise<Object|null>}
 */
const resolveImportUserFields = async ({
  userFields,
  holderUserId = null,
  resource,
  hhaId,
  organizationId,
  summary,
}) => {
  const hhaEmail = toHhaEmail({email: userFields.email});

  if (!holderUserId) return Object.assign({}, userFields, {hhaEmail});

  const report = ({type, detail, relatedUserId = null}) =>
    recordException({summary, recordId: hhaId, type, detail, relatedUserId});

  const {success: found, doc: pending} = await findPendingImport({
    organizationId,
    resource,
    hhaId,
  });

  // Unknown is not "no answer yet": skip quietly and try again next run.
  if (!found) {
    report({type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED, detail: null});

    return null;
  }

  const loginEmail =
    pending?.hhaEmail === hhaEmail ? pending.loginEmail || null : null;

  const {success: lookedUp, doc: loginHolder} = loginEmail
    ? await findOrgUserByEmail({email: loginEmail, organizationId})
    : {success: true, doc: null};

  if (loginEmail && lookedUp && !loginHolder) {
    return Object.assign({}, userFields, {
      email: loginEmail,
      hhaEmail,
      isEmailAdminSet: true,
    });
  }

  await savePendingImport({
    pending,
    organizationId,
    resource,
    hhaId,
    userFields,
    hhaEmail,
  });

  report({
    type: HHAX_SYNC_EXCEPTION_TYPES.DUPLICATE_EMAIL,
    detail: hhaEmail,
    relatedUserId: holderUserId,
  });

  return null;
};

/** A taken address: DUPLICATE_EMAIL while the login is still the placeholder. */
const toTakenEmailType = ({user}) =>
  isPlaceholderEmail({email: user.email})
    ? HHAX_SYNC_EXCEPTION_TYPES.DUPLICATE_EMAIL
    : HHAX_SYNC_EXCEPTION_TYPES.EMAIL_IN_USE;

/** Apply one email change; a conflict is reported and the current email kept. */
const applyHhaEmail = async ({
  user,
  email,
  organizationId,
  recordId,
  summary,
}) => {
  const report = ({type, detail = null, relatedUserId = null}) =>
    recordException({summary, recordId, type, detail, relatedUserId});

  if (!EMAIL_PATTERN.test(email)) {
    return report({type: HHAX_SYNC_EXCEPTION_TYPES.INVALID_EMAIL});
  }

  const {success: lookedUp, doc: holder} = await findOrgUserByEmail({
    email,
    organizationId,
  });

  if (!lookedUp) return report({type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED});

  if (holder && holder.id !== user.id) {
    return report({
      type: toTakenEmailType({user}),
      detail: email,
      relatedUserId: holder.id,
    });
  }

  const {success, error} = await PrismaFactory.updateOne({
    model: modelConstants.MODELS.USER,
    query: {id: user.id},
    data: Object.assign({email}, buildEmailChangeInvalidation({user, email})),
    options: {bypassExtraQueries: true, includeDeleted: true},
  });

  // unique_email_per_org is keyed on primary_org_id, which the lookup above
  // does not see, so a duplicate can still surface here.
  if (!success) {
    const isTaken = isDocumentDuplicationError({error});

    return report({
      type: isTaken
        ? toTakenEmailType({user})
        : HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: isTaken ? email : error?.code || null,
    });
  }

  summary.emailsChanged += 1;

  recordChange({
    summary,
    recordId,
    action: HHA_SYNC_CHANGE_ACTIONS.EMAIL_CHANGED.value,
    changes: [
      {field: HHA_SYNC_CHANGE_FIELDS.EMAIL, from: user.email, to: email},
    ],
  });
};

/** Keep HHA's own address beside the login email; grouped by value. */
const storeHhaEmails = async ({stale, summary}) => {
  const idsByEmail = new Map();

  stale.forEach(({userId, hhaEmail}) => {
    if (!idsByEmail.has(hhaEmail)) idsByEmail.set(hhaEmail, []);

    idsByEmail.get(hhaEmail).push(userId);
  });

  // In parallel batches: one statement at a time made the first run after
  // this column was added take minutes per page.
  for (const batch of chunkArray({
    items: Array.from(idsByEmail.entries()),
    size: HHA_EMAIL_STORE_CONCURRENCY,
  })) {
    const outcomes = await Promise.all(
      batch.map(([hhaEmail, ids]) =>
        PrismaFactory.updateMany({
          model: modelConstants.MODELS.USER,
          query: {id: {in: ids}},
          data: {hhaEmail},
          options: {bypassExtraQueries: true, includeDeleted: true},
        })
      )
    );

    outcomes
      .filter(({success}) => !success)
      .forEach(({error}) =>
        recordException({
          summary,
          recordId: null,
          type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
          detail: error?.code || modelConstants.MODELS.USER,
        })
      );
  }
};

/**
 * Bring the login email of already-imported people in line with HHAeXchange.
 *
 * Not hash-gated, and email stays out of the hash. HHA's address is always
 * stored; the login follows it unless HHA has none or an admin typed one.
 *
 * @param {Object} params
 * @param {{entry: Object, existing: Object}[]} params.pairs - Profiles that
 *   already existed; `entry.userFields.email` is HHA's, `existing.userId` ours.
 * @param {string} params.organizationId
 * @param {string} params.hhaIdField - The entry key holding the HHA id.
 * @param {Object} params.summary - Mutated: emailsChanged and exceptions.
 */
const reconcileHhaEmails = async ({
  pairs,
  organizationId,
  hhaIdField,
  summary,
}) => {
  if (pairs.length === 0) return;

  const {success, docs: users} = await PrismaFactory.find({
    model: modelConstants.MODELS.USER,
    query: {id: {in: pairs.map(({existing}) => existing.userId)}},
    options: {bypassExtraQueries: true, includeDeleted: true},
    fieldsInclusion: {
      includeSpecificFields: [
        'id',
        'email',
        'hhaEmail',
        'isEmailAdminSet',
        'isVerified',
        'secretKeys',
      ],
    },
  });

  if (!success) {
    return recordException({
      summary,
      recordId: null,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: modelConstants.MODELS.USER,
    });
  }

  const usersById = new Map(users.map((user) => [user.id, user]));

  const known = pairs
    .map(({entry, existing}) => ({
      user: usersById.get(existing.userId),
      hhaEmail: toHhaEmail({email: entry.userFields.email}),
      recordId: entry[hhaIdField],
    }))
    .filter(({user}) => user);

  await storeHhaEmails({
    stale: known
      .filter(({user, hhaEmail}) => (user.hhaEmail || null) !== hhaEmail)
      .map(({user, hhaEmail}) => ({userId: user.id, hhaEmail})),
    summary,
  });

  // The admin's login email stays, so a change in HHA is reported, not applied.
  known
    .filter(
      ({user, hhaEmail}) =>
        user.isEmailAdminSet && (user.hhaEmail || null) !== hhaEmail
    )
    .forEach(({user, hhaEmail, recordId}) =>
      recordException({
        summary,
        recordId,
        type: HHAX_SYNC_EXCEPTION_TYPES.HHA_EMAIL_CHANGED,
        detail: [user.hhaEmail, hhaEmail]
          .map((email) => email || HHA_EMAIL_NONE_LABEL)
          .join(HHA_EMAIL_CHANGE_SEPARATOR),
      })
    );

  for (const {user, hhaEmail, recordId} of known) {
    if (!hhaEmail || user.isEmailAdminSet) continue;
    if (String(user.email).toLowerCase() === hhaEmail) continue;

    await applyHhaEmail({
      user,
      email: hhaEmail,
      organizationId,
      recordId,
      summary,
    });
  }
};

/**
 * Whether an admin may type a login email for an HHAeXchange person: while the
 * login is the placeholder, an admin already typed it, or HHA's address is
 * shared with someone (imported or still waiting).
 *
 * @param {Object} params
 * @param {{id, email, hhaEmail, isEmailAdminSet}} params.user
 * @param {string} params.organizationId
 * @returns {Promise<boolean>}
 */
const canAdminSetHhaEmail = async ({user, organizationId}) => {
  if (isPlaceholderEmail({email: user.email}) || user.isEmailAdminSet) {
    return true;
  }

  if (!user.hhaEmail) return false;

  const users = await PrismaFactory.countDocuments({
    model: modelConstants.MODELS.USER,
    query: {
      id: {not: user.id},
      userOrganizations: {some: {organizationId}},
      OR: [{hhaEmail: user.hhaEmail}, {email: user.hhaEmail}],
    },
    options: {bypassExtraQueries: true},
  });

  if (users.success && users.count > 0) return true;

  const waiting = await PrismaFactory.countDocuments({
    model: modelConstants.MODELS.HHA_PENDING_IMPORT,
    query: {organizationId, hhaEmail: user.hhaEmail},
    options: {bypassExtraQueries: true},
  });

  return Boolean(waiting.success && waiting.count > 0);
};

/** What an admin's email edit writes: the address, pinned against the sync. */
const buildAdminEmailUpdate = ({email}) => ({
  email: String(email).trim().toLowerCase(),
  isEmailAdminSet: true,
});

/**
 * The `users` columns an admin's email edit writes on an imported person.
 *
 * @throws {AppError} 400 HHA_MANAGED_FIELD_READ_ONLY when the address is not
 *   the admin's to change.
 */
const resolveAdminEmailUpdate = async ({
  userId,
  organizationId,
  isHhaManaged,
  email,
}) => {
  const {doc: user} = isHhaManaged
    ? await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER,
        query: {id: userId},
        options: {bypassExtraQueries: true},
        fieldsInclusion: {
          includeSpecificFields: ['id', 'email', 'hhaEmail', 'isEmailAdminSet'],
        },
      })
    : {doc: null};

  const isEditable =
    Boolean(user) && (await canAdminSetHhaEmail({user, organizationId}));

  if (!isEditable) {
    throw HhaExchangeErrorsFactories.hhaManagedFieldReadOnlyErr({
      fields: [HHA_SYNC_CHANGE_FIELDS.EMAIL],
    });
  }

  return buildAdminEmailUpdate({email});
};

module.exports = {
  runInParallelGroups,
  resolveAdminEmailUpdate,
  isAdoptableProfile,
  toHhaEmail,
  resolveImportUserFields,
  clearPendingImport,
  canAdminSetHhaEmail,
  buildAdminEmailUpdate,
  splitPreparedByHash,
  touchUnchanged,
  updateUserAndProfile,
  recordProfileUpdate,
  recordProfileCreate,
  findOrgUserByEmail,
  reconcileHhaEmails,
};
