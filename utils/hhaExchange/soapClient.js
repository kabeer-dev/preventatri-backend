/**
 * HHAeXchange SOAP transport.
 *
 * Three things about this API drive the shape of this module, all confirmed
 * against the sandbox rather than inferred from the WSDL:
 *
 * 1. An application-level failure comes back as HTTP 400 WITH a parseable body
 *    carrying Status="Failure". A non-2xx therefore does NOT mean the request
 *    failed to reach the service, and the body must always be parsed before any
 *    conclusion is drawn.
 * 2. Success is the `Status` ATTRIBUTE on <Result>, never the HTTP status code.
 * 3. Requests carry credentials in cleartext and responses carry PHI, so
 *    neither may ever be logged. utils/monitoring puts error.message straight
 *    into span.setStatus and span.recordException with no redaction of its own,
 *    so sanitising happens HERE, before an Error object is ever constructed.
 */

const config = require('config');
const {XMLParser} = require('fast-xml-parser');

const {getEpochMillis} = require('../dateUtils');
const {sleep, maskSensitiveFields} = require('../general');

const {buildEnvelope} = require('./soapEnvelope');

const {
  HHAX_CONTENT_TYPE,
  HHAX_SOAP_ACTION_BASE,
  HHAX_ENVELOPE_ELEMENTS,
  HHAX_RESULT_STATUSES,
  HHAX_MASKED_FIELDS,
  HHAX_REQUEST_METHOD,
} = require('../../constants/hhaExchangeConstants');
const logger = require('../../middleware/loggerMiddleware');

/**
 * parseTagValue:false is load-bearing — it keeps every leaf as a string, so a
 * ZIP of "01234" keeps its leading zero and a 64-bit PatientID survives without
 * precision loss. Turning it on would silently corrupt both.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** HTTP statuses worth a retry. Everything else is deterministic. */
const RETRYABLE_HTTP_STATUSES = [408, 425, 429, 500, 502, 503, 504];

/**
 * fast-xml-parser collapses a repeated element to a bare object when only one
 * instance is present, so every list must go through this before iteration.
 * An absent element yields an empty array rather than null.
 */
const unwrapArray = ({value}) => {
  if (value === null || value === undefined || value === '') return [];

  return Array.isArray(value) ? value : [value];
};

/**
 * Empty HHAeXchange elements arrive as self-closing tags, which the parser
 * yields as '' (or {} when the element had attributes). Both mean "no value".
 */
const normalizeValue = ({value}) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;

  const trimmed = String(value).trim();

  return trimmed === '' ? null : trimmed;
};

/** Depth-first search for the first node carrying `key`. */
const findNode = ({node, key}) => {
  if (!node || typeof node !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];

  for (const child of Object.values(node)) {
    const found = findNode({node: child, key});
    if (found !== null && found !== undefined) return found;
  }

  return null;
};

/**
 * Build a log/error context that is safe to emit. Deliberately excludes the
 * envelope and the response body — the two things that carry credentials and
 * PHI respectively.
 */
const buildSafeContext = ({
  operation,
  attempt,
  httpStatus,
  resultStatus,
  errorId,
  errorMessage,
  transportError,
  durationMs,
}) =>
  maskSensitiveFields({
    data: {
      operation,
      attempt,
      httpStatus,
      resultStatus,
      errorId,
      errorMessage,
      transportError,
      durationMs,
    },
    fieldsToMask: HHAX_MASKED_FIELDS,
  });

/** Read <Result Status="..."> plus ErrorInfo out of a parsed response. */
const readResult = ({parsed}) => {
  const result = findNode({node: parsed, key: HHAX_ENVELOPE_ELEMENTS.RESULT});

  const errorInfo = result
    ? findNode({node: result, key: HHAX_ENVELOPE_ELEMENTS.ERROR_INFO})
    : null;

  return {
    status: result
      ? normalizeValue({
          value: result[`@_${HHAX_ENVELOPE_ELEMENTS.RESULT_STATUS_ATTRIBUTE}`],
        })
      : null,
    errorId: errorInfo
      ? normalizeValue({value: errorInfo[HHAX_ENVELOPE_ELEMENTS.ERROR_ID]})
      : null,
    errorMessage: errorInfo
      ? normalizeValue({value: errorInfo[HHAX_ENVELOPE_ELEMENTS.ERROR_MESSAGE]})
      : null,
  };
};

