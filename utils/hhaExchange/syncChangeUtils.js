/**
 * Builds the `changes` list of one hha_sync_changes row: the fields a run
 * wrote, as {field, from, to}. Rows written before 2026-10-02 may hold
 * {field, redacted: true} for patient fields; readers still accept that shape.
 */

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// Mappers hand out date strings where the database returns Date objects, so
// both sides are reduced to one comparable shape first.
const normalizeValue = ({value}) => {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'string' && ISO_DATE_PREFIX.test(value)) {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  if (typeof value === 'object') return JSON.stringify(value);

  return value;
};

/**
 * The fields of `fields` that `after` sets to a different value than `before`.
 * A field `after` does not carry is not a change.
 */
const diffFields = ({before = {}, after = {}, fields}) =>
  fields
    .filter((field) => field in after)
    .map((field) => ({
      field,
      from: normalizeValue({value: before[field]}),
      to: normalizeValue({value: after[field]}),
    }))
    .filter(({from, to}) => from !== to);

/** Every non-empty field a newly created record was given. */
const snapshotFields = ({after = {}, fields}) =>
  fields
    .map((field) => ({field, to: normalizeValue({value: after[field]})}))
    .filter(({to}) => to !== null)
    .map(({field, to}) => ({field, from: null, to}));

module.exports = {
  diffFields,
  snapshotFields,
};
