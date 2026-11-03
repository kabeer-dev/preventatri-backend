/**
 * The HHAeXchange decisions only an admin can take: a unique login email for
 * people HHA gives the same address, which of a patient's HHA coordinators is
 * its case manager, whose primary nurse or case manager wins when HHA and an
 * admin differ, who covers a patient still waiting for HHA's person, and which
 * region a county HHA addresses fall in belongs to.
 */

const CaseManagersServices = require('./caseManagersServices');
const CountiesServices = require('./countiesServices');
const HhaCaregiverSyncServices = require('./hhaCaregiverSyncServices');
const HhaCoordinatorSyncServices = require('./hhaCoordinatorSyncServices');
const HhaNurseSyncServices = require('./hhaNurseSyncServices');
const HhaPatientLinkSyncServices = require('./hhaPatientLinkSyncServices');
const HhaSyncHistoryReadServices = require('./hhaSyncHistoryReadServices');
const HhaSyncServices = require('./hhaSyncServices');

const {
  HHA_ADMIN_EMAIL_RESOLUTION_NOTE,
  HHA_CASE_MANAGER_CHOICES,
  HHA_CASE_MANAGER_RESOLUTION_NOTES,
  HHA_COORDINATOR_CHOICE_FILTERS,
  HHA_COORDINATOR_SHARED_SLOT,
  HHA_COUNTY_ADDED_RESOLUTION_NOTE,
  HHA_EMAIL_CONFLICT_FILTERS,
  HHA_EMAIL_CONFLICT_OPEN_STATES,
  HHA_EMAIL_CONFLICT_STATES,
  HHA_INVITE_BLOCKING_EXCEPTION_TYPES,
  HHA_PATIENT_COORDINATOR_DEFAULT_SORT,
  HHA_PENDING_IMPORT_RESOLUTION_NOTE,
  HHA_PENDING_PERSON_EXCEPTION_TYPES,
  HHA_PENDING_PERSON_PATIENT_FIELDS,
  HHA_PRIMARY_NURSE_CHOICES,
  HHA_PRIMARY_NURSE_RESOLUTION_NOTES,
  HHA_SYNC_EXCEPTION_STATUSES,
  HHA_SYNC_RECORD_KINDS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const PrismaFactory = require('../factories/PrismaFactory');

const {getCurrentTime} = require('../utils/dateUtils');
const {buildCountyLookup} = require('../utils/hhaExchange/countyResolver');

const {
  ELIGIBLE_PROFILE_QUERY,
} = require('../utils/hhaExchange/linkEligibilityUtils');

const {
  assertPatientCaseManagerEditable,
} = require('../utils/hhaExchange/managedFieldsUtils');

const {
  isPlaceholderEmail,
} = require('../utils/hhaExchange/placeholderEmailUtils');

const {
  assignedCaseManagerSelect,
  formatAssignedCaseManager,
  formatHhaCoordinators,
  hhaCoordinatorsSelect,
  patientCareTeamSelect,
} = require('../utils/patientUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');
const {findReferenceCountyByLabel} = require('../utils/usCountyUtils');
const {resolveInvitationStatus} = require('../utils/userHelpers');
const {getFullName, withMembershipDetails} = require('../utils/userUtils');

const {MODELS} = modelConstants;

const findOrgUsers = async ({organizationId, query}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model: MODELS.USER,
    query: Object.assign({userOrganizations: {some: {organizationId}}}, query),
    options: {bypassExtraQueries: true},
    fieldsInclusion: {
      include: Object.assign(
        {
          id: true,
          email: true,
          hhaEmail: true,
          isEmailAdminSet: true,
          createdAt: true,
          isVerified: true,
          invitationSentAt: true,

          // The name is per organization, so it comes from the membership.
          userOrganizations: {
            where: {organizationId},
            select: {role: true, firstName: true, lastName: true},
            take: 1,
          },
        },
        HhaSyncHistoryReadServices.buildUserProfileInclude({organizationId})
      ),
    },
  });

  if (!success) throw error;

  return docs;
};

const toMemberState = ({user, email}) => {
  if (String(user.email).toLowerCase() === email) {
    return HHA_EMAIL_CONFLICT_STATES.USES_EMAIL;
  }

  if (isPlaceholderEmail({email: user.email})) {
    return HHA_EMAIL_CONFLICT_STATES.NEEDS_EMAIL;
  }

  return user.isEmailAdminSet
    ? HHA_EMAIL_CONFLICT_STATES.ADMIN_SET
    : HHA_EMAIL_CONFLICT_STATES.OTHER_EMAIL;
};

const toMember = ({user, email, conflictUserIds}) => ({
  userId: user.id,
  name: getFullName({user: user.userOrganizations?.[0]}),
  loginEmail: user.email,
  state: toMemberState({user, email}),

  // Only people HHA gives this address are edited here, and only until they
  // accept: after that the email is the one they log in with.
  isEditable: user.hhaEmail === email && !user.isVerified,
  invitationStatus: resolveInvitationStatus({
    user,
    role: user.userOrganizations?.[0]?.role,
    hasEmailConflict: conflictUserIds.includes(user.id),
  }),
  profile: HhaSyncHistoryReadServices.toUserProfileRef({user}),
});

