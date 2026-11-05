/**
 * HHAeXchange -> PreventaTri patient county and links (nurse, case manager).
 *
 * Runs on every patient-feed page after the patient rows exist, and is NOT
 * hash-gated: a link resolves against nurses and case managers that may have
 * been imported since the patient last changed. The decisions live in the pure
 * patientLinkPlanner; this reads what it needs and writes what it decides.
 *
 * Case manager links are written per patient and never through
 * assignPatientsToCaseManager, which replaces a case manager's whole roster.
 *
 * A nurse or case manager is linked only while active. Patients naming someone
 * who is not keep that person's id as pending; applyPendingLinks links them
 * from stored data once the person is active, without waiting for a feed page.
 */

const HhaExchangeServices = require('./hhaExchangeServices');

const {CASE_MANAGER_SOURCES} = require('../constants/caseManagersConstants');

const {
  HHA_COORDINATOR_FIRST_SLOT,
  HHA_LINK_ELIGIBILITY,
  HHA_PATIENT_TRACKED_LINK_FIELDS,
  HHA_PENDING_LINKS_RESOLUTION_NOTE,
  HHA_PENDING_PERSON_EXCEPTION_TYPES,
  HHA_PENDING_PERSON_PATIENT_FIELDS,
  HHA_SYNC_CHANGE_ACTIONS,
  HHA_SYNC_CHANGE_FIELDS,
  HHA_SYNC_EXCEPTION_STATUSES,
  HHA_SYNC_RECORD_KINDS,
  HHAX_COORDINATOR_MATCH_KINDS,
  HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
  HHAX_SYNC_TRIGGERS,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');

const {
  buildCoordinatorLookup,
  resolveCoordinatorName,
} = require('../utils/hhaExchange/coordinatorResolver');

const {resolveCountyFromZip} = require('../utils/hhaExchange/countyResolver');

const {
  LINK_ELIGIBILITY_SELECT,
  resolveLinkEligibility,
} = require('../utils/hhaExchange/linkEligibilityUtils');

const {
  buildCoverageKey,
  planPatientLinks,
} = require('../utils/hhaExchange/patientLinkPlanner');
const {unwrapArray} = require('../utils/hhaExchange/soapClient');
const {diffFields} = require('../utils/hhaExchange/syncChangeUtils');

const {
  buildSummary,
  recordChange,
  recordException,
} = require('../utils/hhaExchange/syncRunUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const PATIENT_LINK_FIELDS = [
  'id',
  'hhaPatientId',
  'isDeleted',
  'countyId',
  'isCountyHhaManaged',
  'primaryNurseProfileId',
  'secondaryNurseProfileId',
  'isPrimaryNurseHhaManaged',
  'hhaDeclinedNurseId',
  'hhaSelectedCaseManagerProfileId',
  'hhaPendingNurseProfileId',
  'hhaPendingCaseManagerProfileId',
  'isCaseManagerHhaManaged',
  'hhaDeclinedCaseManagerProfileId',
];

const PATIENT_ADDRESS_FIELDS = ['state', 'zipCode'];

/** Each kind of person a patient can wait for, and where their lookup sits. */
const WAITING_PERSON_KINDS = [
  {
    kind: HHA_SYNC_RECORD_KINDS.NURSE,
    readPeople: ({lookups}) => lookups.nurseLookup?.byProfileId || null,
  },
  {
    kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
    readPeople: ({lookups}) => lookups.coordinatorLookup?.byProfileId || null,
  },
];

const recordLinkChange = ({summary, recordId, changes}) =>
  recordChange({
    summary,
    recordId,
    action: HHA_SYNC_CHANGE_ACTIONS.LINK_CHANGED.value,
    changes,
  });

const recordCaseManagerChange = ({summary, decision}) =>
  recordLinkChange({
    summary,
    recordId: decision.entry.hhaPatientId,
    changes: [
      {
        field: HHA_SYNC_CHANGE_FIELDS.CASE_MANAGER,
        from: decision.cmRow?.caseManagerProfileId || null,
        to: decision.plan.caseManagerProfileId,
      },
    ],
  });

const reportLookupFailure = ({summary, detail}) =>
  recordException({
    summary,
    recordId: null,
    type: HHAX_SYNC_EXCEPTION_TYPES.LINK_LOOKUP_FAILED,
    detail,
  });

/** Coordinator ids on a GetPatientDemographics record, empty slots dropped. */
const readCoordinatorIds = ({patientInfo}) =>
  unwrapArray({
    value:
      patientInfo?.[HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS.COORDINATORS]?.[
        HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS.COORDINATOR
      ],
  })
    .map((node) => Number(node?.[HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS.ID]))
    .filter((id) => Number.isInteger(id) && id > 0)
    .map((id) => String(id));

const toResolvedCoordinator = ({
  coordinator,
  match,
  isAmbiguous,
  isLookupFailed = false,
}) => {
  const unmatchedKind = isAmbiguous
    ? HHAX_COORDINATOR_MATCH_KINDS.AMBIGUOUS
    : HHAX_COORDINATOR_MATCH_KINDS.UNKNOWN;

  return Object.assign({}, coordinator, {
    match,
    kind: match ? HHAX_COORDINATOR_MATCH_KINDS.MATCHED : unmatchedKind,

    // The id call failed: this is "unknown", never "matches nobody".
    isLookupFailed: isLookupFailed && !match,
  });
};

/**
 * The feed names each coordinator; this finds their case managers. Ambiguous
 * names cost one GetPatientDemographics call per patient, which answers with
 * ids in the same order.
 *
 * @returns {Promise<Object[]|null>} null when coordinators cannot be read.
 */
const resolveCoordinators = async ({
  entry,
  coordinatorLookup,
  organizationId,
}) => {
  const {coordinators, isKnown} = entry.coordinatorRef;

  if (!coordinatorLookup || !isKnown) return null;

  const named = coordinators.map((coordinator) =>
    Object.assign(
      {coordinator},
      resolveCoordinatorName({
        lookup: coordinatorLookup,
        name: coordinator.name,
      })
    )
  );

  if (!named.some(({isAmbiguous}) => isAmbiguous)) {
    return named.map((resolved) => toResolvedCoordinator(resolved));
  }

  const {success, doc} = await HhaExchangeServices.fetchPatientDemographics({
    patientId: entry.hhaPatientId,
    organizationId,
  });

  const ids = success ? readCoordinatorIds({patientInfo: doc}) : [];

  return named.map(({coordinator, match, isAmbiguous}, index) =>
    toResolvedCoordinator({
      coordinator,
      isAmbiguous,
      isLookupFailed: isAmbiguous && !success,
      match: isAmbiguous
        ? coordinatorLookup.byHhaId.get(ids[index]) || null
        : match,
    })
  );
};

/** SECONDARY "nurse:region" pairs for secondaries whose patient's county moves. */
const loadSecondaryCoverage = async ({prepared, patientsByHhaId}) => {
  const nurseIds = prepared
    .map((entry) => patientsByHhaId.get(entry.hhaPatientId))
    .filter(
      (patient, index) =>
        patient?.secondaryNurseProfileId &&
        prepared[index].countyId &&
        prepared[index].countyId !== patient.countyId
    )
    .map((patient) => patient.secondaryNurseProfileId);

  if (nurseIds.length === 0) return new Set();

  const {success, docs} = await PrismaFactory.find({
    model: modelConstants.MODELS.NURSE_REGION,
    query: {
      nurseProfileId: {in: nurseIds},
      nurseRegionRole: NURSE_REGION_ROLES.SECONDARY,
    },
    options: {bypassExtraQueries: true},
    fieldsInclusion: {includeSpecificFields: ['nurseProfileId', 'regionId']},
  });

  // Unknown coverage must not read as "not covered" and clear secondaries.
  if (!success) return null;

  return new Set(
    docs.map((row) =>
      buildCoverageKey({
        nurseProfileId: row.nurseProfileId,
        regionId: row.regionId,
      })
    )
  );
};

const reportWriteFailure = ({summary, hhaPatientIds, error}) =>
  hhaPatientIds.forEach((recordId) =>
    recordException({
      summary,
      recordId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: error?.code || null,
    })
  );

/** Rows bucketed by `keyOf` into a Map, in first-seen order. */
const groupRowsBy = ({rows, keyOf}) => {
  const groups = new Map();

  for (const row of rows) {
    const key = keyOf({row});

    if (!groups.has(key)) groups.set(key, []);

    groups.get(key).push(row);
  }

  return groups;
};

/** Decisions bucketed by `keyOf`, so identical writes share one statement. */
const groupDecisions = ({decisions, keyOf}) =>
  Array.from(
    groupRowsBy({
      rows: decisions,
      keyOf: ({row}) => keyOf({decision: row}),
    }).values()
  );

/**
 * Write the page's patient patches, one statement per distinct patch: the
 * common case (the same flag on every patient) must not cost a database round
 * trip per patient, which is what made a first run take minutes.
 */
const writePatientPatches = async ({decisions, summary}) => {
  const groups = groupDecisions({
    decisions: decisions.filter(({plan}) => Object.keys(plan.patch).length > 0),
    keyOf: ({decision}) => JSON.stringify(decision.plan.patch),
  });

  for (const group of groups) {
    const {patch} = group[0].plan;

    const {success, error} = await PrismaFactory.updateMany({
      model: modelConstants.MODELS.PATIENT,
      query: {id: {in: group.map(({patient}) => patient.id)}},
      data: patch,
      options: {bypassExtraQueries: true, includeDeleted: true},
    });

    if (!success) {
      reportWriteFailure({
        summary,
        hhaPatientIds: group.map(({entry}) => entry.hhaPatientId),
        error,
      });

      continue;
    }

    if (patch.countyId) summary.countiesResolved += group.length;

    group.forEach(({patient, entry}) =>
      recordLinkChange({
        summary,
        recordId: entry.hhaPatientId,
        changes: diffFields({
          before: patient,
          after: patch,
          fields: HHA_PATIENT_TRACKED_LINK_FIELDS,
        }),
      })
    );

    if (patch.primaryNurseProfileId !== undefined) {
      summary.nurseLinksChanged += group.length;
    }
  }
};

/** Drop the links of patients whose case manager is no longer active. */
const removeCaseManagerLinks = async ({decisions, summary}) => {
  const removals = decisions.filter(
    ({plan, cmRow}) => plan.removeCaseManager && cmRow
  );

  if (removals.length === 0) return;

  const {success, error} = await PrismaFactory.hardDeleteMany({
    model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
    query: {id: {in: removals.map(({cmRow}) => cmRow.id)}},
    options: {bypassExtraQueries: true},
  });

  if (!success) {
    return reportWriteFailure({
      summary,
      hhaPatientIds: removals.map(({entry}) => entry.hhaPatientId),
      error,
    });
  }

  summary.caseManagerLinksChanged += removals.length;
  removals.forEach((decision) => recordCaseManagerChange({summary, decision}));
};

/**
 * New links in one createMany (per-row fallback so one bad row cannot cost
 * the page); moved links in one updateMany per target case manager. The table
 * is unique on patientId, so a move updates the existing row.
 */
const writeCaseManagerLinks = async ({decisions, organizationId, summary}) => {
  await removeCaseManagerLinks({decisions, summary});

  const changes = decisions.filter(({plan}) => plan.caseManagerProfileId);
  const creates = changes.filter(({cmRow}) => !cmRow);

  const toRow = ({decision}) => ({
    caseManagerProfileId: decision.plan.caseManagerProfileId,
    patientId: decision.patient.id,
    organizationId,
  });

  if (creates.length > 0) {
    const {success} = await PrismaFactory.create({
      model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
      data: creates.map((decision) => toRow({decision})),
      options: {bypassExtraQueries: true},
    });

    if (success) {
      summary.caseManagerLinksChanged += creates.length;
      creates.forEach((decision) =>
        recordCaseManagerChange({summary, decision})
      );
    } else {
      for (const decision of creates) {
        const outcome = await PrismaFactory.create({
          model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
          data: toRow({decision}),
          options: {bypassExtraQueries: true},
        });

        if (outcome.success) {
          summary.caseManagerLinksChanged += 1;
          recordCaseManagerChange({summary, decision});
        } else {
          reportWriteFailure({
            summary,
            hhaPatientIds: [decision.entry.hhaPatientId],
            error: outcome.error,
          });
        }
      }
    }
  }

  const moveGroups = groupDecisions({
    decisions: changes.filter(({cmRow}) => cmRow),
    keyOf: ({decision}) => decision.plan.caseManagerProfileId,
  });

  for (const group of moveGroups) {
    const {success, error} = await PrismaFactory.updateMany({
      model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
      query: {id: {in: group.map(({cmRow}) => cmRow.id)}},
      data: {
        caseManagerProfileId: group[0].plan.caseManagerProfileId,
        assignedAt: getCurrentTime(),
      },
      options: {bypassExtraQueries: true},
    });

    if (success) {
      summary.caseManagerLinksChanged += group.length;
      group.forEach((decision) => recordCaseManagerChange({summary, decision}));
    } else {
      reportWriteFailure({
        summary,
        hhaPatientIds: group.map(({entry}) => entry.hhaPatientId),
        error,
      });
    }
  }
};

const toCoordinatorRows = ({decision, organizationId}) =>
  decision.coordinators.map(({displayName, match}, index) => ({
    organizationId,
    patientId: decision.patient.id,
    slot: index + HHA_COORDINATOR_FIRST_SLOT,
    hhaCoordinatorName: displayName,
    caseManagerProfileId: match?.profileId || null,
  }));

const toRowsSignature = ({rows}) =>
  JSON.stringify(
    rows.map(({slot, hhaCoordinatorName, caseManagerProfileId}) => [
      slot,
      hhaCoordinatorName,
      caseManagerProfileId || null,
    ])
  );

/**
 * Store every coordinator HHA lists on each patient. Display only: these rows
 * grant nothing. Rewritten only for patients whose list changed.
 */
const writeCoordinatorRows = async ({decisions, organizationId, summary}) => {
  // A failed id lookup must not overwrite stored matches with "nobody".
  const readable = decisions.filter(
    ({coordinators, patient}) =>
      coordinators &&
      !patient.isDeleted &&
      !coordinators.some(({isLookupFailed}) => isLookupFailed)
  );

  if (readable.length === 0) return;

  const {success: rowsFound, docs: stored} = await PrismaFactory.find({
    model: modelConstants.MODELS.PATIENT_HHA_COORDINATOR,
    query: {patientId: {in: readable.map(({patient}) => patient.id)}},
    options: {bypassExtraQueries: true, sort: [{slot: 'asc'}]},
  });

  if (!rowsFound) {
    return reportLookupFailure({
      summary,
      detail: modelConstants.MODELS.PATIENT_HHA_COORDINATOR,
    });
  }

  const storedByPatientId = groupRowsBy({
    rows: stored,
    keyOf: ({row}) => row.patientId,
  });

  const changed = readable
    .map((decision) => ({
      decision,
      rows: toCoordinatorRows({decision, organizationId}),
    }))
    .filter(
      ({decision, rows}) =>
        toRowsSignature({rows}) !==
        toRowsSignature({
          rows: storedByPatientId.get(decision.patient.id) || [],
        })
    );

  if (changed.length === 0) return;

  const rows = changed.flatMap((entry) => entry.rows);

  try {
    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const removed = await PrismaFactory.hardDeleteMany({
          model: modelConstants.MODELS.PATIENT_HHA_COORDINATOR,
          query: {
            patientId: {in: changed.map(({decision}) => decision.patient.id)},
          },
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!removed.success) throw removed.error;
        if (rows.length === 0) return;

        const created = await PrismaFactory.create({
          model: modelConstants.MODELS.PATIENT_HHA_COORDINATOR,
          data: rows,
          options: {bypassExtraQueries: true},
          tx,
        });

        if (!created.success) throw created.error;
      },
    });
  } catch (error) {
    reportWriteFailure({
      summary,
      hhaPatientIds: changed.map(({decision}) => decision.entry.hhaPatientId),
      error,
    });
  }
};

