/**
 * Soft Delete Plugin with Scoped Unique Index Support
 *
 * Features:
 * 1. Automatically filters out soft-deleted documents (`deletedAt: null`) from queries and aggregations.
 * 2. Supports flexible and scoped unique compound indexes (e.g., unique per organization/team).
 * 3. Allows developers to optionally customize index options (e.g., `sparse`, `partialFilterExpression`).
 *
 * Example Usage:
 *  schema.plugin(softDeleteWithIndexesPlugin, {
 *    unique: [
 *      { fields: ['slug'] }, // globally unique
 *      { fields: ['email'], scopedTo: ['organizationId'] }, // unique per organization
 *      {
 *        fields: ['code'],
 *        scopedTo: ['organizationId', 'teamId'],
 *        options: { sparse: true } // optional: add MongoDB index options if needed
 *      },
 *    ]
 *  });
 *
 * Notes:
 * - `fields` defines which attributes are unique.
 * - `scopedTo` defines additional fields that together create a scoped uniqueness boundary.
 *   e.g. `email` + `organizationId` → unique only within that organization.
 * - `options` is optional. Developers can pass MongoDB index options like `sparse: true`,
 *   `background: true`, or custom `partialFilterExpression` if needed.
 */

const logger = require('../../middleware/loggerMiddleware');

const {safeMerge} = require('../../utils');

const {
  mergeAndDeduplicateFields,
} = require('../../utils/mergeAndDeduplicateFields');

const softDeleteWithIndexesPlugin = (schema, options = {}) => {
  const defaultPreHooks = [
    'find',
    'findOne',
    'findById',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'updateOne',
    'updateMany',
    'findOneAndDelete',
    'findByIdAndDelete',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'replaceOne',
  ];

  /**
   * Automatically exclude soft-deleted documents
   * unless the query explicitly includes { options: { includeDeleted: true } }.
   */
  const {preHooks = defaultPreHooks, unique = []} = options;

  // Apply `deletedAt` filter to standard query operations
  // Mongoose 9: pre middleware no longer receives next parameter
  schema.pre(preHooks, function () {
    const includeDeleted = Boolean(this.options?.includeDeleted);

    if (!includeDeleted) this.where({deletedAt: {$eq: null}});
  });

  /**
   * Do the same exclusion for aggregation pipelines.
   */
  // Apply `deletedAt` filter to aggregation operations
  // Mongoose 9: pre middleware no longer receives next parameter
  schema.pre('aggregate', function () {
    const includeDeleted = Boolean(this.options?.includeDeleted);

    // Add `deletedAt` filter if not already present in the aggregation
    if (!includeDeleted)
      this.pipeline().unshift({$match: {deletedAt: {$eq: null}}});
  });

  /**
   * Define compound unique indexes with optional scoping.
   * Each entry in `unique` creates one MongoDB unique index.
   */
  if (Array.isArray(unique) && unique.length > 0) {
    unique.forEach((item, index) => {
      const fields = mergeAndDeduplicateFields({
        fields: item.fields || [],
        scopedTo: item.scopedTo || [],
      });

      if (!fields.length) {
        logger.warn(
          `SoftDeletePlugin: Skipped unique config at index ${index} — no valid fields found`
        );

        return;
      }

      const indexObj = {};
      fields.forEach((f) => {
        indexObj[f] = 1;
      });

      // Generate a clean index name (MongoDB has a 128-char limit)
      const indexName = `${fields.join('_')}_unique_index`.slice(0, 120);

      /**
       * Create the unique index:
       * - Always includes a soft-delete filter (`deletedAt: null`) to ignore deleted docs.
       * - Allows extra index options through `item.options`, if the developer provides them.
       *   e.g., item.options = { sparse: true } or { partialFilterExpression: {...} }
       */
      schema.index(
        indexObj,
        safeMerge({
          originalObj: {
            unique: true,
            name: indexName,
            partialFilterExpression: {deletedAt: {$eq: null}},
          },
          newObj: item.options || {}, // Optional: extend default options with user-defined ones
          deep: true,
        })
      );
    });
  }
};

module.exports = softDeleteWithIndexesPlugin;