/** A person not imported yet: no user, no profile, only the waiting entry. */
const toPendingMember = ({pending}) => ({
  userId: null,
  pendingId: pending.id,
  name: pending.name,
  loginEmail: pending.loginEmail || null,
  state: pending.loginEmail
    ? HHA_EMAIL_CONFLICT_STATES.EMAIL_SAVED
    : HHA_EMAIL_CONFLICT_STATES.NOT_IMPORTED,
  isEditable: true,
  invitationStatus: null,
  profile: {
    kind: HhaSyncHistoryReadServices.resolveResourceKind({
      resource: pending.resource,
    }),
    id: null,
  },
});

const findPendingImports = async ({organizationId, query = {}}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model: MODELS.HHA_PENDING_IMPORT,
    query: Object.assign({organizationId}, query),
    options: {bypassExtraQueries: true, sort: [{name: 'asc'}]},
  });

  if (!success) throw error;

  return docs;
};

const toGroup = ({email, users, pendings, conflictUserIds}) => {
  const members = users
    .map((user) => toMember({user, email, conflictUserIds}))
    .concat(pendings.map((pending) => toPendingMember({pending})));

  return {
    email,
    members,
    needsAttention: members.some(({state}) =>
      HHA_EMAIL_CONFLICT_OPEN_STATES.includes(state)
    ),
  };
};

const groupBy = ({rows, keyOf}) => {
  const groups = new Map();

  rows.forEach((row) => {
    const key = keyOf({row});

    if (!groups.has(key)) groups.set(key, []);

    groups.get(key).push(row);
  });

  return groups;
};

/**
 * Everyone sharing each HHA address: imported users, people waiting to be
 * imported, and any other user logging in with it.
 */
const buildEmailGroups = async ({organizationId}) => {
  const hhaUsers = await findOrgUsers({
    organizationId,
    query: {hhaEmail: {not: null}},
  });

  const usersByEmail = groupBy({
    rows: hhaUsers,
    keyOf: ({row}) => row.hhaEmail,
  });

  const pendingByEmail = groupBy({
    rows: await findPendingImports({organizationId}),
    keyOf: ({row}) => row.hhaEmail,
  });

  pendingByEmail.forEach((pendings, email) => {
    if (!usersByEmail.has(email)) usersByEmail.set(email, []);
  });

  // Contested: someone waits on it, it is shared, or someone is off it.
  const contested = Array.from(usersByEmail.entries())
    .filter(
      ([email, users]) =>
        pendingByEmail.has(email) ||
        users.length > 1 ||
        users.some((user) => String(user.email).toLowerCase() !== email)
    )
    .map(([email]) => email);

  if (contested.length === 0) return [];

  const holders = await findOrgUsers({
    organizationId,
    query: {email: {in: contested}},
  });

  const conflicts =
    await HhaSyncHistoryReadServices.listUserIdsWithOpenEmailException({
      organizationId,
    });

  if (!conflicts.success) throw conflicts.error;

  holders.forEach((holder) => {
    const users = usersByEmail.get(String(holder.email).toLowerCase());

    if (users && !users.some((user) => user.id === holder.id)) {
      users.push(holder);
    }
  });

  // A group is as new as the newest person in it.
  const newestAt = ({email}) =>
    usersByEmail
      .get(email)
      .concat(pendingByEmail.get(email) || [])
      .reduce(
        (newest, {createdAt}) =>
          Math.max(newest, new Date(createdAt).getTime()),
        0
      );

  return contested
    .map((email) =>
      toGroup({
        email,
        users: usersByEmail.get(email),
        pendings: pendingByEmail.get(email) || [],
        conflictUserIds: conflicts.userIds,
      })
    )
    .filter(({members}) => members.length > 1)
    .sort(
      (a, b) =>
        Number(b.needsAttention) - Number(a.needsAttention) ||
        newestAt({email: b.email}) - newestAt({email: a.email}) ||
        a.email.localeCompare(b.email)
    );
};

/** Who imports one person of each resource by HHA id. */
const PENDING_IMPORTERS = {
  [HHAX_SYNC_RESOURCES.CAREGIVERS.value]: HhaCaregiverSyncServices,
  [HHAX_SYNC_RESOURCES.NURSES.value]: HhaNurseSyncServices,
  [HHAX_SYNC_RESOURCES.COORDINATORS.value]: HhaCoordinatorSyncServices,
};

/**
 * Fetch that one person from HHAeXchange and create them now. False (the next
 * sync imports them instead) when a sync is running or HHA cannot be reached.
 */
const importPendingNow = async ({pending, organizationId}) => {
  const importer = PENDING_IMPORTERS[pending.resource];

  if (!importer || (await HhaSyncServices.isSyncRunning())) return false;

  try {
    const {success} = await importer.importOne({
      hhaId: pending.hhaRecordId,
      organizationId,
    });

    return Boolean(success);
  } catch {
    return false;
  }
};