/** A page where no record carries the element means HHAeXchange dropped it. */
const reportMissingElements = ({prepared, summary}) => {
  if (!prepared.some((entry) => entry.nurseRef.isKnown)) {
    recordException({
      summary,
      recordId: null,
      type: HHAX_SYNC_EXCEPTION_TYPES.PATIENT_NURSE_ELEMENT_MISSING,
    });
  }

  if (!prepared.some((entry) => entry.coordinatorRef.isKnown)) {
    recordException({
      summary,
      recordId: null,
      type: HHAX_SYNC_EXCEPTION_TYPES.PATIENT_COORDINATOR_ELEMENT_MISSING,
    });
  }
};

/** HHA nurses by HHA id and by profile id, each with whether they can be linked. */
const buildNurseLookup = ({profiles}) => {
  const byHhaId = new Map();
  const byProfileId = new Map();

  profiles.forEach((profile) => {
    const eligibility = resolveLinkEligibility({profile});

    const nurse = {
      profileId: profile.id,
      userId: profile.userId,
      hhaId: profile.hhaNurseId,
      eligibility,
      isEligible: eligibility === HHA_LINK_ELIGIBILITY.ELIGIBLE,
    };

    byHhaId.set(profile.hhaNurseId, nurse);
    byProfileId.set(profile.id, nurse);
  });

  return {byHhaId, byProfileId};
};

