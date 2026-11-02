/**
 * SOAP 1.1 envelope construction for HHAeXchange.
 *
 * The envelope is built with template strings rather than an XML library on
 * purpose: the three operations we call have flat request bodies with at most
 * three leaf elements each, and the published WSDL is ~915 KB — parsing it at
 * boot to generate a client would cost far more than it saves. Responses ARE
 * parsed with fast-xml-parser (see soapClient); only the outbound direction is
 * hand-built, where the shape is fixed and fully known.
 */

const config = require('config');

const {
  HHAX_XML_DECLARATION,
  HHAX_SOAP_ENV_NAMESPACE,
  HHAX_XML_NAMESPACE,
  HHAX_ENVELOPE_ELEMENTS,
} = require('../../constants/hhaExchangeConstants');

/** The five XML entities. Applied to every interpolated value, without exception. */
const escapeXml = ({value}) =>
  String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** `<Tag>escaped</Tag>`, or `<Tag />` when the value is empty. */
const buildElement = ({name, value}) => {
  if (value === null || value === undefined || value === '')
    return `<${name} />`;

  return `<${name}>${escapeXml({value})}</${name}>`;
};

/**
 * Turn `{OfficeID: 17132, PageNumber: 1}` into `<OfficeID>17132</OfficeID>...`,
 * preserving key order — HHAeXchange validates against an xs:sequence, so
 * element order is significant and callers must pass keys in schema order.
 */
const buildElements = ({fields}) =>
  Object.entries(fields || {})
    .map(([name, value]) => buildElement({name, value}))
    .join('');

/**
 * `<Tag>...children...</Tag>` for a request element that wraps others.
 *
 * Separate from buildElement because the two are opposites: buildElement
 * ESCAPES its value, which is exactly right for a leaf and exactly wrong for
 * pre-built XML. Passing markup through buildElement would emit
 * `&lt;Status&gt;All&lt;/Status&gt;` and HHAeXchange would reject the filter.
 *
 * Needed by GetCoordinators, the only operation with a nested request body:
 * SearchFilters is mandatory (omitting it answers ErrorID -12) and Status sits
 * inside it.
 *
 * `children` must come from buildElement/buildElements, never from raw input --
 * this function does no escaping of its own by design.
 *
 * @param {Object} params
 * @param {string} params.name - The wrapper element name.
 * @param {string} params.children - Pre-built, already-escaped inner XML.
 */
const buildNestedElement = ({name, children = ''}) =>
  `<${name}>${children}</${name}>`;

/**
 * The credential block every operation requires. Read from config at call time
 * rather than module load so a credential rotation does not need a restart.
 */
const buildAuthenticationBlock = () => {
  const fields = {};
  fields[HHAX_ENVELOPE_ELEMENTS.APP_NAME] = config.get('hhax.appName');
  fields[HHAX_ENVELOPE_ELEMENTS.APP_SECRET] = config.get('hhax.appSecret');
  fields[HHAX_ENVELOPE_ELEMENTS.APP_KEY] = config.get('hhax.appKey');

  return `<${HHAX_ENVELOPE_ELEMENTS.AUTHENTICATION}>${buildElements({fields})}</${HHAX_ENVELOPE_ELEMENTS.AUTHENTICATION}>`;
};

/**
 * Build a complete SOAP 1.1 envelope for one operation.
 *
 * @param {Object} params
 * @param {string} params.operation - An HHAX_OPERATIONS value.
 * @param {string} params.body - Pre-built XML for the operation-specific
 *   elements, in schema order. Use buildElements to produce it.
 * @returns {string} The full envelope, ready to POST.
 */
const buildEnvelope = ({operation, body = ''}) =>
  `${HHAX_XML_DECLARATION}<soap:Envelope xmlns:soap="${HHAX_SOAP_ENV_NAMESPACE}">` +
  `<soap:Body><${operation} xmlns="${HHAX_XML_NAMESPACE}">` +
  `${buildAuthenticationBlock()}${body}` +
  `</${operation}></soap:Body></soap:Envelope>`;

module.exports = {
  escapeXml,
  buildElement,
  buildElements,
  buildNestedElement,
  buildEnvelope,
};