/** The person exists now, so their open "email taken" exception is done. */
const closeDuplicateEmailException = async ({
  pending,
  organizationId,
  userId,
}) =>
  await PrismaFactory.updateMany({
    model: MODELS.HHA_SYNC_EXCEPTION,
    query: {
      organizationId,
      resource: pending.resource,
      hhaRecordId: pending.hhaRecordId,
      type: HHAX_SYNC_EXCEPTION_TYPES.DUPLICATE_EMAIL,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
    },
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
      resolvedAt: getCurrentTime(),
      resolvedByUserId: userId,
      resolutionNote: HHA_PENDING_IMPORT_RESOLUTION_NOTE,
    },
    options: {bypassExtraQueries: true},
  });

const coordinatorPatientInclude = Object.assign(
  {id: true, firstName: true, lastName: true, hhaPatientId: true},
  assignedCaseManagerSelect,
  hhaCoordinatorsSelect
);

const toCoordinatorPatient = ({patient}) => ({
  patientId: patient.id,
  hhaPatientId: patient.hhaPatientId || null,
  name: getFullName({user: patient}),
  isChosen: Boolean(patient.hhaSelectedCaseManagerProfileId),
  coordinators: formatHhaCoordinators({patient}),
});

const findCoordinatorPatient = async ({patientId, organizationId}) =>
  await PrismaFactory.findOne({
    model: MODELS.PATIENT,
    query: {id: patientId, organizationId},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {include: coordinatorPatientInclude},
  });

/** The patient's open nurse or case manager conflict, naming HHA's person. */
const findOpenConflict = async ({patient, organizationId, type}) => {
  if (!patient.hhaPatientId) return null;

  const {success, doc, error} = await PrismaFactory.findOne({
    model: MODELS.HHA_SYNC_EXCEPTION,
    query: {
      organizationId,
      resource: HHAX_SYNC_RESOURCES.PATIENTS.value,
      hhaRecordId: patient.hhaPatientId,
      type,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
    },
    options: {bypassExtraQueries: true},
  });

  if (!success) throw error;

  return doc?.detail ? doc : null;
};

/** Where each kind of HHA person lives, and who holds a patient meanwhile. */
const HHA_PERSON_SOURCES = {
  [HHA_SYNC_RECORD_KINDS.NURSE]: {
    model: MODELS.NURSE_PROFILE,
    hhaIdField: 'hhaNurseId',
    holderInclude: {primaryNurse: patientCareTeamSelect.primaryNurse},
    readHolder: ({patient}) => patient.primaryNurse || null,
  },
  [HHA_SYNC_RECORD_KINDS.CASE_MANAGER]: {
    model: MODELS.CASE_MANAGER_PROFILE,
    hhaIdField: 'hhaCoordinatorId',
    holderInclude: assignedCaseManagerSelect,
    readHolder: ({patient}) => formatAssignedCaseManager({patient}) || null,
  },
};

/**
 * HHA's nurse or case manager by HHA id. `isActiveOnly` leaves out a person
 * who can no longer be linked, so a stale conflict cannot assign them.
 */
const findHhaPerson = async ({
  kind,
  organizationId,
  hhaId,
  isActiveOnly = true,
}) => {
  const source = HHA_PERSON_SOURCES[kind];

  const {success, doc, error} = await PrismaFactory.findOne({
    model: source.model,
    query: Object.assign(
      {organizationId, [source.hhaIdField]: hhaId},
      isActiveOnly ? ELIGIBLE_PROFILE_QUERY : {}
    ),
    options: {bypassExtraQueries: true, includeDeleted: !isActiveOnly},
    fieldsInclusion: {includeSpecificFields: ['id']},
  });

  if (!success) throw error;

  return doc || null;
};

/** Close a conflict the admin settled by choosing. */
const closeConflict = async ({conflict, userId, note, tx}) => {
  const closed = await PrismaFactory.updateOne({
    model: MODELS.HHA_SYNC_EXCEPTION,
    query: {id: conflict.id},
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
      resolvedAt: getCurrentTime(),
      resolvedByUserId: userId,
      resolutionNote: note,
      reopenedAt: null,
      reopenedByUserId: null,
    },
    options: {bypassExtraQueries: true},
    tx,
  });

  if (!closed.success) throw closed.error;
};

