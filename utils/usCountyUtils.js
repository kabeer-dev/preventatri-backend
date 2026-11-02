/**
 * Lookups over the US county reference data. Pure and Prisma-free.
 */

const {COUNTY_LABEL_SEPARATOR} = require('../constants/countiesConstants');

const {
  US_COUNTIES,
  US_COUNTY_STATE_INDEX,
  US_COUNTY_NAME_INDEX,
} = require('../constants/usZipCountyConstants');

const SEARCH_TOKEN_SPLIT = /[\s,]+/;

const getReferenceCounty = ({fipsCode}) => {
  const entry = fipsCode ? US_COUNTIES[fipsCode] : null;

  if (!entry) return null;

  return {
    fipsCode,
    stateCode: entry[US_COUNTY_STATE_INDEX],
    name: entry[US_COUNTY_NAME_INDEX],
  };
};

/** "Washington, PA"; a legacy county with no state is just its name. */
const formatCountyLabel = ({name, stateCode}) =>
  stateCode ? [name, stateCode].join(COUNTY_LABEL_SEPARATOR) : name;

const REFERENCE_COUNTIES = Object.keys(US_COUNTIES)
  .map((fipsCode) => getReferenceCounty({fipsCode}))
  .sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.stateCode.localeCompare(b.stateCode)
  );

const COUNTY_BY_LABEL = new Map(
  REFERENCE_COUNTIES.map((county) => [formatCountyLabel(county), county])
);

/** The inverse of formatCountyLabel, for a label this module produced. */
const findReferenceCountyByLabel = ({label}) =>
  (label && COUNTY_BY_LABEL.get(label)) || null;

const SEARCHABLE_LABELS = REFERENCE_COUNTIES.map((county) =>
  formatCountyLabel(county).toLowerCase()
);

/** Every token must appear in "name, ST", so "wash pa" finds Washington, PA. */
const searchReferenceCounties = ({search, stateCode, skip = 0, take}) => {
  const tokens = search
    ? search.toLowerCase().split(SEARCH_TOKEN_SPLIT).filter(Boolean)
    : [];
  const state = stateCode ? stateCode.toUpperCase() : null;

  const matches = REFERENCE_COUNTIES.filter((county, index) => {
    if (state && county.stateCode !== state) return false;

    return tokens.every((token) => SEARCHABLE_LABELS[index].includes(token));
  });

  return {
    docs: take === undefined ? matches : matches.slice(skip, skip + take),
    count: matches.length,
  };
};

const findReferenceCountyFips = ({stateCode, name}) => {
  const target = String(name).trim().toLowerCase();

  const match = REFERENCE_COUNTIES.find(
    (county) =>
      county.stateCode === stateCode && county.name.toLowerCase() === target
  );

  return match ? match.fipsCode : null;
};

/** Every state and territory the reference data has a county in. */
const US_STATE_CODES = new Set(
  REFERENCE_COUNTIES.map((county) => county.stateCode)
);

const isUsStateCode = ({stateCode}) => US_STATE_CODES.has(stateCode);

module.exports = {
  isUsStateCode,
  getReferenceCounty,
  formatCountyLabel,
  searchReferenceCounties,
  findReferenceCountyFips,
  findReferenceCountyByLabel,
};