/** The person behind a pending id, once they can be linked; otherwise null. */
const findReadyPerson = ({profileId, people}) => {
  const person = profileId && people ? people.get(profileId) : null;

  return person?.isEligible ? person : null;
};

/** Patients waiting for someone: for one user's profiles, or for anyone. */
const findWaitingPatients = async ({organizationId, userId}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model: modelConstants.MODELS.PATIENT,
    query: Object.assign(organizationId ? {organizationId} : {}, {
      OR: [
        userId
          ? {hhaPendingNurse: {userId}}
          : {hhaPendingNurseProfileId: {not: null}},
        userId
          ? {hhaPendingCaseManager: {userId}}
          : {hhaPendingCaseManagerProfileId: {not: null}},
      ],
    }),
    options: {bypassExtraQueries: true},
    fieldsInclusion: {
      includeSpecificFields: PATIENT_LINK_FIELDS.concat(['organizationId']),
    },
  });

  if (!success) throw error;

  return docs;
};

/** Coordinators as the last run stored them, matched to today's case managers. */
const loadStoredCoordinators = async ({patientIds, coordinatorLookup}) => {
  if (patientIds.length === 0) return new Map();

  const {success, docs, error} = await PrismaFactory.find({
    model: modelConstants.MODELS.PATIENT_HHA_COORDINATOR,
    query: {patientId: {in: patientIds}},
    options: {bypassExtraQueries: true, sort: [{slot: 'asc'}]},
  });

  if (!success) throw error;

  return groupRowsBy({
    rows: docs.map((row) => {
      const match =
        coordinatorLookup.byProfileId.get(row.caseManagerProfileId) || null;

      return {
        patientId: row.patientId,
        name: row.hhaCoordinatorName,
        match,
        kind: match
          ? HHAX_COORDINATOR_MATCH_KINDS.MATCHED
          : HHAX_COORDINATOR_MATCH_KINDS.UNKNOWN,
      };
    }),
    keyOf: ({row}) => row.patientId,
  });
};

