/**
 * HHAeXchange -> PreventaTri patient reconciliation.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * The run is a single agency-wide pass. GetPatientChangesV3 returns every
 * office's patients when OfficeID is omitted, so there is no office discovery
 * step and no per-office loop. Office is not stored either: nothing in
 * PreventaTri ever read hhaOfficeId.
 *
 * The pass is full rather than incremental because lookbackDays is wide enough
 * to mean "everything". It is affordable because writes are hash-gated: an
 * unchanged roster produces zero field updates.
 *
 * Ownership is the rule everything else follows from. Sync owns the fields in
 * HHA_MANAGED_PATIENT_FIELDS and overwrites them freely. PreventaTri owns
 * email, riskLevel, notes, diagnoses and the secondary nurse -- they are absent
 * from every update payload this module builds.
 *
 * County and the links (primary nurse, case manager) are written by
 * hhaPatientLinkSyncServices after each page's rows exist. The county comes
 * from the ZIP and is owned while it resolves; an unresolved patient keeps its
 * county for an admin to set -- idx_patients_unresolved_county is the worklist.
 *
 * Extracted from hhaSyncServices when caregivers joined the run: that module is
 * now the resource-agnostic orchestrator, and this one holds everything that is
 * specific to patients.
 */

const CountiesServices = require('./countiesServices');
const HhaExchangeServices = require('./hhaExchangeServices');
const HhaPatientLinkSyncServices = require('./hhaPatientLinkSyncServices');

