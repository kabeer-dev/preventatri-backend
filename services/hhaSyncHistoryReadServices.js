/**
 * Read side of the HHAeXchange sync history (runs, changes, exceptions), plus
 * the admin's resolve/dismiss/reopen of an exception.
 *
 * Rows point at records by HHA id; the record, its name and the names behind a
 * link change are resolved here at read time. Change rows do keep the old and
 * new field values, patient fields included (docs/hha-sync-decisions.md).
 */

const HhaSyncHistoryServices = require('./hhaSyncHistoryServices');
const HhaSyncServices = require('./hhaSyncServices');

const {
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
  HHA_PENDING_PERSON_EXCEPTION_TYPES,
  HHA_PENDING_PERSON_PATIENT_FIELDS,
  HHA_SYNC_CHANGE_FIELDS,
  HHA_SYNC_DEAD_RUN_GRACE_MS,
  HHA_SYNC_EXCEPTION_STATUSES,
  HHA_INVITE_BLOCKING_EXCEPTION_TYPES,
  HHA_SYNC_HISTORY_FILTER_ALL,
  HHA_SYNC_RUN_DEFAULT_SORT,
  HHA_SYNC_CHANGE_DEFAULT_SORT,
  HHA_SYNC_EXCEPTION_DEFAULT_SORT,
  HHA_SYNC_RECORD_KINDS,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const {MODELS_WITH_SOFT_DELETE} = require('../constants/modelSchemaConfig');
const {SYSTEM_ROLES} = require('../constants/usersConstants');
const PrismaFactory = require('../factories/PrismaFactory');

const {getCurrentTime} = require('../utils/dateUtils');

const {
  buildProfileRelationsInclude,
  resolveInvitationStatus,
} = require('../utils/userHelpers');
const {getFullName} = require('../utils/userUtils');

const {MODELS} = modelConstants;

const USER_NAME_SELECT = {select: {firstName: true, lastName: true}};

/** Where each resource's HHA id lives here, and how its name is read. */
const RECORD_SOURCES = {
  [HHAX_SYNC_RESOURCES.PATIENTS.value]: {
    model: MODELS.PATIENT,
    hhaIdField: 'hhaPatientId',
    kind: HHA_SYNC_RECORD_KINDS.PATIENT,
    select: {firstName: true, lastName: true},
    toName: ({doc}) => getFullName({user: doc}),
  },
  [HHAX_SYNC_RESOURCES.NURSES.value]: {
    model: MODELS.NURSE_PROFILE,
    hhaIdField: 'hhaNurseId',
    kind: HHA_SYNC_RECORD_KINDS.NURSE,
    select: {user: USER_NAME_SELECT},
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  [HHAX_SYNC_RESOURCES.CAREGIVERS.value]: {
    model: MODELS.CAREGIVER_PROFILE,
    hhaIdField: 'hhaCaregiverId',
    kind: HHA_SYNC_RECORD_KINDS.CAREGIVER,
    select: {user: USER_NAME_SELECT},
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  [HHAX_SYNC_RESOURCES.COORDINATORS.value]: {
    model: MODELS.CASE_MANAGER_PROFILE,
    hhaIdField: 'hhaCoordinatorId',
    kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
    select: {user: USER_NAME_SELECT},
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  [HHAX_SYNC_RESOURCES.VISITS.value]: {
    model: MODELS.HHA_VISIT,
    hhaIdField: 'hhaVisitId',
    kind: HHA_SYNC_RECORD_KINDS.VISIT,
    select: {patientFirstName: true, patientLastName: true},
    toName: ({doc}) =>
      getFullName({
        user: {firstName: doc.patientFirstName, lastName: doc.patientLastName},
      }),
  },
};

/** The resources whose records are people with a login. */
const STAFF_RESOURCES = [
  HHAX_SYNC_RESOURCES.COORDINATORS.value,
  HHAX_SYNC_RESOURCES.NURSES.value,
  HHAX_SYNC_RESOURCES.CAREGIVERS.value,
];

/** The models a link-change value (an id) is named from. */
const REFERENCE_SOURCES = {
  countyId: {model: MODELS.COUNTY, toName: ({doc}) => doc.name},
  primaryNurseProfileId: {
    model: MODELS.NURSE_PROFILE,
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  secondaryNurseProfileId: {
    model: MODELS.NURSE_PROFILE,
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  [HHA_SYNC_CHANGE_FIELDS.CASE_MANAGER]: {
    model: MODELS.CASE_MANAGER_PROFILE,
    toName: ({doc}) => getFullName({user: doc.user}),
  },
  [HHA_SYNC_CHANGE_FIELDS.PRIMARY_REGIONS]: {
    model: MODELS.REGION,
    toName: ({doc}) => doc.name,
  },
  [HHA_SYNC_CHANGE_FIELDS.USER]: {
    model: MODELS.USER,
    toName: ({doc}) => getFullName({user: doc}),
  },
};

const REFERENCE_SELECTS = {
  [MODELS.COUNTY]: {id: true, name: true},
  [MODELS.REGION]: {id: true, name: true},
  [MODELS.USER]: {id: true, firstName: true, lastName: true},
  [MODELS.NURSE_PROFILE]: {id: true, user: USER_NAME_SELECT},
  [MODELS.CASE_MANAGER_PROFILE]: {id: true, user: USER_NAME_SELECT},
};

const isFiltered = ({value}) => value && value !== HHA_SYNC_HISTORY_FILTER_ALL;

const buildDateRange = ({field, dateFrom, dateTo}) => {
  if (!dateFrom && !dateTo) return {};

  const range = {};

  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) range.lte = new Date(dateTo);

  return {[field]: range};
};

const findAll = async ({model, query, include, organizationId}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model,
    query: organizationId ? Object.assign({organizationId}, query) : query,

    // Archived records still resolve; only soft-delete models accept the flag.
    options: {
      bypassExtraQueries: true,
      includeDeleted: MODELS_WITH_SOFT_DELETE.includes(model) || undefined,
    },
    fieldsInclusion: {include},
  });

  if (!success) throw error;

  return docs;
};

const pageOf = async ({model, query, sort, skip, take}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model,
    query,
    options: {skip, take, sort},
  });

  if (!success) throw error;

  const {count} = await PrismaFactory.countDocuments({model, query});

  return {docs, count: count || 0};
};

/** `${resource}:${hhaId}` -> {kind, id, name} for every row that resolves. */
const resolveRecords = async ({organizationId, rows}) => {
  const records = new Map();

  for (const [resource, source] of Object.entries(RECORD_SOURCES)) {
    const hhaIds = Array.from(
      new Set(
        rows
          .filter((row) => row.resource === resource && row.hhaRecordId)
          .map((row) => row.hhaRecordId)
      )
    );

    if (hhaIds.length === 0) continue;

    const docs = await findAll({
      model: source.model,
      organizationId,
      query: {[source.hhaIdField]: {in: hhaIds}},
      include: Object.assign({[source.hhaIdField]: true}, source.select),
    });

    docs.forEach((doc) =>
      records.set(`${resource}:${doc[source.hhaIdField]}`, {
        kind: source.kind,
        id: doc.id,
        name: source.toName({doc}),
      })
    );
  }

  return records;
};

const labelOf = ({value, names}) =>
  value
    ? String(value)
        .split(', ')
        .map((id) => names[id] || id)
        .join(', ')
    : null;

/** Each link-change entry gains fromLabel/toLabel: the names behind its ids. */
const attachReferenceLabels = ({rows, names}) =>
  rows.map((row) =>
    Object.assign({}, row, {
      changes: (row.changes || []).map((entry) =>
        REFERENCE_SOURCES[entry.field]
          ? Object.assign({}, entry, {
              fromLabel: labelOf({value: entry.from, names}),
              toLabel: labelOf({value: entry.to, names}),
            })
          : entry
      ),
    })
  );

const attachRecords = async ({organizationId, rows}) => {
  const records = await resolveRecords({organizationId, rows});

  return rows.map((row) =>
    Object.assign({}, row, {
      record: records.get(`${row.resource}:${row.hhaRecordId}`) || null,
    })
  );
};

/** id -> display name for every id a page of link changes mentions. */
const resolveReferenceNames = async ({changes}) => {
  const idsByModel = new Map();

  changes.forEach((row) =>
    (row.changes || []).forEach((entry) => {
      const source = REFERENCE_SOURCES[entry.field];

      if (!source) return;

      if (!idsByModel.has(source.model))
        idsByModel.set(source.model, new Set());

      [entry.from, entry.to]
        .filter(Boolean)
        .flatMap((value) => String(value).split(', '))
        .forEach((id) => idsByModel.get(source.model).add(id));
    })
  );

  const names = {};

  for (const [model, ids] of idsByModel) {
    const docs = await findAll({
      model,
      query: {id: {in: Array.from(ids)}},
      include: REFERENCE_SELECTS[model],
    });

    const source = Object.values(REFERENCE_SOURCES).find(
      (candidate) => candidate.model === model
    );

    docs.forEach((doc) => {
      names[doc.id] = source.toName({doc});
    });
  }

  return names;
};

/** The role profiles of a user in this organization, one per role at most. */
const buildUserProfileInclude = ({organizationId}) => {
  const profileSelect = {
    where: {organizationId},
    select: {id: true, status: true},
    take: 1,
  };

  return {
    nurseProfiles: profileSelect,
    caregiverProfiles: profileSelect,
    caseManagerProfiles: profileSelect,
  };
};

/** The page a user opens on: their role profile, or the users list. */
const toUserProfileRef = ({user}) => {
  if (user.nurseProfiles?.[0]) {
    return {kind: HHA_SYNC_RECORD_KINDS.NURSE, id: user.nurseProfiles[0].id};
  }

  if (user.caregiverProfiles?.[0]) {
    return {
      kind: HHA_SYNC_RECORD_KINDS.CAREGIVER,
      id: user.caregiverProfiles[0].id,
    };
  }

  if (user.caseManagerProfiles?.[0]) {
    return {
      kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
      id: user.caseManagerProfiles[0].id,
    };
  }

  return {kind: HHA_SYNC_RECORD_KINDS.USER, id: user.id};
};

/**
 * The other user in an email conflict, with the profile "Fix here" opens:
 * a nurse, caregiver or case manager page, or the users list for anyone else.
 */
const resolveRelatedUsers = async ({organizationId, rows}) => {
  const ids = Array.from(
    new Set(rows.map((row) => row.relatedUserId).filter(Boolean))
  );

  if (ids.length === 0) return new Map();

  const users = await findAll({
    model: MODELS.USER,
    query: {id: {in: ids}},
    include: Object.assign(
      {id: true, firstName: true, lastName: true, email: true},
      buildUserProfileInclude({organizationId})
    ),
  });

  return new Map(
    users.map((user) => [
      user.id,
      {
        id: user.id,
        name: getFullName({user}),
        email: user.email,
        profile: toUserProfileRef({user}),
      },
    ])
  );
};

/** A conflict type -> who PreventaTri has on the patient, and how to read them. */
const CONFLICT_HOLDERS = {
  [HHAX_SYNC_EXCEPTION_TYPES.PRIMARY_NURSE_CONFLICT]: {
    kind: HHA_SYNC_RECORD_KINDS.NURSE,
    include: {
      primaryNurse: {select: REFERENCE_SELECTS[MODELS.NURSE_PROFILE]},
    },
    readHolder: ({patient}) => patient.primaryNurse || null,
  },
  [HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_CONFLICT]: {
    kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
    include: {
      caseManagerPatients: {
        select: {
          caseManagerProfile: {
            select: REFERENCE_SELECTS[MODELS.CASE_MANAGER_PROFILE],
          },
        },
      },
    },
    readHolder: ({patient}) =>
      patient.caseManagerPatients?.[0]?.caseManagerProfile || null,
  },
};

/** Exception id -> who PreventaTri currently has, for nurse and case manager conflicts. */
const resolveConflictHolders = async ({organizationId, rows}) => {
  const holders = new Map();

  for (const [type, source] of Object.entries(CONFLICT_HOLDERS)) {
    const conflicts = rows.filter(
      (row) => row.type === type && row.hhaRecordId
    );

    if (conflicts.length === 0) continue;

    const patients = await findAll({
      model: MODELS.PATIENT,
      organizationId,
      query: {hhaPatientId: {in: conflicts.map((row) => row.hhaRecordId)}},
      include: Object.assign({hhaPatientId: true}, source.include),
    });

    const holderByHhaPatientId = new Map(
      patients.map((patient) => [
        patient.hhaPatientId,
        source.readHolder({patient}),
      ])
    );

    conflicts.forEach((row) => {
      const holder = holderByHhaPatientId.get(row.hhaRecordId);

      if (!holder) return;

      holders.set(row.id, {
        kind: source.kind,
        id: holder.id,
        name: getFullName({user: holder.user}),
      });
    });
  }

  return holders;
};

/** A per-person exception type -> the kind of person it reports. */
const WAITING_PERSON_KIND_BY_TYPE = Object.entries(
  HHA_PENDING_PERSON_EXCEPTION_TYPES
).reduce((kinds, [kind, types]) => {
  Object.values(types).forEach((type) => {
    kinds[type] = kind;
  });

  return kinds;
}, {});

const WAITING_PERSON_ROLES = {
  [HHA_SYNC_RECORD_KINDS.NURSE]: SYSTEM_ROLES.nurse.value,
  [HHA_SYNC_RECORD_KINDS.CASE_MANAGER]: SYSTEM_ROLES.case_manager.value,
};

/**
 * Exception id -> {waitingPatientCount, invitationStatus} for per-person rows:
 * how many patients wait for that person, and where their invitation stands.
 */
const resolveWaitingPeople = async ({
  organizationId,
  rows,
  emailConflictUserIds,
}) => {
  const waiting = new Map();

  const personRows = rows.filter(
    (row) => WAITING_PERSON_KIND_BY_TYPE[row.type] && row.detail
  );

  if (personRows.length === 0) return waiting;

  const users = await findAll({
    model: MODELS.USER,
    query: {
      id: {in: personRows.map((row) => row.relatedUserId).filter(Boolean)},
    },
    include: Object.assign(
      {id: true, email: true, isVerified: true, invitationSentAt: true},
      buildProfileRelationsInclude({organizationId})
    ),
  });

  const usersById = new Map(users.map((user) => [user.id, user]));

  for (const kind of Object.keys(HHA_PENDING_PERSON_EXCEPTION_TYPES)) {
    const kindRows = personRows.filter(
      (row) => WAITING_PERSON_KIND_BY_TYPE[row.type] === kind
    );

    if (kindRows.length === 0) continue;

    const source = Object.values(RECORD_SOURCES).find(
      (candidate) => candidate.kind === kind
    );

    const profiles = await findAll({
      model: source.model,
      organizationId,
      query: {[source.hhaIdField]: {in: kindRows.map((row) => row.detail)}},
      include: {id: true, [source.hhaIdField]: true},
    });

    const field = HHA_PENDING_PERSON_PATIENT_FIELDS[kind];

    const patients = await PrismaFactory.find({
      model: MODELS.PATIENT,
      query: {organizationId, [field]: {in: profiles.map(({id}) => id)}},
      options: {bypassExtraQueries: true},
      fieldsInclusion: {includeSpecificFields: [field]},
    });

    if (!patients.success) throw patients.error;

    kindRows.forEach((row) => {
      const profile = profiles.find(
        (candidate) => candidate[source.hhaIdField] === row.detail
      );

      const user = usersById.get(row.relatedUserId);

      waiting.set(row.id, {
        waitingPatientCount: patients.docs.filter(
          (patient) => patient[field] === profile?.id
        ).length,
        invitationStatus: user
          ? resolveInvitationStatus({
              user,
              role: WAITING_PERSON_ROLES[kind],
              hasEmailConflict: emailConflictUserIds.includes(user.id),
            })
          : null,
      });
    });
  }

  return waiting;
};

/**
 * A Running row with no run lock behind it is a run whose process died. Close
 * it now instead of leaving it Running until the next sync starts.
 */
const closeDeadRuns = async ({organizationId}) => {
  if (await HhaSyncServices.isSyncRunning()) return;

  // A run takes the lock just before it opens its row; skip rows that new.
  await HhaSyncHistoryServices.closeAbandonedRuns({
    organizationId,
    startedBefore: new Date(
      getCurrentTime().getTime() - HHA_SYNC_DEAD_RUN_GRACE_MS
    ),
  });
};

module.exports = class HhaSyncHistoryReadServices {
  static buildUserProfileInclude({organizationId}) {
    return buildUserProfileInclude({organizationId});
  }

  static toUserProfileRef({user}) {
    return toUserProfileRef({user});
  }

  /** The record kind a resource's rows are, e.g. NURSES -> nurse. */
  static resolveResourceKind({resource}) {
    return RECORD_SOURCES[resource]?.kind || null;
  }

  /** @returns {Promise<{success, docs, count, error}>} */
  static async listRuns({
    organizationId,
    status,
    trigger,
    dateFrom,
    dateTo,
    skip,
    take,
  }) {
    try {
      await closeDeadRuns({organizationId});

      const query = Object.assign(
        {organizationId},
        isFiltered({value: status}) ? {status} : {},
        isFiltered({value: trigger}) ? {trigger} : {},
        buildDateRange({field: 'startedAt', dateFrom, dateTo})
      );

      const {docs, count} = await pageOf({
        model: MODELS.HHA_SYNC_RUN,
        query,
        sort: HHA_SYNC_RUN_DEFAULT_SORT,
        skip,
        take,
      });

      const requesters = await resolveRelatedUsers({
        organizationId,
        rows: docs.map((run) => ({relatedUserId: run.requestedByUserId})),
      });

      return {
        success: true,
        count,
        docs: docs.map((run) =>
          Object.assign({}, run, {
            requestedBy: requesters.get(run.requestedByUserId) || null,
          })
        ),
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /** One run, with how many changes and open exceptions it left behind. */
  static async getRun({id, organizationId}) {
    try {
      await closeDeadRuns({organizationId});

      const {success, doc, error} = await PrismaFactory.findOne({
        model: MODELS.HHA_SYNC_RUN,
        query: {id, organizationId},
      });

      if (!success) throw error;
      if (!doc) return {success: true, doc: null};

      const [{count: changeCount}, requesters] = await Promise.all([
        PrismaFactory.countDocuments({
          model: MODELS.HHA_SYNC_CHANGE,
          query: {runId: id},
        }),
        resolveRelatedUsers({
          organizationId,
          rows: [{relatedUserId: doc.requestedByUserId}],
        }),
      ]);

      // Exceptions are counted from summaries: rows move on to later runs.
      return {
        success: true,
        doc: Object.assign({}, doc, {
          requestedBy: requesters.get(doc.requestedByUserId) || null,
          changeCount: changeCount || 0,
        }),
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /** @returns {Promise<{success, docs, count, error}>} */
  static async listChanges({
    organizationId,
    runId,
    resource,
    action,
    hhaRecordId,
    dateFrom,
    dateTo,
    skip,
    take,
  }) {
    try {
      const query = Object.assign(
        {organizationId},
        runId ? {runId} : {},
        isFiltered({value: resource}) ? {resource} : {},
        isFiltered({value: action}) ? {action} : {},
        hhaRecordId ? {hhaRecordId} : {},
        buildDateRange({field: 'createdAt', dateFrom, dateTo})
      );

      const {docs, count} = await pageOf({
        model: MODELS.HHA_SYNC_CHANGE,
        query,
        sort: HHA_SYNC_CHANGE_DEFAULT_SORT,
        skip,
        take,
      });

      const names = await resolveReferenceNames({changes: docs});

      return {
        success: true,
        count,
        docs: attachReferenceLabels({
          rows: await attachRecords({organizationId, rows: docs}),
          names,
        }),
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /** @returns {Promise<{success, docs, count, error}>} */
  static async listExceptions({
    organizationId,
    status,
    type,
    resource,
    runId,
    skip,
    take,
  }) {
    try {
      const query = Object.assign(
        {organizationId},
        isFiltered({value: status}) ? {status} : {},
        isFiltered({value: type}) ? {type} : {},
        isFiltered({value: resource}) ? {resource} : {},
        runId ? {lastSeenRunId: runId} : {}
      );

      const {docs, count} = await pageOf({
        model: MODELS.HHA_SYNC_EXCEPTION,
        query,
        sort: HHA_SYNC_EXCEPTION_DEFAULT_SORT,
        skip,
        take,
      });

      const withRecords = await attachRecords({organizationId, rows: docs});

      // One lookup names the conflicting user and whoever closed or reopened the row.
      const users = await resolveRelatedUsers({
        organizationId,
        rows: docs
          .concat(docs.map((row) => ({relatedUserId: row.resolvedByUserId})))
          .concat(docs.map((row) => ({relatedUserId: row.reopenedByUserId}))),
      });

      const conflictHolders = await resolveConflictHolders({
        organizationId,
        rows: docs,
      });

      const hasPersonRows = docs.some(
        (row) => WAITING_PERSON_KIND_BY_TYPE[row.type]
      );

      const emailConflicts = hasPersonRows
        ? await HhaSyncHistoryReadServices.listUserIdsWithOpenEmailException({
            organizationId,
          })
        : {success: true, userIds: []};

      if (!emailConflicts.success) throw emailConflicts.error;

      const waitingPeople = await resolveWaitingPeople({
        organizationId,
        rows: docs,
        emailConflictUserIds: emailConflicts.userIds,
      });

      return {
        success: true,
        count,
        docs: withRecords.map((row) => {
          const holder = conflictHolders.get(row.id) || null;

          return Object.assign(
            {},
            row,
            {
              relatedUser: users.get(row.relatedUserId) || null,
              resolvedBy: users.get(row.resolvedByUserId) || null,
              reopenedBy: users.get(row.reopenedByUserId) || null,
              preventatriNurse:
                holder?.kind === HHA_SYNC_RECORD_KINDS.NURSE ? holder : null,
              preventatriCaseManager:
                holder?.kind === HHA_SYNC_RECORD_KINDS.CASE_MANAGER
                  ? holder
                  : null,
            },
            waitingPeople.get(row.id) || {}
          );
        }),
      };
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /** Open exceptions per type, for the tab badge and the type filter. */
  static async countOpenExceptions({organizationId}) {
    try {
      const rows = await findAll({
        model: MODELS.HHA_SYNC_EXCEPTION,
        organizationId,
        query: {status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value},
        include: {type: true},
      });

      const byType = {};

      rows.forEach((row) => {
        byType[row.type] = (byType[row.type] || 0) + 1;
      });

      return {success: true, total: rows.length, byType};
    } catch (error) {
      return {success: false, total: 0, byType: {}, error};
    }
  }

  /**
   * Users whose login email is unsettled by an open exception. Exceptions name
   * a record by HHA id, so each one is resolved through its role profile.
   */
  static async listUserIdsWithOpenEmailException({organizationId}) {
    try {
      const rows = await findAll({
        model: MODELS.HHA_SYNC_EXCEPTION,
        organizationId,
        query: {
          status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
          type: {in: HHA_INVITE_BLOCKING_EXCEPTION_TYPES},
          hhaRecordId: {not: null},
        },
        include: {resource: true, hhaRecordId: true},
      });

      const userIds = new Set();

      for (const resource of STAFF_RESOURCES) {
        const source = RECORD_SOURCES[resource];

        const hhaIds = rows
          .filter((row) => row.resource === resource)
          .map((row) => row.hhaRecordId);

        if (hhaIds.length === 0) continue;

        const profiles = await findAll({
          model: source.model,
          organizationId,
          query: {[source.hhaIdField]: {in: hhaIds}},
          include: {userId: true},
        });

        profiles.forEach((profile) => userIds.add(profile.userId));
      }

      return {success: true, userIds: Array.from(userIds)};
    } catch (error) {
      return {success: false, userIds: [], error};
    }
  }

  /** The HHA records behind one user, as [{resource, hhaRecordId}]. */
  static async listUserHhaRecords({userId, organizationId}) {
    const records = [];

    for (const resource of STAFF_RESOURCES) {
      const {model, hhaIdField} = RECORD_SOURCES[resource];

      const profiles = await findAll({
        model,
        organizationId,
        query: {userId, [hhaIdField]: {not: null}},
        include: {[hhaIdField]: true},
      });

      profiles.forEach((profile) =>
        records.push({resource, hhaRecordId: profile[hhaIdField]})
      );
    }

    return records;
  }

  /**
   * Admin resolve, dismiss or reopen. A reopen records who reopened it and
   * keeps who last closed it and the note; a close starts a fresh record.
   */
  static async updateExceptionStatus({
    id,
    organizationId,
    status,
    note,
    userId,
  }) {
    const isReopen = status === HHA_SYNC_EXCEPTION_STATUSES.OPEN.value;
    const now = getCurrentTime();

    // A nurse or case manager conflict is not closed or reopened here: its
    // status must move together with the patient's link (HhaSyncWorklistServices).
    const current = await PrismaFactory.findOne({
      model: MODELS.HHA_SYNC_EXCEPTION,
      query: {id, organizationId},
    });

    if (!current.success) return {success: false, error: current.error};

    if (CONFLICT_HOLDERS[current.doc?.type]) {
      return {success: false, linkConflict: current.doc};
    }

    const {success, doc, error} = await PrismaFactory.findOneAndUpdate({
      model: MODELS.HHA_SYNC_EXCEPTION,
      query: {id, organizationId},
      data: isReopen
        ? {status, reopenedAt: now, reopenedByUserId: userId}
        : {
            status,
            resolvedAt: now,
            resolvedByUserId: userId,
            resolutionNote: note || null,
            reopenedAt: null,
            reopenedByUserId: null,
          },
    });

    return {success, doc, error};
  }
};