const loadCaseManagerRows = async ({patientIds}) => {
  if (patientIds.length === 0) return new Map();

  const {success, docs, error} = await PrismaFactory.find({
    model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
    query: {patientId: {in: patientIds}},
    options: {bypassExtraQueries: true},
    fieldsInclusion: {
      includeSpecificFields: ['id', 'patientId', 'caseManagerProfileId'],
    },
  });

  if (!success) throw error;

  return new Map(docs.map((row) => [row.patientId, row]));
};

/**
 * Plan the patients whose pending person is active now, from stored data. A
 * patient is planned only for the link that became ready: the other one keeps
 * waiting for its own feed page.
 */
const planStoredPatients = async ({patients, lookups}) => {
  const {nurseLookup, coordinatorLookup} = lookups;

  const ready = patients
    .map((patient) => ({
      patient,
      nurse: findReadyPerson({
        profileId: patient.hhaPendingNurseProfileId,
        people: nurseLookup?.byProfileId,
      }),
      caseManager: findReadyPerson({
        profileId: patient.hhaPendingCaseManagerProfileId,
        people: coordinatorLookup?.byProfileId,
      }),
    }))
    .filter(({nurse, caseManager}) => nurse || caseManager);

  const caseManagerPatientIds = ready
    .filter(({caseManager}) => caseManager)
    .map(({patient}) => patient.id);

  const cmRowsByPatientId = await loadCaseManagerRows({
    patientIds: caseManagerPatientIds,
  });

  const coordinatorsByPatientId = await loadStoredCoordinators({
    patientIds: caseManagerPatientIds,
    coordinatorLookup,
  });

  return ready.map(({patient, nurse, caseManager}) => {
    const cmRow = cmRowsByPatientId.get(patient.id) || null;

    const entry = {
      hhaPatientId: patient.hhaPatientId,
      nurseRef: nurse
        ? {isKnown: true, hhaNurseId: nurse.hhaId}
        : {isKnown: false},
    };

    const plan = planPatientLinks({
      entry,
      current: patient,
      coordinators: caseManager
        ? coordinatorsByPatientId.get(patient.id) || []
        : null,
      currentCaseManagerProfileId: cmRow?.caseManagerProfileId || null,
      nurseLookup,
      caseManagerByProfileId: coordinatorLookup?.byProfileId || null,
      secondaryCoverage: null,
    });

    return {entry, patient, plan, cmRow, nurse, caseManager};
  });
};

