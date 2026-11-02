/**
 * Collection Diff Utilities
 * Provides reusable functions for computing diffs between current and desired collections.
 * Commonly used when updating parent-child relationships (e.g., Region ↔ Counties).
 *
 * Eliminates duplicated diffing logic across controllers by providing a single,
 * tested utility that works with any collection keyed by a field name.
 */

/**
 * Compute the diff between a current collection of objects and a desired list of values.
 * Returns items to remove, values to create, and items to keep.
 *
 * @param {Object} params
 * @param {Array<Object>} params.currentItems - Current collection of objects (e.g., existing counties)
 * @param {Array<string>} params.desiredValues - Desired values for the new state (e.g., county names)
 * @param {string} [params.key='name'] - The object key to compare against desiredValues
 * @returns {Object} {itemsToRemove, valuesToCreate, itemsToKeep}
 *
 * @example
 * const {itemsToRemove, valuesToCreate, itemsToKeep} = computeCollectionDiff({
 *   currentItems: [{id: '1', name: 'Adams'}, {id: '2', name: 'York'}],
 *   desiredValues: ['York', 'Chester'],
 *   key: 'name',
 * });
 * // itemsToRemove: [{id: '1', name: 'Adams'}]   — in current but not in desired
 * // valuesToCreate: ['Chester']                    — in desired but not in current
 * // itemsToKeep: [{id: '2', name: 'York'}]        — in both
 */
module.exports.computeCollectionDiff = ({
  currentItems = [],
  desiredValues = [],
  key = 'name',
}) => {
  const currentValuesSet = new Set(currentItems.map((item) => item[key]));
  const desiredValuesSet = new Set(desiredValues);

  // Items to remove — present in current but not in desired
  const itemsToRemove = currentItems.filter(
    (item) => !desiredValuesSet.has(item[key])
  );

  // Values to create — present in desired but not in current
  const valuesToCreate = desiredValues.filter(
    (value) => !currentValuesSet.has(value)
  );

  // Items to keep — present in both current and desired
  const itemsToKeep = currentItems.filter((item) =>
    desiredValuesSet.has(item[key])
  );

  return {itemsToRemove, valuesToCreate, itemsToKeep};
};