/** Forget the person an admin declined and reopen the conflict, to ask again. */
const reopenDeclinedConflict = async ({
  exception,
  organizationId,
  userId,
  patientId,
  declinedField,
}) => {
  let doc = null;

  await wrapWithPrismaTransaction({
    fn: async (tx) => {
      const saved = await PrismaFactory.updateOne({
        model: MODELS.PATIENT,
        query: {id: patientId},
        data: {[declinedField]: null},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!saved.success) throw saved.error;

      const reopened = await PrismaFactory.findOneAndUpdate({
        model: MODELS.HHA_SYNC_EXCEPTION,
        query: {id: exception.id, organizationId},
        data: {
          status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
          reopenedAt: getCurrentTime(),
          reopenedByUserId: userId,
        },
        tx,
      });

      if (!reopened.success) throw reopened.error;

      doc = reopened.doc;
    },
  });

  return doc;
};

/** The kind of person a per-person exception type reports, or null. */
const resolveWaitingPersonKind = ({type}) =>
  Object.keys(HHA_PENDING_PERSON_EXCEPTION_TYPES).find((kind) =>
    Object.values(HHA_PENDING_PERSON_EXCEPTION_TYPES[kind]).includes(type)
  ) || null;

const ORG_COUNTY_FIELDS = ['id', 'name', 'stateCode', 'fipsCode', 'regionId'];

/** The reference county an open "county not set up" exception names, if any. */
const readExceptionCounty = ({exception}) =>
  exception.type === HHAX_SYNC_EXCEPTION_TYPES.COUNTY_NOT_IN_ORGANIZATION &&
  exception.status === HHA_SYNC_EXCEPTION_STATUSES.OPEN.value
    ? findReferenceCountyByLabel({label: exception.detail})
    : null;

const findRegion = async ({regionId, organizationId}) => {
  const region = await PrismaFactory.findOne({
    model: MODELS.REGION,
    query: {id: regionId, organizationId},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {includeSpecificFields: ['id', 'name']},
  });

  if (!region.success) throw region.error;

  return region.doc;
};

/** The organization's row for a reference county, created in the region if absent. */
const findOrCreateCounty = async ({county, regionId, organizationId}) => {
  const existing = await PrismaFactory.findOne({
    model: MODELS.COUNTY,
    query: {organizationId, fipsCode: county.fipsCode},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {includeSpecificFields: ORG_COUNTY_FIELDS},
  });

  if (!existing.success) throw existing.error;

  if (existing.doc) return existing.doc;

  const created = await CountiesServices.bulkCreateCounties({
    fipsCodes: [county.fipsCode],
    regionId,
    organizationId,
  });

  if (!created.success || !created.docs[0]) {
    throw created.error || new Error('County could not be created');
  }

  return created.docs[0];
};

/** The county exists now, so every open exception naming it is done. */
const closeCountyExceptions = async ({organizationId, detail, userId}) =>
  await PrismaFactory.updateMany({
    model: MODELS.HHA_SYNC_EXCEPTION,
    query: {
      organizationId,
      type: HHAX_SYNC_EXCEPTION_TYPES.COUNTY_NOT_IN_ORGANIZATION,
      detail,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
    },
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
      resolvedAt: getCurrentTime(),
      resolvedByUserId: userId,
      resolutionNote: HHA_COUNTY_ADDED_RESOLUTION_NOTE,
    },
    options: {bypassExtraQueries: true},
  });