/** How many patients each ready person got, and how many still need a choice. */
const tallyStoredDecisions = ({decisions, failedIds}) => {
  const tally = new Map();

  const count = ({kind, person, isAssigned, isWaiting}) => {
    if (!person) return;

    const key = `${kind}:${person.profileId}`;

    if (!tally.has(key))
      tally.set(key, {kind, person, assigned: 0, waiting: 0});

    if (isAssigned) tally.get(key).assigned += 1;
    if (isWaiting) tally.get(key).waiting += 1;
  };

  decisions.forEach(({entry, plan, nurse, caseManager}) => {
    const isWritten =
      plan.exceptions.length === 0 && !failedIds.has(entry.hhaPatientId);

    count({
      kind: HHA_SYNC_RECORD_KINDS.NURSE,
      person: nurse,
      isAssigned:
        isWritten && plan.patch.primaryNurseProfileId === nurse?.profileId,
      isWaiting: !isWritten,
    });

    count({
      kind: HHA_SYNC_RECORD_KINDS.CASE_MANAGER,
      person: caseManager,
      isAssigned:
        isWritten && plan.caseManagerProfileId === caseManager?.profileId,
      isWaiting: !isWritten,
    });
  });

  return Array.from(tally.values());
};

/** The person is active and linked, so their open "waiting" exception is done. */
const closeWaitingPersonException = async ({
  organizationId,
  kind,
  person,
  assigned,
  waiting,
}) =>
  await PrismaFactory.updateMany({
    model: modelConstants.MODELS.HHA_SYNC_EXCEPTION,
    query: {
      organizationId,
      type: {in: Object.values(HHA_PENDING_PERSON_EXCEPTION_TYPES[kind])},
      detail: person.hhaId,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
    },
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
      resolvedAt: getCurrentTime(),
      resolvedByUserId: person.userId,
      resolutionNote: [HHA_PENDING_LINKS_RESOLUTION_NOTE.ASSIGNED, assigned]
        .concat(
          waiting > 0
            ? [HHA_PENDING_LINKS_RESOLUTION_NOTE.WAITING, waiting]
            : []
        )
        .join(''),
    },
    options: {bypassExtraQueries: true},
  });

