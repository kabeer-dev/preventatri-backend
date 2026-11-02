function toInt({value}) {
  const number = Number(value);

  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toNullableNumber({value, decimals = 0}) {
  if (value === null || value === undefined) return null;

  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  const factor = 10 ** decimals;

  return Math.round(number * factor) / factor;
}

function toPercent({part, total, decimals = 1}) {
  if (!total) return null;

  return toNullableNumber({value: (part / total) * 100, decimals});
}

function toKpi({value, previous}) {
  const current = value ?? null;
  const prior = previous ?? null;

  const delta =
    current === null || prior === null
      ? null
      : toNullableNumber({value: current - prior, decimals: 1});

  return {value: current, previous: prior, delta};
}

function fillSeries({
  buckets,
  rows,
  valueField,
  keyField = 'bucket',
  emptyValue = 0,
}) {
  const byKey = new Map((rows || []).map((row) => [row[keyField], row]));

  return buckets.map((bucket) => {
    const row = byKey.get(bucket.key);

    if (!row || row[valueField] === null || row[valueField] === undefined)
      return emptyValue;

    return Number(row[valueField]);
  });
}

function sumRows({rows, field}) {
  return (rows || []).reduce((sum, row) => sum + toInt({value: row[field]}), 0);
}

module.exports = {
  fillSeries,
  sumRows,
  toInt,
  toKpi,
  toNullableNumber,
  toPercent,
};
