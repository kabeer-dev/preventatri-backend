/**
 * County resolution for HHAeXchange people.
 *
 * The change feeds carry no county, so it is derived from the ZIP. Pure and
 * Prisma-free: the caller supplies the organization's counties once per run and
 * this module only matches against them.
 */

const {getReferenceCounty, formatCountyLabel} = require('../usCountyUtils');

const {
  HHAX_SYNC_EXCEPTION_TYPES,
} = require('../../constants/hhaExchangeConstants');

const {
  ZIP5_LENGTH,
  US_ZIP_TO_COUNTY_FIPS,
} = require('../../constants/usZipCountyConstants');

const UNRESOLVED = Object.freeze({
  countyId: null,
  regionId: null,
  exceptionType: null,
  detail: null,
});

const unresolved = ({exceptionType, detail = null}) =>
  Object.assign({}, UNRESOLVED, {exceptionType, detail});

/**
 * Lookup keyed by county FIPS, built once per sync run. Counties typed in
 * before FIPS existed have none and can only be assigned by hand.
 */
const buildCountyLookup = ({counties}) => {
  const lookup = new Map();

  for (const county of counties || []) {
    if (county?.fipsCode) {
      lookup.set(county.fipsCode, {
        countyId: county.id,
        regionId: county.regionId,
      });
    }
  }

  return lookup;
};

/**
 * Resolve a person's county (and its region) from their ZIP.
 *
 * The ZIP alone decides the county; the state is only a cross-check, so a
 * blank state still resolves.
 */
const resolveCountyFromZip = ({state, zipCode, countyLookup}) => {
  if (!zipCode) {
    return unresolved({
      exceptionType: HHAX_SYNC_EXCEPTION_TYPES.MISSING_COUNTY_ZIP,
    });
  }

  // The feed may send ZIP+4, which is stored digits-only as nine characters.
  const zip5 = String(zipCode).trim().slice(0, ZIP5_LENGTH);
  const county = getReferenceCounty({fipsCode: US_ZIP_TO_COUNTY_FIPS[zip5]});

  if (!county) {
    return unresolved({
      exceptionType: HHAX_SYNC_EXCEPTION_TYPES.UNRESOLVED_COUNTY_ZIP,
      detail: zip5,
    });
  }

  const stateCode = state ? String(state).trim().toUpperCase() : null;

  // One of the two is mistyped, and guessing which would misroute the patient.
  if (stateCode && stateCode !== county.stateCode) {
    return unresolved({
      exceptionType: HHAX_SYNC_EXCEPTION_TYPES.ZIP_STATE_MISMATCH,
      detail: [stateCode, zip5].join(' '),
    });
  }

  const match = countyLookup?.get(county.fipsCode);

  if (!match) {
    return unresolved({
      exceptionType: HHAX_SYNC_EXCEPTION_TYPES.COUNTY_NOT_IN_ORGANIZATION,
      detail: formatCountyLabel(county),
    });
  }

  return Object.assign({}, match, {exceptionType: null, detail: null});
};

module.exports = {
  buildCountyLookup,
  resolveCountyFromZip,
};