module.exports = class HhaPatientLinkSyncServices {
  /**
   * Everything a run links patients against, read once. A failed read skips
   * that link kind for the run rather than failing the patient import.
   *
   * @returns {Promise<{nurseLookup: Object|null, coordinatorLookup: Object|null}>}
   */
  static async buildRunLookups({organizationId, summary}) {
    // includeDeleted: an archived nurse is known but not active, not unknown.
    const nurses = await PrismaFactory.find({
      model: modelConstants.MODELS.NURSE_PROFILE,
      query: {organizationId, hhaNurseId: {not: null}},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {include: LINK_ELIGIBILITY_SELECT},
    });

    const caseManagers = await PrismaFactory.find({
      model: modelConstants.MODELS.CASE_MANAGER_PROFILE,
      query: {organizationId, source: CASE_MANAGER_SOURCES.HHA_EXCHANGE.value},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        include: {
          status: true,
          isDeleted: true,
          user: {select: {isVerified: true}},

          // The name a coordinator is matched by is the one in this org.
          userOrganization: {select: {firstName: true, lastName: true}},
        },
      },
    });

    if (!nurses.success) {
      reportLookupFailure({
        summary,
        detail: modelConstants.MODELS.NURSE_PROFILE,
      });
    }

    if (!caseManagers.success) {
      reportLookupFailure({
        summary,
        detail: modelConstants.MODELS.CASE_MANAGER_PROFILE,
      });
    }

    return {
      nurseLookup: nurses.success
        ? buildNurseLookup({profiles: nurses.docs})
        : null,
      coordinatorLookup: caseManagers.success
        ? buildCoordinatorLookup({profiles: caseManagers.docs})
        : null,
    };
  }

  /**
   * Report each person patients wait for, once per person. Read from the
   * stored pending ids after the last page, so the row stands for all their
   * patients and closes by itself when none wait any more.
   */
  static async reportWaitingPeople({organizationId, summary, lookups}) {
    for (const {kind, readPeople} of WAITING_PERSON_KINDS) {
      const people = readPeople({lookups});
      const field = HHA_PENDING_PERSON_PATIENT_FIELDS[kind];

      // No lookup: who is active is unknown, so nobody is reported as waiting.
      if (!people) continue;

      const {success, docs} = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query: {organizationId, [field]: {not: null}},
        options: {bypassExtraQueries: true},
        fieldsInclusion: {includeSpecificFields: [field]},
      });

      if (!success) {
        reportLookupFailure({summary, detail: modelConstants.MODELS.PATIENT});

        continue;
      }

      new Set(docs.map((doc) => doc[field])).forEach((profileId) => {
        const person = people.get(profileId);

        if (!person || person.isEligible) return;

        recordException({
          summary,
          recordId: null,
          type: HHA_PENDING_PERSON_EXCEPTION_TYPES[kind][person.eligibility],
          detail: person.hhaId,
          relatedUserId: person.userId,
        });
      });
    }
  }

  /**
   * Link the patients waiting for people who are active now: one user's, right
   * after they accept an invitation, or everyone's at the end of a run. Only
   * clear-cut patients are written. One that needs an admin's choice keeps
   * waiting, because only a run can report a conflict.
   *
   * @returns {Promise<{success: boolean, assigned: number}>} Never throws.
   */
  static async applyPendingLinks({
    organizationId = null,
    userId = null,
    isOrganizationBusy = null,
  }) {
    try {
      const waiting = await findWaitingPatients({organizationId, userId});

      const byOrganization = groupRowsBy({
        rows: waiting,
        keyOf: ({row}) => row.organizationId,
      });

      let assigned = 0;

      for (const [patientOrganizationId, patients] of byOrganization) {
        // A sync running in that organization does this itself in its last step.
        if (
          isOrganizationBusy &&
          (await isOrganizationBusy({organizationId: patientOrganizationId}))
        ) {
          continue;
        }

        const summary = buildSummary({
          trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
          resource: HHAX_SYNC_RESOURCES.PATIENTS.value,
          organizationId: patientOrganizationId,
        });

        const lookups = await HhaPatientLinkSyncServices.buildRunLookups({
          organizationId: patientOrganizationId,
          summary,
        });

        const decisions = (
          await planStoredPatients({patients, lookups})
        ).filter(
          ({nurse, caseManager}) =>
            !userId ||
            nurse?.userId === userId ||
            caseManager?.userId === userId
        );

        const clean = decisions.filter(
          ({plan}) => plan.exceptions.length === 0
        );

        await writePatientPatches({decisions: clean, summary});

        await writeCaseManagerLinks({
          decisions: clean,
          organizationId: patientOrganizationId,
          summary,
        });

        const people = tallyStoredDecisions({
          decisions,
          failedIds: new Set(
            summary.exceptions.map((exception) => exception.recordId)
          ),
        });

        for (const tallied of people) {
          assigned += tallied.assigned;

          await closeWaitingPersonException(
            Object.assign({organizationId: patientOrganizationId}, tallied)
          );
        }
      }

      return {success: true, assigned};
    } catch (error) {
      // Code and class only: a Prisma message echoes rows, which carry HHA data.
      logger.error('HHA pending links could not be applied', {
        error: error?.code || error?.name || null,
      });

      return {success: false, assigned: 0};
    }
  }

  /**
   * Reconcile county and links for one page's prepared records.
   *
   * @param {Object} params
   * @param {Object[]} params.prepared - From the patient runner's prepareRecords.
   * @param {string} params.organizationId
   * @param {Object} params.summary
   * @param {Object} params.lookups - From buildRunLookups.
   */
  static async reconcilePage({prepared, organizationId, summary, lookups}) {
    if (prepared.length === 0) return;

    reportMissingElements({prepared, summary});

    const {success: patientsFound, docs: patients} = await PrismaFactory.find({
      model: modelConstants.MODELS.PATIENT,
      query: {
        organizationId,
        hhaPatientId: {in: prepared.map((entry) => entry.hhaPatientId)},
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {includeSpecificFields: PATIENT_LINK_FIELDS},
    });

    if (!patientsFound) {
      reportLookupFailure({summary, detail: modelConstants.MODELS.PATIENT});

      return;
    }

    const patientsByHhaId = new Map(
      patients.map((patient) => [patient.hhaPatientId, patient])
    );

    const {success: cmRowsFound, docs: cmRows} = await PrismaFactory.find({
      model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
      query: {patientId: {in: patients.map((patient) => patient.id)}},
      options: {bypassExtraQueries: true},
      fieldsInclusion: {
        includeSpecificFields: ['id', 'patientId', 'caseManagerProfileId'],
      },
    });

    if (!cmRowsFound) {
      reportLookupFailure({
        summary,
        detail: modelConstants.MODELS.CASE_MANAGER_PATIENT,
      });
    }

    const cmRowsByPatientId = new Map(
      (cmRows || []).map((row) => [row.patientId, row])
    );

    // Without the current links a "change" cannot be told from a no-op.
    const coordinatorLookup = cmRowsFound ? lookups.coordinatorLookup : null;

    const secondaryCoverage = await loadSecondaryCoverage({
      prepared,
      patientsByHhaId,
    });

    const decisions = [];

    for (const entry of prepared) {
      const patient = patientsByHhaId.get(entry.hhaPatientId);

      if (!patient) continue;

      const cmRow = cmRowsByPatientId.get(patient.id) || null;

      const coordinators = patient.isDeleted
        ? null
        : await resolveCoordinators({
            entry,
            coordinatorLookup,
            organizationId,
          });

      const plan = planPatientLinks({
        entry,
        current: patient,
        coordinators,
        currentCaseManagerProfileId: cmRow?.caseManagerProfileId || null,
        nurseLookup: lookups.nurseLookup,
        caseManagerByProfileId: coordinatorLookup?.byProfileId || null,
        secondaryCoverage,
      });

      plan.exceptions.forEach((exception) =>
        recordException({
          summary,
          recordId: entry.hhaPatientId,
          type: exception.type,
          detail: exception.detail,
          relatedUserId: exception.relatedUserId,
        })
      );

      decisions.push({plan, patient, entry, cmRow, coordinators});
    }

    await writePatientPatches({decisions, summary});
    await writeCaseManagerLinks({decisions, organizationId, summary});
    await writeCoordinatorRows({decisions, organizationId, summary});
  }

  /**
   * Give stored patients the county their ZIP resolves to in `countyLookup`,
   * outside a run: an admin has just added that county. County only -- nurses
   * and case managers come from the feed, so they wait for the next sync.
   *
   * @returns {Promise<{success: boolean, hhaPatientIds: string[]}>} The
   *   patients that now hold the county.
   */
  static async applyCountyToStoredPatients({organizationId, countyLookup}) {
    const {success, docs: patients} = await PrismaFactory.find({
      model: modelConstants.MODELS.PATIENT,
      query: {organizationId, hhaPatientId: {not: null}},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        includeSpecificFields: PATIENT_LINK_FIELDS.concat(
          PATIENT_ADDRESS_FIELDS
        ),
      },
    });

    if (!success) return {success: false, hhaPatientIds: []};

    const patientsByHhaId = new Map();
    const prepared = [];

    for (const patient of patients) {
      const {countyId, regionId} = resolveCountyFromZip({
        state: patient.state,
        zipCode: patient.zipCode,
        countyLookup,
      });

      // Only patients this lookup places. The rest would read as unresolved
      // and have a county some other lookup entry gave them unlocked.
      if (!countyId) continue;

      patientsByHhaId.set(patient.hhaPatientId, patient);
      prepared.push({hhaPatientId: patient.hhaPatientId, countyId, regionId});
    }

    const secondaryCoverage = await loadSecondaryCoverage({
      prepared,
      patientsByHhaId,
    });

    const decisions = prepared
      .map((entry) => {
        const patient = patientsByHhaId.get(entry.hhaPatientId);

        const plan = planPatientLinks({
          entry,
          current: patient,
          coordinators: null,
          currentCaseManagerProfileId: null,
          nurseLookup: null,
          caseManagerByProfileId: null,
          secondaryCoverage,
        });

        return {entry, patient, plan};
      })

      // A move that clears the secondary nurse must be reported, and only a
      // run can report: those patients wait for the next sync.
      .filter(({plan}) => plan.exceptions.length === 0);

    const summary = buildSummary({
      trigger: HHAX_SYNC_TRIGGERS.MANUAL.value,
      resource: HHAX_SYNC_RESOURCES.PATIENTS.value,
      organizationId,
    });

    await writePatientPatches({decisions, summary});

    const failedIds = new Set(
      summary.exceptions.map((exception) => exception.recordId)
    );

    return {
      success: true,
      hhaPatientIds: decisions
        .map(({entry}) => entry.hhaPatientId)
        .filter((hhaPatientId) => !failedIds.has(hhaPatientId)),
    };
  }
};
