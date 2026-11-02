/**
 * Builds constants/data/usZipCounty.json and usCounties.json from the US Census
 * ZCTA-to-county relationship files. Never edit those JSON files by hand.
 *
 * Usage:
 *   node scripts/generateUsZipCounty.js <rel2020> <rel2010>
 *
 * rel2020: tab20_zcta520_county20_natl.txt (ZIP list, county codes and names)
 * rel2010: zcta_county_rel_10.txt (population share of each ZIP per county)
 * Both are published under https://www2.census.gov/geo/docs/maps-data/data/
 */

const fs = require('fs');
const path = require('path');

/** Below this share no county is a safe guess, so the ZIP is left out. */
const MIN_POPULATION_SHARE = 70;

const COUNTY_SUFFIX = / County$/;
const BYTE_ORDER_MARK_CODE = 0xfeff;
const LINE_BREAK = /\r?\n/;
const STATE_FIPS_LENGTH = 2;

const REL_2020 = {
  delimiter: '|',
  zip: 'GEOID_ZCTA5_20',
  county: 'GEOID_COUNTY_20',
  countyName: 'NAMELSAD_COUNTY_20',
};

const REL_2010 = {
  delimiter: ',',
  zip: 'ZCTA5',
  county: 'GEOID',
  share: 'ZPOPPCT',
};

const OUTPUT_DIR = path.join(__dirname, '..', 'constants', 'data');
const ZIP_COUNTY_FILE = 'usZipCounty.json';
const COUNTIES_FILE = 'usCounties.json';

const STATE_FIPS_TO_CODE = Object.freeze({
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  10: 'DE',
  11: 'DC',
  12: 'FL',
  13: 'GA',
  15: 'HI',
  16: 'ID',
  17: 'IL',
  18: 'IN',
  19: 'IA',
  20: 'KS',
  21: 'KY',
  22: 'LA',
  23: 'ME',
  24: 'MD',
  25: 'MA',
  26: 'MI',
  27: 'MN',
  28: 'MS',
  29: 'MO',
  30: 'MT',
  31: 'NE',
  32: 'NV',
  33: 'NH',
  34: 'NJ',
  35: 'NM',
  36: 'NY',
  37: 'NC',
  38: 'ND',
  39: 'OH',
  40: 'OK',
  41: 'OR',
  42: 'PA',
  44: 'RI',
  45: 'SC',
  46: 'SD',
  47: 'TN',
  48: 'TX',
  49: 'UT',
  50: 'VT',
  51: 'VA',
  53: 'WA',
  54: 'WV',
  55: 'WI',
  56: 'WY',
  60: 'AS',
  66: 'GU',
  69: 'MP',
  72: 'PR',
  78: 'VI',
});

const readRows = ({filePath, delimiter}) => {
  const text = fs.readFileSync(filePath, 'utf8');
  const hasByteOrderMark = text.charCodeAt(0) === BYTE_ORDER_MARK_CODE;

  const lines = (hasByteOrderMark ? text.slice(1) : text)
    .split(LINE_BREAK)
    .filter((line) => line !== '');

  const header = lines[0].split(delimiter);

  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};

    header.forEach((name, index) => {
      row[name] = cells[index];
    });

    return row;
  });
};

const pushTo = ({map, key, value}) => {
  if (!map.has(key)) map.set(key, []);

  map.get(key).push(value);
};

/** 2020 geography: every county, and the counties each ZIP touches. */
const read2020 = ({filePath}) => {
  const counties = new Map();
  const zipCounties = new Map();

  readRows({filePath, delimiter: REL_2020.delimiter}).forEach((row) => {
    const fips = row[REL_2020.county];
    const stateCode = STATE_FIPS_TO_CODE[fips.slice(0, STATE_FIPS_LENGTH)];

    if (!stateCode) return;

    counties.set(fips, [
      stateCode,
      row[REL_2020.countyName].replace(COUNTY_SUFFIX, ''),
    ]);

    // Counties with no ZIP of their own appear with a blank ZIP.
    if (row[REL_2020.zip]) {
      pushTo({map: zipCounties, key: row[REL_2020.zip], value: fips});
    }
  });

  return {counties, zipCounties};
};

const read2010Shares = ({filePath}) => {
  const zipShares = new Map();

  readRows({filePath, delimiter: REL_2010.delimiter}).forEach((row) => {
    pushTo({
      map: zipShares,
      key: row[REL_2010.zip],
      value: {fips: row[REL_2010.county], share: Number(row[REL_2010.share])},
    });
  });

  return zipShares;
};

/**
 * A ZIP inside one county is certain. A ZIP that straddles counties goes to
 * the one holding most of its population, or is omitted when none holds enough.
 */
const pickCounty = ({countyFips, shares}) => {
  if (countyFips.length === 1) return countyFips[0];

  if (!shares) return null;

  if (shares.length === 1) return shares[0].fips;

  const best = shares.reduce((top, entry) =>
    entry.share > top.share ? entry : top
  );

  return best.share >= MIN_POPULATION_SHARE ? best.fips : null;
};

const buildZipToCounty = ({zipCounties, zipShares, counties}) => {
  const zipToCounty = new Map();

  zipCounties.forEach((countyFips, zip) => {
    const fips = pickCounty({countyFips, shares: zipShares.get(zip)});

    // Counties renumbered since 2010 would point at a code that no longer exists.
    if (fips && counties.has(fips)) zipToCounty.set(zip, fips);
  });

  return zipToCounty;
};

/** Spaced the way Prettier does, so the commit hook leaves the files alone. */
const serializeValue = ({value}) =>
  Array.isArray(value)
    ? `[${value.map((item) => JSON.stringify(item)).join(', ')}]`
    : JSON.stringify(value);

/** One entry per line, so a regenerated file diffs cleanly. */
const writeJson = ({fileName, entries}) => {
  const lines = Array.from(entries)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      (entry) =>
        `  ${JSON.stringify(entry[0])}: ${serializeValue({value: entry[1]})}`
    );

  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  fs.writeFileSync(
    path.join(OUTPUT_DIR, fileName),
    `{\n${lines.join(',\n')}\n}\n`
  );

  return lines.length;
};

const main = () => {
  const [rel2020Path, rel2010Path] = process.argv.slice(2);

  if (!rel2020Path || !rel2010Path) {
    console.error(
      'Usage: node scripts/generateUsZipCounty.js <rel2020> <rel2010>'
    );
    process.exit(1);
  }

  const {counties, zipCounties} = read2020({filePath: rel2020Path});
  const zipShares = read2010Shares({filePath: rel2010Path});
  const zipToCounty = buildZipToCounty({zipCounties, zipShares, counties});

  const countyCount = writeJson({fileName: COUNTIES_FILE, entries: counties});
  const zipCount = writeJson({fileName: ZIP_COUNTY_FILE, entries: zipToCounty});

  // eslint-disable-next-line no-console -- Script output
  console.info(
    `Wrote ${zipCount} ZIPs (${zipCounties.size - zipCount} omitted) and ${countyCount} counties to ${OUTPUT_DIR}`
  );
};

main();
