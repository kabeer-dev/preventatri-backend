/**
 * Read side of the HHAeXchange visit import.
 *
 * Serves what hhaVisitSyncServices stored and nothing else: there is no
 * create, update or delete here because the table is a one-way mirror of the
 * agency's schedule. Named hhaVisitsServices (plural, entity-style) to sit
 * beside patientsServices; the singular hhaVisitSyncServices is the runner.
 */

const {
  HHA_VISIT_DERIVED_STATUSES,
  HHA_VISIT_UNCONFIRMABLE_STATUSES,
  HHA_VISIT_STATUS_FILTER_ALL,
  HHA_VISIT_TYPE_FILTER_ALL,
  HHA_VISIT_DEFAULT_SORT,
  HHA_VISIT_SEARCH_NAME_FIELDS,
} = require('../constants/hhaVisitsConstants');
const modelConstants = require('../constants/modelConstants');
const PrismaFactory = require('../factories/PrismaFactory');

const {safeMerge} = require('../utils');
const {getToday} = require('../utils/dateUtils');

const UNCONFIRMED = HHA_VISIT_DERIVED_STATUSES.UNCONFIRMED.value;

/** Scheduled end passed; visit day passed when HHA sent no end time. */
const buildSlotEndedClause = ({now, today}) => ({
  OR: [
    {scheduledEndAt: {lt: now}},
    {scheduledEndAt: null, visitDate: {lt: today}},
  ],
});

// Positive form, not NOT(ended): NOT on a null column drops the row in SQL.
const buildSlotOpenClause = ({now, today}) => ({
  OR: [
    {scheduledEndAt: {gte: now}},
    {scheduledEndAt: null, visitDate: {gte: today}},
  ],
});

/** Must stay in step with resolveVisitStatus. */
const buildVisitStatusClause = ({status, now, today}) => {
  if (!status || status === HHA_VISIT_STATUS_FILTER_ALL) return null;

  if (status === UNCONFIRMED) {
    return {
      AND: [
        {status: {in: HHA_VISIT_UNCONFIRMABLE_STATUSES}},
        buildSlotEndedClause({now, today}),
      ],
    };
  }

  if (HHA_VISIT_UNCONFIRMABLE_STATUSES.includes(status)) {
    return {AND: [{status}, buildSlotOpenClause({now, today})]};
  }

  return {status};
};

/** The status the page shows; must stay in step with buildVisitStatusClause. */
const resolveVisitStatus = ({visit, now, today}) => {
  if (!HHA_VISIT_UNCONFIRMABLE_STATUSES.includes(visit.status)) {
    return visit.status;
  }

  const hasSlotEnded = visit.scheduledEndAt
    ? new Date(visit.scheduledEndAt) < now
    : new Date(visit.visitDate) < today;

  return hasSlotEnded ? UNCONFIRMED : visit.status;
};

const withResolvedStatus = ({visit, now, today}) =>
  visit
    ? Object.assign({}, visit, {
        status: resolveVisitStatus({visit, now, today}),
      })
    : visit;

/** Free-text search: the four name snapshots by case-insensitive substring. */
const buildVisitSearchClause = ({search}) => {
  if (!search) return null;

  return {
    OR: HHA_VISIT_SEARCH_NAME_FIELDS.map((field) => ({
      [field]: {contains: search, mode: 'insensitive'},
    })),
  };
};

/**
 * visit_date is a DATE column, so the bounds are compared as calendar days.
 * Both ends are inclusive.
 */
const buildVisitDateClause = ({dateFrom, dateTo}) => {
  if (!dateFrom && !dateTo) return null;

  const range = {};

  if (dateFrom) range.gte = dateFrom;
  if (dateTo) range.lte = dateTo;

  return {visitDate: range};
};

module.exports = class HhaVisitsServices {
  /**
   * Page through the organization's imported visits.
   *
   * `status` narrows to one HhaVisitStatus or UNCONFIRMED (see
   * buildVisitStatusClause); omitted or "all" returns every
   * status, DELETED included -- a cancelled visit is kept precisely so it can
   * be seen, so it is never hidden by default. `visitType` narrows to one
   * HhaVisitType the same way; "all" also keeps the rows whose VisitType the
   * feed sent in a spelling the mapper could not resolve, which are stored as
   * null and would otherwise be unreachable from the page.
   *
   * @returns {Promise<{success, docs, count, error}>}
   */
  static async listHhaVisits({
    organizationId,
    status,
    visitType,
    search,
    dateFrom,
    dateTo,
    skip = 0,
    take = 25,
    sort = null,
  }) {
    try {
      const query = {organizationId};
      const now = new Date();
      const today = getToday();

      if (visitType && visitType !== HHA_VISIT_TYPE_FILTER_ALL) {
        query.visitType = visitType;
      }

      const dateClause = buildVisitDateClause({dateFrom, dateTo});
      if (dateClause) Object.assign(query, dateClause);

      // AND-ed, not merged: the status and search clauses both carry an OR.
      const andClauses = [
        buildVisitStatusClause({status, now, today}),
        buildVisitSearchClause({search}),
      ].filter(Boolean);
      if (andClauses.length > 0) query.AND = andClauses;

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.HHA_VISIT,
        query,
        options: {skip, take, sort: sort || HHA_VISIT_DEFAULT_SORT},
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.HHA_VISIT,
        query,
      });

      // Object.assign, not safeMerge: safeMerge unions arrays, doubling docs.
      return Object.assign({}, result, {
        docs: (result.docs || []).map((visit) =>
          withResolvedStatus({visit, now, today})
        ),
        count: countResult.success ? countResult.count : 0,
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  /**
   * One imported visit by PreventaTri id, scoped to the caller's organization.
   *
   * @returns {Promise<{success, doc, error}>}
   */
  static async getHhaVisitById({id, organizationId}) {
    const result = await PrismaFactory.findOne({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {id, organizationId},
    });

    return safeMerge({
      originalObj: result,
      newObj: {
        doc: withResolvedStatus({
          visit: result.doc,
          now: new Date(),
          today: getToday(),
        }),
      },
    });
  }
};
