/**
 * HHAeXchange API surface.
 *
 * Thin wrapper over the SOAP transport: builds each request body in schema
 * order, unwraps the response, and returns the house {success, doc|docs, error}
 * envelope. It never throws and holds no sync logic — the reconciliation rules
 * live in the per-resource sync services.
 *
 * Named `fetch*` per .claude/rules.md: these are API requests, not local reads.
 */

const {
  HHAX_OPERATIONS,
  HHAX_PAGINATION_ELEMENTS,
  HHAX_LOWERCASE_PAGINATION_ELEMENTS,
  HHAX_PATIENT_ELEMENTS,
  HHAX_CAREGIVER_ELEMENTS,
  HHAX_LANGUAGE_ELEMENTS,
  HHAX_COORDINATOR_ELEMENTS,
  HHAX_COORDINATOR_REQUEST_ELEMENTS,
  HHAX_NURSE_ELEMENTS,
  HHAX_NURSE_REQUEST_ELEMENTS,
  HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS,
  HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS,
  HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS,
  HHAX_VISIT_ELEMENTS,
  HHAX_DELETED_VISIT_ELEMENTS,
  HHAX_MISSED_REASON_ELEMENTS,
  HHAX_STATUS_FILTER_ALL,
  HHAX_REQUEST_ELEMENTS,
  HHAX_FIRST_PAGE_NUMBER,
} = require('../constants/hhaExchangeConstants');

const {
  callHhaOperation,
  unwrapArray,
  normalizeValue,
  findNode,
} = require('../utils/hhaExchange/soapClient');

const {
  buildElements,
  buildNestedElement,
} = require('../utils/hhaExchange/soapEnvelope');

/**
 * Every change feed shares one Pagination shape, so it is read once here
 * rather than per operation. Values arrive as strings (parseTagValue is off in
 * the parser, deliberately) and are coerced at the boundary.
 */
const readPagination = ({data}) => {
  // Without the lowercase fallback the caregiver walk stops after page 1.
  const names = findNode({node: data, key: HHAX_PAGINATION_ELEMENTS.PAGINATION})
    ? HHAX_PAGINATION_ELEMENTS
    : HHAX_LOWERCASE_PAGINATION_ELEMENTS;
  const pagination = findNode({node: data, key: names.PAGINATION});

  return {
    currentPage: Number(
      normalizeValue({value: pagination?.[names.CURRENT_PAGE]}) || 0
    ),
    totalRecords: Number(
      normalizeValue({value: pagination?.[names.TOTAL_RECORDS]}) || 0
    ),
    totalPages: Number(
      normalizeValue({value: pagination?.[names.TOTAL_PAGES]}) || 0
    ),
  };
};

/**
 * One page of a paginated change feed.
 *
 * OfficeID is deliberately not sent, for either feed. Omitting the element
 * returns every office's records in one feed, so the sync needs no office
 * discovery and no office id in configuration — each record carries its own
 * OfficeID anyway. Omitted is not the same as empty: buildElement renders an
 * empty value as <OfficeID />, and that self-closing tag makes HHAeXchange
 * answer HTTP 500 on every retry (confirmed 2026-08-31 on the patient feed), so
 * the key must be ABSENT rather than blank.
 *
 * `modifiedAfter` is REQUIRED by HHAeXchange (omitting it returns ErrorID -315)
 * and must match HHAX_MODIFIED_AFTER_FORMAT.
 * `pageNumber` is 1-based; 0 is rejected.
 *
 * Element order matters: HHAeXchange validates the body against an xs:sequence,
 * so the fields object below must stay in schema order.
 */
const fetchChangeFeedPage = async ({
  operation,
  changesInfoElement,
  modifiedAfter,
  pageNumber,
}) => {
  const fields = {};
  fields[HHAX_REQUEST_ELEMENTS.MODIFIED_AFTER] = modifiedAfter;
  fields[HHAX_REQUEST_ELEMENTS.PAGE_NUMBER] = pageNumber;

  const {success, data, error} = await callHhaOperation({
    operation,
    body: buildElements({fields}),
  });

  if (!success) {
    return {success: false, docs: [], pagination: null, error};
  }

  return {
    success: true,
    docs: unwrapArray({
      value: findNode({node: data, key: changesInfoElement}),
    }),
    pagination: readPagination({data}),
    error: null,
  };
};