/** A single request attempt. Returns the parsed body even on a non-2xx. */
const attemptRequest = async ({operation, body, credentials}) => {
  const startedAt = getEpochMillis();

  try {
    const response = await fetch(config.get('hhax.baseUrl'), {
      method: HHAX_REQUEST_METHOD,
      headers: {
        'Content-Type': HHAX_CONTENT_TYPE,
        SOAPAction: `${HHAX_SOAP_ACTION_BASE}${operation}`,
      },
      body: buildEnvelope({operation, body, credentials}),
      signal: AbortSignal.timeout(config.get('hhax.requestTimeoutMs')),
    });

    const text = await response.text();

    return {
      httpStatus: response.status,
      parsed: parser.parse(text),
      durationMs: getEpochMillis() - startedAt,
    };
  } catch (error) {
    // Transport only: DNS, TLS, socket, or AbortSignal timeout. The message is
    // built from the error name alone — a fetch error can echo the request URL.
    return {
      httpStatus: null,
      parsed: null,
      durationMs: getEpochMillis() - startedAt,
      transportError: error.name || 'FetchError',
    };
  }
};

/**
 * Call one HHAeXchange operation.
 *
 * Never throws — returns the house `{success, data, error}` envelope so callers
 * branch on a value rather than on control flow.
 *
 * Retries cover ONLY transport failures and the retryable HTTP statuses. A SOAP
 * Fault or a Status="Failure" is deterministic: retrying it cannot change the
 * answer and would only put the same PHI on the wire three more times.
 *
 * @param {Object} params
 * @param {string} params.operation - An HHAX_OPERATIONS value.
 * @param {string} [params.body] - Operation-specific XML, in schema order.
 * @param {Object} params.credentials - The organization's appName, appSecret and appKey.
 * @param {number} [params.maxRetries] - Attempts before giving up; defaults to
 *   hhax.maxRetries. An interactive check passes 1 so the caller is not kept waiting.
 * @returns {Promise<{success: boolean, data: Object|null, error: Object|null}>}
 */
const callHhaOperation = async ({
  operation,
  body = '',
  credentials,
  maxRetries = config.get('hhax.maxRetries'),
}) => {
  const retryDelayMs = config.get('hhax.retryDelayMs');

  let lastContext = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const outcome = await attemptRequest({operation, body, credentials});

    // ── Layer 1: transport ──────────────────────────────────────────────────
    if (outcome.transportError) {
      lastContext = buildSafeContext({
        operation,
        attempt,
        httpStatus: null,
        resultStatus: null,
        errorId: null,

        // Our own error name (AbortError, TimeoutError...), not remote text —
        // reported under transportError so it stays readable, while
        // errorMessage, which HHAeXchange composes, is masked.
        transportError: outcome.transportError,
        durationMs: outcome.durationMs,
      });
      logger.warn('HHAeXchange transport failure', lastContext);

      if (attempt < maxRetries) {
        await sleep({time: retryDelayMs * Math.pow(2, attempt - 1)});
        continue;
      }

      return {success: false, data: null, error: lastContext};
    }

    // ── Layer 2: SOAP Fault ─────────────────────────────────────────────────
    const fault = findNode({
      node: outcome.parsed,
      key: HHAX_ENVELOPE_ELEMENTS.SOAP_FAULT,
    });

    if (fault) {
      lastContext = buildSafeContext({
        operation,
        attempt,
        httpStatus: outcome.httpStatus,
        resultStatus: HHAX_ENVELOPE_ELEMENTS.SOAP_FAULT,
        errorId: null,
        errorMessage: normalizeValue({
          value: fault[HHAX_ENVELOPE_ELEMENTS.FAULT_STRING],
        }),
        durationMs: outcome.durationMs,
      });
      logger.error('HHAeXchange SOAP fault', lastContext);

      return {success: false, data: null, error: lastContext};
    }

    // ── Layer 3: Result Status ──────────────────────────────────────────────
    const result = readResult({parsed: outcome.parsed});

    if (result.status === HHAX_RESULT_STATUSES.SUCCESS) {
      logger.info(
        'HHAeXchange call succeeded',
        buildSafeContext({
          operation,
          attempt,
          httpStatus: outcome.httpStatus,
          resultStatus: result.status,
          errorId: null,
          errorMessage: null,
          durationMs: outcome.durationMs,
        })
      );

      return {success: true, data: outcome.parsed, error: null};
    }

    lastContext = buildSafeContext({
      operation,
      attempt,
      httpStatus: outcome.httpStatus,
      resultStatus: result.status,
      errorId: result.errorId,
      errorMessage: result.errorMessage,
      durationMs: outcome.durationMs,
    });

    // A retryable HTTP status with no application Status means the service
    // itself is unhealthy rather than rejecting the request.
    const isRetryable =
      result.status === null &&
      RETRYABLE_HTTP_STATUSES.includes(outcome.httpStatus);

    if (isRetryable && attempt < maxRetries) {
      logger.warn('HHAeXchange transient failure', lastContext);
      await sleep({time: retryDelayMs * Math.pow(2, attempt - 1)});
      continue;
    }

    logger.error('HHAeXchange call failed', lastContext);

    return {success: false, data: null, error: lastContext};
  }

  return {success: false, data: null, error: lastContext};
};

module.exports = {
  callHhaOperation,
  unwrapArray,
  normalizeValue,
  findNode,
};