const {
  HHA_DERIVED_PATIENT_FIELDS,
  HHA_MANAGED_PATIENT_FIELDS,
  HHA_SYNC_CHANGE_ACTIONS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_PATIENT_ELEMENTS,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const {PATIENT_SOURCES} = require('../constants/patientsConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');
const {resolveCountyFromZip} = require('../utils/hhaExchange/countyResolver');

const {
  mapHhaPatient,
  readPatientNurseRef,
  readPatientCoordinatorRefs,
  computePatientSyncHash,
} = require('../utils/hhaExchange/patientMapper');
const {normalizeValue} = require('../utils/hhaExchange/soapClient');

const {
  diffFields,
  snapshotFields,
} = require('../utils/hhaExchange/syncChangeUtils');

const {
  markRecordSeen,
  recordChange,
  recordException,
  walkPagedFeed,
} = require('../utils/hhaExchange/syncRunUtils');

/**
 * Map and fingerprint one page of records, without touching the database.
 *
 * Pure apart from the counters: every record is mapped, hashed and validated
 * up front so the whole page can then be reconciled in a handful of queries
 * rather than one round trip per patient.
 *
 * @returns {Object[]} One prepared entry per importable record.
 */
const prepareRecords = ({records, summary, countyLookup}) => {
  const prepared = [];

  for (const record of records) {
    summary.seen += 1;

    const hhaPatientId = normalizeValue({
      value: record[HHAX_PATIENT_ELEMENTS.PATIENT_ID],
    });

    markRecordSeen({summary, recordId: hhaPatientId});

    if (!hhaPatientId) {
      recordException({
        summary,
        recordId: null,
        type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_PATIENT_ID,
      });
      summary.failed += 1;

      continue;
    }

    const {mapped, exceptions, isValid} = mapHhaPatient({record});

    exceptions.forEach((exception) =>
      recordException({
        summary,
        recordId: hhaPatientId,
        type: exception.type,
        detail: exception.detail,
      })
    );

    // firstName / lastName / dateOfBirth are NOT NULL. Skipping beats letting
    // the insert fail, so one incomplete record never costs us the rest of the
    // page.
    if (!isValid) {
      summary.failed += 1;

      continue;
    }

    // No lookup (counties failed to load): county stays undefined = untouched.
    const {countyId, regionId, exceptionType, detail} = countyLookup
      ? resolveCountyFromZip({
          state: mapped.state,
          zipCode: mapped.zipCode,
          countyLookup,
        })
      : {};

    if (exceptionType) {
      recordException({
        summary,
        recordId: hhaPatientId,
        type: exceptionType,
        detail,
      });
    }

    // County and links ride beside `mapped`, never inside it: they resolve
    // against PreventaTri data, so they must not move the sync hash.
    prepared.push({
      hhaPatientId,
      mapped,
      countyId,
      regionId,
      nurseRef: readPatientNurseRef({record}),
      coordinatorRef: readPatientCoordinatorRefs({record}),
      syncHash: computePatientSyncHash({mapped}),
    });
  }

  return prepared;
};

const CREATED_PATIENT_FIELDS = HHA_MANAGED_PATIENT_FIELDS.concat(
  HHA_DERIVED_PATIENT_FIELDS
);

const recordPatientCreate = ({summary, row}) =>
  recordChange({
    summary,
    recordId: row.hhaPatientId,
    action: HHA_SYNC_CHANGE_ACTIONS.CREATED.value,
    changes: snapshotFields({
      after: row,
      fields: CREATED_PATIENT_FIELDS,
    }),
  });

/**
 * Create the patients on this page that PreventaTri has never seen.
 *
 * One createMany for the whole batch, falling back to individual inserts if it
 * fails. The fallback is what keeps the run honest: createMany is all-or-
 * nothing, so without it a single bad row would silently cost the other 99 and
 * the summary would report a batch-level failure with no way to tell which
 * record caused it.
 */
const createNewPatients = async ({toCreate, organizationId, summary}) => {
  if (toCreate.length === 0) return;

  const rows = toCreate.map((entry) =>
    Object.assign({}, entry.mapped, {
      hhaSyncHash: entry.syncHash,
      hhaLastSyncedAt: getCurrentTime(),
      organizationId,
      hhaPatientId: entry.hhaPatientId,
      countyId: entry.countyId || null,
      isCountyHhaManaged: Boolean(entry.countyId),
      source: PATIENT_SOURCES.HHA_EXCHANGE.value,
    })
  );

  const {success} = await PrismaFactory.create({
    model: modelConstants.MODELS.PATIENT,
    data: rows,
    options: {bypassExtraQueries: true},
  });

  if (success) {
    summary.created += rows.length;
    rows.forEach((row) => recordPatientCreate({summary, row}));

    return;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const outcome = await PrismaFactory.create({
      model: modelConstants.MODELS.PATIENT,
      data: rows[index],
      options: {bypassExtraQueries: true},
    });

    if (outcome.success) {
      summary.created += 1;
      recordPatientCreate({summary, row: rows[index]});

      continue;
    }

    recordException({
      summary,
      recordId: toCreate[index].hhaPatientId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: outcome.error?.code || null,
    });
    summary.failed += 1;
  }
};

/**
 * Refresh the patients on this page whose HHAeXchange-owned fields changed.
 *
 * Still one statement per patient — Prisma cannot express differing values per
 * row in a single updateMany — but with no surrounding transaction. A lone
 * UPDATE is already atomic, and wrapping it cost a BEGIN and a COMMIT round
 * trip for nothing.
 *
 * includeDeleted is load-bearing: an archived HHA patient must be updated IN
 * PLACE, leaving deleted_at untouched. Without it the soft-delete extension
 * hides the row, the update fails, and the archive would appear to undo itself.
 */
const updateChangedPatients = async ({toUpdate, summary}) => {
  for (const {entry, existing} of toUpdate) {
    const {success, error} = await PrismaFactory.updateOne({
      model: modelConstants.MODELS.PATIENT,
      query: {id: existing.id},
      data: Object.assign({}, entry.mapped, {
        hhaSyncHash: entry.syncHash,
        hhaLastSyncedAt: getCurrentTime(),
      }),
      options: {bypassExtraQueries: true, includeDeleted: true},
    });

    if (!success) {
      recordException({
        summary,
        recordId: entry.hhaPatientId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: error?.code || null,
      });
      summary.failed += 1;

      continue;
    }

    summary.updated += 1;

    recordChange({
      summary,
      recordId: entry.hhaPatientId,
      action: HHA_SYNC_CHANGE_ACTIONS.UPDATED.value,
      changes: diffFields({
        before: existing,
        after: entry.mapped,
        fields: HHA_MANAGED_PATIENT_FIELDS,
      }),
    });

    // Archive is a PreventaTri decision. The record is refreshed but stays
    // archived — deleted_at is never in the update payload.
    if (existing.isDeleted) {
      recordException({
        summary,
        recordId: entry.hhaPatientId,
        type: HHAX_SYNC_EXCEPTION_TYPES.ARCHIVED_PATIENT_UPDATED,
      });
    }
  }
};

/**
 * Reconcile one page of the change feed.
 *
 * Batched deliberately. The previous shape did a findOne plus a write for every
 * patient, which put roughly 250 sequential round trips behind a 100-record
 * page and made the run's cost almost entirely database latency rather than
 * HHAeXchange latency. This does one read, one bulk touch for the unchanged
 * majority, and a write only for records that actually differ.
 */
const processPatientPage = async ({
  records,
  organizationId,
  summary,
  countyLookup,
  linkLookups,
}) => {
  const prepared = prepareRecords({records, summary, countyLookup});

  if (prepared.length === 0) return {success: true};

  // includeDeleted: an archived HHA patient must be found, so it is updated in
  // place rather than re-created as a duplicate on every nightly run.
  //
  // hhaSyncHash MUST be requested explicitly. It is deliberately absent from the
  // Patient default field set (see modelSchemaConfig) because it is internal
  // state that never leaves the server — but that also means a plain read
  // returns it as undefined, which would never match a freshly computed hash and
  // would send every record down the write path on every run.
  const {success: lookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.PATIENT,
      query: {
        organizationId,
        hhaPatientId: {in: prepared.map((entry) => entry.hhaPatientId)},
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {
        // The managed fields are the "before" of the change history.
        includeSpecificFields: [
          'id',
          'hhaPatientId',
          'hhaSyncHash',
          'isDeleted',
          'countyId',
        ].concat(HHA_MANAGED_PATIENT_FIELDS),
      },
    });

  // A failed lookup must never masquerade as an empty result. docs defaults to
  // [], so ignoring success would classify every record on the page as new and
  // send the whole page into createNewPatients as duplicate inserts.
  if (!lookupSucceeded) {
    return {success: false};
  }

  const existingByHhaId = new Map(
    existingDocs.map((doc) => [doc.hhaPatientId, doc])
  );

  const unchangedIds = [];
  const toUpdate = [];
  const toCreate = [];

  for (const entry of prepared) {
    const existing = existingByHhaId.get(entry.hhaPatientId);

    if (!existing) {
      toCreate.push(entry);

      continue;
    }

    if (existing.hhaSyncHash === entry.syncHash) {
      unchangedIds.push(existing.id);

      continue;
    }

    toUpdate.push({entry, existing});
  }

  // The unchanged majority costs exactly one statement for the whole page:
  // nothing HHAeXchange owns has changed, so only the sync timestamp moves.
  if (unchangedIds.length > 0) {
    await PrismaFactory.updateMany({
      model: modelConstants.MODELS.PATIENT,
      query: {id: {in: unchangedIds}},
      data: {hhaLastSyncedAt: getCurrentTime()},
      options: {bypassExtraQueries: true, includeDeleted: true},
    });
    summary.skipped += unchangedIds.length;
  }

  await updateChangedPatients({toUpdate, summary});
  await createNewPatients({toCreate, organizationId, summary});

  // Last, so a patient created a moment ago is linked on the same run.
  await HhaPatientLinkSyncServices.reconcilePage({
    prepared,
    organizationId,
    summary,
    lookups: linkLookups,
  });

  return {success: true};
};

module.exports = class HhaPatientSyncServices {
  /**
   * Reconcile every page of the agency-wide patient change feed.
   *
   * One of the runners HhaSyncServices.runSync iterates. The lock, the
   * organization resolution and the summary lifecycle belong to the
   * orchestrator; this only walks the feed and writes.
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {string} params.modifiedAfter - Already formatted per HHAX_MODIFIED_AFTER_FORMAT.
   * @param {Object} params.summary - Mutated in place with the counters.
   * @returns {Promise<{success: boolean, error: Object|null}>}
   */
  static async runResourceSync({organizationId, modifiedAfter, summary}) {
    const {success: countiesLoaded, countyLookup} =
      await CountiesServices.buildCountyLookupForOrganization({organizationId});

    // A null lookup skips county entirely: an empty one would read every ZIP
    // as unresolvable and unlock every patient's county.
    if (!countiesLoaded) {
      logger.error(
        `[HhaPatientSync] could not load counties for organization ${organizationId}; counties left as they are`
      );
    }

    const linkLookups = await HhaPatientLinkSyncServices.buildRunLookups({
      organizationId,
      summary,
    });

    const outcome = await walkPagedFeed({
      fetchPage: async ({pageNumber}) =>
        await HhaExchangeServices.fetchPatientChanges({
          modifiedAfter,
          pageNumber,
        }),
      processPage: async ({records}) =>
        await processPatientPage({
          records,
          organizationId,
          summary,
          countyLookup: countiesLoaded ? countyLookup : null,
          linkLookups,
        }),
    });

    await HhaPatientLinkSyncServices.reportWaitingPeople({
      organizationId,
      summary,
      lookups: linkLookups,
    });

    return outcome;
  }
};