/**
 * One record from a demographics operation. Request and response both wrap
 * the fields in the same `infoElement`, e.g. `<CaregiverInfo><ID>`.
 */
const fetchDemographicsRecord = async ({operation, infoElement, id}) => {
  const fields = {};
  fields[HHAX_DEMOGRAPHICS_REQUEST_ELEMENTS.ID] = id;

  const {success, data, error} = await callHhaOperation({
    operation,
    body: buildNestedElement({
      name: infoElement,
      children: buildElements({fields}),
    }),
  });

  if (!success) {
    return {success: false, doc: null, error};
  }

  return {
    success: true,
    doc: findNode({node: data, key: infoElement}) || null,
    error: null,
  };
};

module.exports = class HhaExchangeServices {
  /**
   * One page of the patient change feed for the whole agency.
   *
   * @param {Object} params
   * @param {string} params.modifiedAfter - Already formatted per HHAX_MODIFIED_AFTER_FORMAT.
   * @param {number} [params.pageNumber]
   * @returns {Promise<{success, docs, pagination, error}>}
   */
  static async fetchPatientChanges({
    modifiedAfter,
    pageNumber = HHAX_FIRST_PAGE_NUMBER,
  }) {
    return await fetchChangeFeedPage({
      operation: HHAX_OPERATIONS.GET_PATIENT_CHANGES,
      changesInfoElement: HHAX_PATIENT_ELEMENTS.CHANGES_INFO,
      modifiedAfter,
      pageNumber,
    });
  }

  /**
   * One page of the caregiver change feed for the whole agency.
   *
   * GetCaregiverChangesV3 takes the identical request elements as the patient
   * feed, in the same xs:sequence order, and answers with the same Pagination
   * shape — which is why both go through one helper rather than two near-copies.
   *
   * @param {Object} params
   * @param {string} params.modifiedAfter - Already formatted per HHAX_MODIFIED_AFTER_FORMAT.
   * @param {number} [params.pageNumber]
   * @returns {Promise<{success, docs, pagination, error}>}
   */
  static async fetchCaregiverChanges({
    modifiedAfter,
    pageNumber = HHAX_FIRST_PAGE_NUMBER,
  }) {
    return await fetchChangeFeedPage({
      operation: HHAX_OPERATIONS.GET_CAREGIVER_CHANGES,
      changesInfoElement: HHAX_CAREGIVER_ELEMENTS.CHANGES_INFO,
      modifiedAfter,
      pageNumber,
    });
  }

  /**
   * The agency's language master list.
   *
   * Needed because the caregiver feed sends Language1 as a numeric LanguageID
   * rather than a name. Takes Authentication only — no OfficeID, no
   * ModifiedAfter, no pagination — so it is one cheap call per sync run rather
   * than per page or per record.
   *
   * Returns a plain `{[languageId]: languageName}` lookup so callers never have
   * to re-walk the parsed XML. A failure is NOT fatal to a sync: the caller
   * falls back to an empty map, every caregiver language records an
   * UNMAPPED_LANGUAGE exception, and the rest of the record still imports.
   *
   * Takes no parameters -- the operation has no filters at all -- so it is
   * declared zero-arg rather than with an empty destructure, matching
   * HhaSyncServices.isSyncRunning.
   *
   * @returns {Promise<{success, languageNamesById, error}>}
   */
  static async fetchLanguages() {
    const {success, data, error} = await callHhaOperation({
      operation: HHAX_OPERATIONS.GET_LANGUAGES,
    });

    if (!success) {
      return {success: false, languageNamesById: {}, error};
    }

    const languages = unwrapArray({
      value: findNode({node: data, key: HHAX_LANGUAGE_ELEMENTS.LANGUAGE}),
    });

    const languageNamesById = languages.reduce((lookup, language) => {
      const languageId = normalizeValue({
        value: language?.[HHAX_LANGUAGE_ELEMENTS.LANGUAGE_ID],
      });

      const languageName = normalizeValue({
        value: language?.[HHAX_LANGUAGE_ELEMENTS.LANGUAGE_NAME],
      });

      if (languageId !== null && languageName !== null) {
        lookup[languageId] = languageName;
      }

      return lookup;
    }, {});

    return {success: true, languageNamesById, error: null};
  }

  /**
   * The agency's full coordinator roster.
   *
   * GetCoordinators is the ONLY coordinator operation HHAeXchange exposes --
   * there is no GetCoordinatorChanges of any version (whole op list checked on
   * the sandbox, 2026-09-03). So this is a full roster read rather than a change
   * feed: no ModifiedAfter, no PageNumber, no Pagination in the response, and
   * one call per sync run. The reconciler gates writes on hhaSyncHash alone.
   *
   * SearchFilters is MANDATORY. Omitting the element answers ErrorID -12
   * "Invalid Filter Value"; a bare `<SearchFilters />` is accepted, but Status
   * is sent explicitly as "All" so INACTIVE coordinators come back too -- an
   * inactive coordinator still owns history in PreventaTri and must be
   * imported, just never offered for a new assignment.
   *
   * OfficeID is nillable and deliberately not sent, matching the change feeds:
   * omitting it returns every office and each record carries its own Offices
   * block anyway.
   *
   * Takes no parameters -- the roster is agency-wide and the one filter is
   * fixed -- so it is declared zero-arg rather than with an empty destructure,
   * matching fetchLanguages.
   *
   * @returns {Promise<{success, docs, error}>}
   */
  static async fetchCoordinators() {
    const filterFields = {};

    filterFields[HHAX_COORDINATOR_REQUEST_ELEMENTS.STATUS] =
      HHAX_STATUS_FILTER_ALL;

    const {success, data, error} = await callHhaOperation({
      operation: HHAX_OPERATIONS.GET_COORDINATORS,
      body: buildNestedElement({
        name: HHAX_COORDINATOR_REQUEST_ELEMENTS.SEARCH_FILTERS,
        children: buildElements({fields: filterFields}),
      }),
    });

    if (!success) {
      return {success: false, docs: [], error};
    }

    return {
      success: true,
      docs: unwrapArray({
        value: findNode({
          node: data,
          key: HHAX_COORDINATOR_ELEMENTS.COORDINATOR,
        }),
      }),
      error: null,
    };
  }

  /**
   * The agency's full nurse roster.
   *
   * Like GetCoordinators this is a roster read, not a change feed: no
   * ModifiedAfter, no PageNumber, no Pagination. Unlike GetCoordinators the
   * filter elements are DIRECT children of the operation (no SearchFilters
   * wrapper). Status is sent as "All" so inactive nurses come back too -- an
   * inactive nurse still owns patients and history in PreventaTri.
   *
   * The roster is thin (id, "Last First" name, offices, Active); the address,
   * email and licence come from fetchCaregiverDemographics under the SAME id.
   *
   * @returns {Promise<{success, docs, error}>}
   */
  static async fetchNurses() {
    const fields = {};

    fields[HHAX_NURSE_REQUEST_ELEMENTS.STATUS] = HHAX_STATUS_FILTER_ALL;

    const {success, data, error} = await callHhaOperation({
      operation: HHAX_OPERATIONS.GET_NURSES,
      body: buildElements({fields}),
    });

    if (!success) {
      return {success: false, docs: [], error};
    }

    return {
      success: true,
      docs: unwrapArray({
        value: findNode({node: data, key: HHAX_NURSE_ELEMENTS.NURSE}),
      }),
      error: null,
    };
  }

  /**
   * One caregiver's (or nurse's -- NurseID === CaregiverID) demographics.
   *
   * @param {Object} params
   * @param {string|number} params.caregiverId
   * @returns {Promise<{success, doc, error}>}
   */
  static async fetchCaregiverDemographics({caregiverId}) {
    return await fetchDemographicsRecord({
      operation: HHAX_OPERATIONS.GET_CAREGIVER_DEMOGRAPHICS,
      infoElement: HHAX_CAREGIVER_DEMOGRAPHICS_ELEMENTS.CAREGIVER_INFO,
      id: caregiverId,
    });
  }

  /**
   * One patient's demographics. Used only where the change feed is ambiguous:
   * it names coordinators, while this returns their ids.
   *
   * @param {Object} params
   * @param {string|number} params.patientId
   * @returns {Promise<{success, doc, error}>}
   */
  static async fetchPatientDemographics({patientId}) {
    return await fetchDemographicsRecord({
      operation: HHAX_OPERATIONS.GET_PATIENT_DEMOGRAPHICS,
      infoElement: HHAX_PATIENT_DEMOGRAPHICS_ELEMENTS.PATIENT_INFO,
      id: patientId,
    });
  }

  /**
   * One page of the agency-wide visit change feed.
   *
   * GetVisitChangesV5 takes the identical request elements as the two
   * demographic feeds, in the same xs:sequence order, and answers with the same
   * Pagination shape -- which is why it goes through the same helper.
   *
   * ONE DIFFERENCE, and it is not optional: `modifiedAfter` must be formatted
   * WITHOUT the trailing Z the patient and caregiver feeds require. Sending the
   * Z here answers ErrorID -523. The caller supplies the already-formatted
   * value, using HHAX_VISIT_MODIFIED_AFTER_FORMAT.
   *
   * A second difference the caller must handle: the feed answers with roughly
   * ONE MONTH of changes per ModifiedAfter, not everything since it -- see
   * walkFeedByCursor in syncRunUtils.
   *
   * @param {Object} params
   * @param {string} params.modifiedAfter - Already formatted, WITHOUT the Z.
   * @param {number} [params.pageNumber]
   * @returns {Promise<{success, docs, pagination, error}>}
   */
  static async fetchVisitChanges({
    modifiedAfter,
    pageNumber = HHAX_FIRST_PAGE_NUMBER,
  }) {
    return await fetchChangeFeedPage({
      operation: HHAX_OPERATIONS.GET_VISIT_CHANGES,
      changesInfoElement: HHAX_VISIT_ELEMENTS.CHANGES_INFO,
      modifiedAfter,
      pageNumber,
    });
  }

  /**
   * One page of the deleted-visit feed.
   *
   * The change feed above never reports a deletion -- a cancelled visit simply
   * stops appearing -- so this is the only signal that a scheduled visit is not
   * going to happen, and it is why the visit sync makes a second pass.
   *
   * Same request shape and the same no-Z rule as fetchVisitChanges.
   *
   * @param {Object} params
   * @param {string} params.modifiedAfter - Already formatted, WITHOUT the Z.
   * @param {number} [params.pageNumber]
   * @returns {Promise<{success, docs, pagination, error}>}
   */
  static async fetchDeletedVisits({
    modifiedAfter,
    pageNumber = HHAX_FIRST_PAGE_NUMBER,
  }) {
    return await fetchChangeFeedPage({
      operation: HHAX_OPERATIONS.GET_DELETED_VISITS,
      changesInfoElement: HHAX_DELETED_VISIT_ELEMENTS.CHANGES_INFO,
      modifiedAfter,
      pageNumber,
    });
  }

  /**
   * The agency's missed-visit reason master list.
   *
   * Needed because the visit feed sends MissedVisitReasonID as a numeric id
   * rather than text. Modelled on fetchLanguages for the same reason it exists:
   * the operation takes Authentication only -- no ModifiedAfter, no pagination
   * -- so it is one cheap call per sync run rather than per page or per record.
   *
   * Returns a plain `{[reasonId]: reason}` lookup, string-keyed because the
   * parser leaves every leaf as a string. A failure is NOT fatal to a sync: the
   * caller falls back to an empty map, the raw MissedVisitReasonID is stored
   * regardless, and the rest of the record still imports.
   *
   * Takes no parameters -- the operation has no filters at all -- so it is
   * declared zero-arg, matching fetchLanguages.
   *
   * @returns {Promise<{success, reasonsById, error}>}
   */
  static async fetchMissedVisitReasons() {
    const {success, data, error} = await callHhaOperation({
      operation: HHAX_OPERATIONS.GET_MISSED_VISIT_REASONS,
    });

    if (!success) {
      return {success: false, reasonsById: {}, error};
    }

    const reasons = unwrapArray({
      value: findNode({
        node: data,
        key: HHAX_MISSED_REASON_ELEMENTS.REASON_INFO,
      }),
    });

    const reasonsById = reasons.reduce((lookup, reason) => {
      const reasonId = normalizeValue({
        value: reason?.[HHAX_MISSED_REASON_ELEMENTS.REASON_ID],
      });

      const reasonText = normalizeValue({
        value: reason?.[HHAX_MISSED_REASON_ELEMENTS.REASON],
      });

      if (reasonId !== null && reasonText !== null) {
        lookup[reasonId] = reasonText;
      }

      return lookup;
    }, {});

    return {success: true, reasonsById, error: null};
  }
};