module.exports = class HhaSyncWorklistServices {
  /**
   * Answer a "county not set up" exception by adding that county to a region.
   * Patients already imported get the county now; a nurse's region also moves
   * the patients they cover, so nurses follow on the next sync.
   *
   * @returns {Promise<{success, doc, isExceptionFound, isActionable,
   *   isSyncRunning, isRegionFound, otherRegionName, error}>}
   */
  static async addExceptionCountyToRegion({
    exceptionId,
    organizationId,
    regionId,
    userId,
  }) {
    const outcome = {
      success: false,
      isExceptionFound: true,
      isActionable: true,
      isSyncRunning: false,
      isRegionFound: true,
    };

    try {
      const exception = await PrismaFactory.findOne({
        model: MODELS.HHA_SYNC_EXCEPTION,
        query: {id: exceptionId, organizationId},
        options: {bypassExtraQueries: true},
      });

      if (!exception.success) throw exception.error;

      if (!exception.doc) {
        return Object.assign(outcome, {isExceptionFound: false});
      }

      const county = readExceptionCounty({exception: exception.doc});

      if (!county) return Object.assign(outcome, {isActionable: false});

      // A running pass listed the counties before this one existed, and would
      // unlock these patients again as unresolved.
      if (await HhaSyncServices.isSyncRunning()) {
        return Object.assign(outcome, {isSyncRunning: true});
      }

      const region = await findRegion({regionId, organizationId});

      if (!region) return Object.assign(outcome, {isRegionFound: false});

      const orgCounty = await findOrCreateCounty({
        county,
        regionId,
        organizationId,
      });

      // Added on the Regions page meanwhile: saying "added" here would mislead
      // the admin about which nurses cover it.
      if (orgCounty.regionId !== regionId) {
        const otherRegion = await findRegion({
          regionId: orgCounty.regionId,
          organizationId,
        });

        return Object.assign(outcome, {otherRegionName: otherRegion?.name});
      }

      const applied =
        await HhaPatientLinkSyncServices.applyCountyToStoredPatients({
          organizationId,
          countyLookup: buildCountyLookup({counties: [orgCounty]}),
        });

      // Left open on a failed apply, so the next sync still owns them.
      if (applied.success) {
        await closeCountyExceptions({
          organizationId,
          detail: exception.doc.detail,
          userId,
        });
      }

      return Object.assign(outcome, {
        success: true,
        doc: {
          county: orgCounty,
          patientsUpdated: applied.hhaPatientIds.length,
        },
      });
    } catch (error) {
      return Object.assign(outcome, {error});
    }
  }

  /**
   * Groups of people sharing one HHAeXchange address, open ones first.
   *
   * @returns {Promise<{success, docs, count, error}>}
   */
  static async listEmailConflicts({organizationId, status, skip, take}) {
    try {
      const groups = await buildEmailGroups({organizationId});

      const filtered = Object.values(HHA_EMAIL_CONFLICT_FILTERS).includes(
        status
      )
        ? groups.filter(
            ({needsAttention}) =>
              needsAttention ===
              (status === HHA_EMAIL_CONFLICT_FILTERS.NEEDS_ATTENTION)
          )
        : groups;

      return {
        success: true,
        count: filtered.length,
        docs: filtered.slice(skip, skip + take),
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /**
   * Save the login email an admin gives a person who is not imported yet,
   * then import that one person straight away.
   *
   * @returns {Promise<{success, doc, isFound, isEmailFree, isImported, error}>}
   */
  static async setPendingLoginEmail({id, organizationId, email, userId}) {
    try {
      const [pending] = await findPendingImports({
        organizationId,
        query: {id},
      });

      if (!pending) return {success: false, isFound: false, isEmailFree: true};

      const others = await findPendingImports({
        organizationId,
        query: {loginEmail: email, id: {not: id}},
      });

      const users = await findOrgUsers({organizationId, query: {email}});

      if (others.length > 0 || users.length > 0) {
        return {success: false, isFound: true, isEmailFree: false};
      }

      const {success, error} = await PrismaFactory.updateOne({
        model: MODELS.HHA_PENDING_IMPORT,
        query: {id},
        data: {loginEmail: email},
        options: {bypassExtraQueries: true},
      });

      if (!success) throw error;

      const saved = Object.assign({}, pending, {loginEmail: email});

      const isImported = await importPendingNow({
        pending: saved,
        organizationId,
      });

      if (isImported) {
        await closeDuplicateEmailException({
          pending: saved,
          organizationId,
          userId,
        });
      }

      return {
        success: true,
        isFound: true,
        isEmailFree: true,
        isImported,
        doc: toPendingMember({pending: saved}),
      };
    } catch (error) {
      return {success: false, isFound: true, isEmailFree: true, error};
    }
  }

  /** The org user an email edit targets, with what the guard needs. */
  static async getOrgUser({userId, organizationId}) {
    return await PrismaFactory.findOne({
      model: MODELS.USER,
      query: {id: userId, userOrganizations: {some: {organizationId}}},
      options: {bypassExtraQueries: true},
      fieldsInclusion: {
        includeSpecificFields: ['id', 'email', 'hhaEmail', 'isVerified'],
      },
    });
  }

  /** The admin settled this user's email, so their open email exceptions are done. */
  static async closeUserEmailExceptions({
    userId,
    organizationId,
    resolvedByUserId,
  }) {
    try {
      const records = await HhaSyncHistoryReadServices.listUserHhaRecords({
        userId,
        organizationId,
      });

      if (records.length === 0) return {success: true};

      return await PrismaFactory.updateMany({
        model: MODELS.HHA_SYNC_EXCEPTION,
        query: {
          organizationId,
          OR: records,
          type: {in: HHA_INVITE_BLOCKING_EXCEPTION_TYPES},
          status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
        },
        data: {
          status: HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
          resolvedAt: getCurrentTime(),
          resolvedByUserId,
          resolutionNote: HHA_ADMIN_EMAIL_RESOLUTION_NOTE,
        },
        options: {bypassExtraQueries: true},
      });
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Patients HHAeXchange gives more than one coordinator.
   *
   * @returns {Promise<{success, docs, count, error}>}
   */
  static async listCoordinatorPatients({organizationId, choice, skip, take}) {
    try {
      const query = Object.assign(
        {
          organizationId,
          hhaCoordinators: {some: {slot: {gte: HHA_COORDINATOR_SHARED_SLOT}}},
        },
        choice === HHA_COORDINATOR_CHOICE_FILTERS.NEEDS_CHOICE
          ? {hhaSelectedCaseManagerProfileId: null}
          : {},
        choice === HHA_COORDINATOR_CHOICE_FILTERS.CHOSEN
          ? {hhaSelectedCaseManagerProfileId: {not: null}}
          : {}
      );

      const {success, docs, error} = await PrismaFactory.find({
        model: MODELS.PATIENT,
        query,
        options: {
          bypassExtraQueries: true,
          skip,
          take,
          sort: HHA_PATIENT_COORDINATOR_DEFAULT_SORT,
        },
        fieldsInclusion: {include: coordinatorPatientInclude},
      });

      if (!success) throw error;

      const {count} = await PrismaFactory.countDocuments({
        model: MODELS.PATIENT,
        query,
        options: {bypassExtraQueries: true},
      });

      return {
        success: true,
        count: count || 0,
        docs: docs.map((patient) => toCoordinatorPatient({patient})),
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /**
   * Make one of the patient's HHA coordinators its case manager. The pick is
   * stored on the patient so later syncs keep it.
   *
   * @returns {Promise<{success, doc, isPatientFound, isSelectable, error}>}
   */
  static async selectPatientCaseManager({
    patientId,
    organizationId,
    caseManagerProfileId,
  }) {
    try {
      const {
        success,
        doc: patient,
        error,
      } = await findCoordinatorPatient({
        patientId,
        organizationId,
      });

      if (!success) throw error;

      if (!patient) {
        return {success: false, isPatientFound: false, isSelectable: false};
      }

      // Only an active coordinator can hold a patient.
      const isSelectable = formatHhaCoordinators({patient}).some(
        (coordinator) =>
          coordinator.caseManagerProfileId === caseManagerProfileId &&
          coordinator.isActive
      );

      if (!isSelectable) {
        return {success: false, isPatientFound: true, isSelectable: false};
      }

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const picked = await PrismaFactory.updateOne({
            model: MODELS.PATIENT,
            query: {id: patientId},

            // Chosen among HHA's own coordinators, so the link stays HHA's.
            data: {
              hhaSelectedCaseManagerProfileId: caseManagerProfileId,
              isCaseManagerHhaManaged: true,
            },
            options: {bypassExtraQueries: true},
            tx,
          });

          if (!picked.success) throw picked.error;

          const linked = await CaseManagersServices.setPatientCaseManager({
            patientId,
            organizationId,
            caseManagerProfileId,
            tx,
          });

          if (!linked.success) throw linked.error;
        },
      });

      const {doc: updated} = await findCoordinatorPatient({
        patientId,
        organizationId,
      });

      return {
        success: true,
        isPatientFound: true,
        isSelectable: true,
        doc: toCoordinatorPatient({patient: updated || patient}),
      };
    } catch (error) {
      return {
        success: false,
        isPatientFound: true,
        isSelectable: true,
        error,
      };
    }
  }

  /**
   * Settle an open primary nurse conflict: take HHAeXchange's nurse, or keep
   * the admin's pick and remember the declined HHA nurse so syncs stay quiet.
   *
   * @returns {Promise<{success, doc, isPatientFound, isConflictOpen, error}>}
   */
  static async selectPatientPrimaryNurse({
    patientId,
    organizationId,
    choice,
    userId,
  }) {
    try {
      const {
        success,
        doc: patient,
        error,
      } = await PrismaFactory.findOne({
        model: MODELS.PATIENT,
        query: {id: patientId, organizationId},
        options: {bypassExtraQueries: true},
        fieldsInclusion: {
          includeSpecificFields: [
            'id',
            'hhaPatientId',
            'primaryNurseProfileId',
            'secondaryNurseProfileId',
          ],
        },
      });

      if (!success) throw error;

      if (!patient) {
        return {success: false, isPatientFound: false, isConflictOpen: false};
      }

      const conflict = await findOpenConflict({
        patient,
        organizationId,
        type: HHAX_SYNC_EXCEPTION_TYPES.PRIMARY_NURSE_CONFLICT,
      });

      const hhaNurse = conflict
        ? await findHhaPerson({
            kind: HHA_SYNC_RECORD_KINDS.NURSE,
            organizationId,
            hhaId: conflict.detail,
          })
        : null;

      if (!hhaNurse) {
        return {success: false, isPatientFound: true, isConflictOpen: false};
      }

      const data =
        choice === HHA_PRIMARY_NURSE_CHOICES.HHA
          ? Object.assign(
              {
                primaryNurseProfileId: hhaNurse.id,
                isPrimaryNurseHhaManaged: true,
                hhaDeclinedNurseId: null,
              },

              // A DB CHECK forbids the same nurse in both slots.
              patient.secondaryNurseProfileId === hhaNurse.id
                ? {secondaryNurseProfileId: null}
                : {}
            )
          : {hhaDeclinedNurseId: conflict.detail};

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const saved = await PrismaFactory.updateOne({
            model: MODELS.PATIENT,
            query: {id: patientId},
            data,
            options: {bypassExtraQueries: true},
            tx,
          });

          if (!saved.success) throw saved.error;

          await closeConflict({
            conflict,
            userId,
            note: HHA_PRIMARY_NURSE_RESOLUTION_NOTES[choice],
            tx,
          });
        },
      });

      return {
        success: true,
        isPatientFound: true,
        isConflictOpen: true,
        doc: {
          patientId,
          primaryNurseProfileId:
            data.primaryNurseProfileId || patient.primaryNurseProfileId,
          isPrimaryNurseHhaManaged: Boolean(data.isPrimaryNurseHhaManaged),
        },
      };
    } catch (error) {
      return {
        success: false,
        isPatientFound: true,
        isConflictOpen: true,
        error,
      };
    }
  }

  /**
   * Reopen a nurse conflict an admin closed by keeping their pick, and forget
   * the declined nurse so the choice is asked again. Any other closed conflict
   * has nothing to choose between; the sync reopens it when it does.
   *
   * @returns {Promise<{success, doc, isReopenable, error}>}
   */
  static async reopenPatientPrimaryNurseConflict({
    exception,
    organizationId,
    userId,
  }) {
    try {
      const {
        success,
        doc: patient,
        error,
      } = await PrismaFactory.findOne({
        model: MODELS.PATIENT,
        query: {organizationId, hhaPatientId: exception.hhaRecordId},
        options: {bypassExtraQueries: true},
        fieldsInclusion: {
          includeSpecificFields: [
            'id',
            'primaryNurseProfileId',
            'isPrimaryNurseHhaManaged',
            'hhaDeclinedNurseId',
          ],
        },
      });

      if (!success) throw error;

      const isReopenable =
        exception.status === HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value &&
        Boolean(patient?.primaryNurseProfileId) &&
        !patient.isPrimaryNurseHhaManaged &&
        Boolean(exception.detail) &&
        patient.hhaDeclinedNurseId === exception.detail;

      if (!isReopenable) return {success: false, isReopenable: false};

      const doc = await reopenDeclinedConflict({
        exception,
        organizationId,
        userId,
        patientId: patient.id,
        declinedField: 'hhaDeclinedNurseId',
      });

      return {success: true, isReopenable: true, doc};
    } catch (error) {
      return {success: false, isReopenable: true, error};
    }
  }

  /**
   * An admin puts a case manager on an HHAeXchange patient by hand, or clears
   * it with null. The link is the admin's from then on, so the sync asks
   * before replacing it.
   *
   * @returns {Promise<{success, isEligible, error}>}
   * @throws {AppError} 400 HHA_MANAGED_FIELD_READ_ONLY while HHA's case
   *   manager holds the patient.
   */
  static async pickPatientCaseManager({patient, caseManagerProfileId}) {
    const {id: patientId, organizationId} = patient;

    const link = await PrismaFactory.findOne({
      model: MODELS.CASE_MANAGER_PATIENT,
      query: {patientId},
      options: {bypassExtraQueries: true},
      fieldsInclusion: {includeSpecificFields: ['id', 'caseManagerProfileId']},
    });

    if (!link.success) return {success: false, isEligible: true};

    // A form re-sending the case manager it loaded is not a pick: flagging it
    // as one would make the sync ask before replacing HHA's own leftover.
    if ((link.doc?.caseManagerProfileId || null) === caseManagerProfileId) {
      return {success: true, isEligible: true};
    }

    assertPatientCaseManagerEditable({
      patient,
      hasCaseManager: Boolean(link.doc),
    });

    try {
      if (caseManagerProfileId) {
        const picked = await PrismaFactory.findOne({
          model: MODELS.CASE_MANAGER_PROFILE,
          query: Object.assign(
            {id: caseManagerProfileId, organizationId},
            ELIGIBLE_PROFILE_QUERY
          ),
          options: {bypassExtraQueries: true},
          fieldsInclusion: {includeSpecificFields: ['id']},
        });

        if (!picked.success) throw picked.error;
        if (!picked.doc) return {success: false, isEligible: false};
      }

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const linked = caseManagerProfileId
            ? await CaseManagersServices.setPatientCaseManager({
                patientId,
                organizationId,
                caseManagerProfileId,
                tx,
              })
            : await PrismaFactory.hardDeleteMany({
                model: MODELS.CASE_MANAGER_PATIENT,
                query: {patientId},
                options: {bypassExtraQueries: true},
                tx,
              });

          if (!linked.success) throw linked.error;

          const flagged = await PrismaFactory.updateOne({
            model: MODELS.PATIENT,
            query: {id: patientId},
            data: {isCaseManagerHhaManaged: false},
            options: {bypassExtraQueries: true},
            tx,
          });

          if (!flagged.success) throw flagged.error;
        },
      });

      return {success: true, isEligible: true};
    } catch (error) {
      return {success: false, isEligible: true, error};
    }
  }

  /**
   * Settle an open case manager conflict: take HHAeXchange's case manager, or
   * keep the current one. A kept coordinator becomes the admin's chosen
   * coordinator; anyone else is kept by remembering the declined one.
   *
   * @returns {Promise<{success, doc, isPatientFound, isConflictOpen, error}>}
   */
  static async selectPatientCaseManagerConflict({
    patientId,
    organizationId,
    choice,
    userId,
  }) {
    try {
      const {
        success,
        doc: patient,
        error,
      } = await findCoordinatorPatient({patientId, organizationId});

      if (!success) throw error;

      if (!patient) {
        return {success: false, isPatientFound: false, isConflictOpen: false};
      }

      const conflict = await findOpenConflict({
        patient,
        organizationId,
        type: HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_CONFLICT,
      });

      const hhaCaseManager = conflict
        ? await findHhaPerson({
            kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
            organizationId,
            hhaId: conflict.detail,
          })
        : null;

      if (!hhaCaseManager) {
        return {success: false, isPatientFound: true, isConflictOpen: false};
      }

      const isHhaChosen = choice === HHA_CASE_MANAGER_CHOICES.HHA;
      const currentId = formatAssignedCaseManager({patient})?.id || null;

      const isCurrentCoordinator =
        Boolean(currentId) &&
        formatHhaCoordinators({patient}).some(
          (coordinator) => coordinator.caseManagerProfileId === currentId
        );

      const keptData = isCurrentCoordinator
        ? {
            hhaSelectedCaseManagerProfileId: currentId,
            isCaseManagerHhaManaged: true,
          }
        : {hhaDeclinedCaseManagerProfileId: hhaCaseManager.id};

      await wrapWithPrismaTransaction({
        fn: async (tx) => {
          const saved = await PrismaFactory.updateOne({
            model: MODELS.PATIENT,
            query: {id: patientId},
            data: Object.assign(
              {hhaPendingCaseManagerProfileId: null},
              isHhaChosen
                ? {
                    isCaseManagerHhaManaged: true,
                    hhaDeclinedCaseManagerProfileId: null,
                  }
                : keptData
            ),
            options: {bypassExtraQueries: true},
            tx,
          });

          if (!saved.success) throw saved.error;

          if (isHhaChosen) {
            const linked = await CaseManagersServices.setPatientCaseManager({
              patientId,
              organizationId,
              caseManagerProfileId: hhaCaseManager.id,
              tx,
            });

            if (!linked.success) throw linked.error;
          }

          await closeConflict({
            conflict,
            userId,
            note: HHA_CASE_MANAGER_RESOLUTION_NOTES[choice],
            tx,
          });
        },
      });

      return {
        success: true,
        isPatientFound: true,
        isConflictOpen: true,
        doc: {
          patientId,
          caseManagerProfileId: isHhaChosen ? hhaCaseManager.id : currentId,
        },
      };
    } catch (error) {
      return {
        success: false,
        isPatientFound: true,
        isConflictOpen: true,
        error,
      };
    }
  }

  /**
   * Reopen a case manager conflict an admin closed by keeping someone HHA does
   * not list, and forget the declined one so the choice is asked again. A kept
   * coordinator is changed on the Coordinators view instead.
   *
   * @returns {Promise<{success, doc, isReopenable, error}>}
   */
  static async reopenPatientCaseManagerConflict({
    exception,
    organizationId,
    userId,
  }) {
    try {
      const {
        success,
        doc: patient,
        error,
      } = await PrismaFactory.findOne({
        model: MODELS.PATIENT,
        query: {organizationId, hhaPatientId: exception.hhaRecordId},
        options: {bypassExtraQueries: true},
        fieldsInclusion: {
          includeSpecificFields: ['id', 'hhaDeclinedCaseManagerProfileId'],
        },
      });

      if (!success) throw error;

      const isClosedByKeeping =
        exception.status === HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value &&
        Boolean(patient?.hhaDeclinedCaseManagerProfileId) &&
        Boolean(exception.detail);

      if (!isClosedByKeeping) return {success: false, isReopenable: false};

      const declined = await findHhaPerson({
        kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
        organizationId,
        hhaId: exception.detail,
        isActiveOnly: false,
      });

      if (declined?.id !== patient.hhaDeclinedCaseManagerProfileId) {
        return {success: false, isReopenable: false};
      }

      const doc = await reopenDeclinedConflict({
        exception,
        organizationId,
        userId,
        patientId: patient.id,
        declinedField: 'hhaDeclinedCaseManagerProfileId',
      });

      return {success: true, isReopenable: true, doc};
    } catch (error) {
      return {success: false, isReopenable: true, error};
    }
  }

  /**
   * The patients waiting for the person a per-person exception names, with
   * whoever holds each one meanwhile.
   *
   * @returns {Promise<{success, docs, count, isExceptionFound, error}>}
   */
  static async listWaitingPatients({exceptionId, organizationId, skip, take}) {
    const outcome = {
      success: false,
      docs: [],
      count: 0,
      isExceptionFound: true,
    };

    try {
      const exception = await PrismaFactory.findOne({
        model: MODELS.HHA_SYNC_EXCEPTION,
        query: {id: exceptionId, organizationId},
        options: {bypassExtraQueries: true},
      });

      if (!exception.success) throw exception.error;

      if (!exception.doc) {
        return Object.assign(outcome, {isExceptionFound: false});
      }

      const kind = resolveWaitingPersonKind({type: exception.doc.type});

      const person = kind
        ? await findHhaPerson({
            kind,
            organizationId,
            hhaId: exception.doc.detail,
            isActiveOnly: false,
          })
        : null;

      // Not a per-person exception, or the person is gone: nobody waits.
      if (!person) return Object.assign(outcome, {success: true});

      const source = HHA_PERSON_SOURCES[kind];

      const query = {
        organizationId,
        [HHA_PENDING_PERSON_PATIENT_FIELDS[kind]]: person.id,
      };

      const {success, docs, error} = await PrismaFactory.find({
        model: MODELS.PATIENT,
        query,
        options: {
          bypassExtraQueries: true,
          skip,
          take,
          sort: HHA_PATIENT_COORDINATOR_DEFAULT_SORT,
        },
        fieldsInclusion: {
          include: Object.assign(
            {id: true, firstName: true, lastName: true, hhaPatientId: true},
            source.holderInclude
          ),
        },
      });

      if (!success) throw error;

      const {count} = await PrismaFactory.countDocuments({
        model: MODELS.PATIENT,
        query,
        options: {bypassExtraQueries: true},
      });

      return Object.assign(outcome, {
        success: true,
        count: count || 0,
        docs: docs.map((patient) => {
          const holder = source.readHolder({patient});

          return {
            patientId: patient.id,
            hhaPatientId: patient.hhaPatientId || null,
            name: getFullName({user: patient}),
            current: holder
              ? {
                  id: holder.id,
                  name: getFullName({
                    user: withMembershipDetails({
                      user: holder.user,
                      membership: holder.userOrganization,
                    }),
                  }),
                }
              : null,
          };
        }),
      });
    } catch (error) {
      return Object.assign(outcome, {error});
    }
  }

  /**
   * A person can log in now: give them the patients HHAeXchange assigns them.
   * A running sync stands in for this in its own last step.
   *
   * @returns {Promise<number>} Patients assigned. Never throws.
   */
  static async applyPendingLinksForUser({userId}) {
    try {
      if (await HhaSyncServices.isSyncRunning()) return 0;

      const {assigned} = await HhaPatientLinkSyncServices.applyPendingLinks({
        userId,
      });

      return assigned;
    } catch {
      return 0;
    }
  }
};
