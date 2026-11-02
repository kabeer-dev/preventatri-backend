const {
  MODELS_WITH_SOFT_DELETE,
  CASCADE_SOFT_DELETE_RULES,
} = require('../constants/modelSchemaConfig');
const {attachExtraQueriesFromOptions} = require('../utils/aclUtils');

const {getPrismaClient} = require('../utils/databaseConnectionManager');
const {getCurrentDateTime} = require('../utils/dateUtils');

const {
  // convertMongoIdsInQuery,
  safeMerge,
  safeConcat,
} = require('../utils/general');

const {
  getModelDefaultFields,
  getRelationTemplate,
  getAutoIncludeRelations,
  getFieldMappings,
  getRelationDependencies,
} = require('../utils/modelSchemaUtils');
const {getExtraContext} = require('../utils/requestContext');
const {asyncTryCatch} = require('../utils/tryCatchUtils');

/**
 * UPDATE FACTORY DESIGN NOTE
 *
 * These update factories are intentionally separated by intent:
 *
 * - updateOne: write-only, updates a single record, returns minimal metadata, no document returned
 * - updateMany: bulk write-only, updates multiple records, returns only count
 * - findOneAndUpdate: write + return a single record, supports field selection and relation population
 * - findByIdAndUpdate: optimized write + return by unique ID (skips find step)
 * - findAllAndUpdate: bulk write + return documents, implemented manually since Prisma does not support this natively
 *
 * Rationale:
 * 1. Avoids over-fetching
 * 2. Makes intent explicit at call sites
 * 3. Prevents accidental misuse of generic "do-everything" update API
 */

/**
 * Default field selection for each model matching Mongoose fieldsToShow plugin
 * Only these fields are returned by default (hidden fields require explicit include)
 */

// Helper to merge ACL queries from context into options
function mergeContextQueries({options = {}}) {
  const {bypassExtraQueries, ...restOptions} = options;
  if (bypassExtraQueries)
    return Object.assign({bypassExtraQueries: true}, restOptions);

  const contextQueries = getExtraContext().queries || {};

  return safeMerge({
    originalObj: restOptions,
    newObj: {extraQueries: contextQueries},
  });
}

/**
 * Build Prisma select object from fieldsInclusion options
 * Mirrors Mongoose's field selection logic
 * Handles field name mapping from Mongoose to Prisma
 * Dynamically includes relations based on MODEL_SCHEMA_CONFIG
 */
function buildSelectObject({model, fieldsInclusion = {}, populateFields = []}) {
  const {
    exclude = [],
    include = [],
    includeSpecificFields = [],
  } = fieldsInclusion;

  // Get model-specific field mappings (legacy names to Prisma field names)
  const fieldMappings = getFieldMappings({model});

  const defaultFields = getModelDefaultFields({model});

  // If specific fields are provided, use only those
  if (includeSpecificFields.length > 0) {
    const selectObj = {};
    includeSpecificFields.forEach((field) => {
      const mappedField = fieldMappings[field] || field;
      selectObj[mappedField] = true;
    });

    return selectObj;
  }

  // Start with default fields
  const selectObj = {};
  defaultFields.forEach((field) => {
    selectObj[field] = true;
  });

  // DYNAMICALLY include auto-relations for this model (no hardcoded checks needed)
  const autoRelations = getAutoIncludeRelations({model});
  autoRelations.forEach((relationName) => {
    const relationTemplate = getRelationTemplate({model, relationName});
    if (relationTemplate) {
      selectObj[relationName] = relationTemplate;
    }
  });

  // Add included fields (hidden by default), with mapping
  // If include is already an object with pre-formatted relations, merge directly
  if (
    include &&
    typeof include === 'object' &&
    !Array.isArray(include) &&
    Object.keys(include).length > 0
  ) {
    Object.assign(selectObj, include);
  } else if (Array.isArray(include)) {
    // Handle array of field names
    include.forEach((field) => {
      const mappedField = fieldMappings[field] || field;

      // Check if this field is a relation
      const relationTemplate = getRelationTemplate({
        model,
        relationName: mappedField,
      });

      if (relationTemplate) {
        // It's a relation - use the template
        selectObj[mappedField] = relationTemplate;

        // AUTOMATICALLY include dependent relations (defined in config)
        const dependencies = getRelationDependencies({
          model,
          relationName: mappedField,
        });
        dependencies.forEach((depRelationName) => {
          const depTemplate = getRelationTemplate({
            model,
            relationName: depRelationName,
          });
          if (depTemplate) {
            selectObj[depRelationName] = depTemplate;
          }
        });
      } else {
        // Not a relation - just set to true
        selectObj[mappedField] = true;
      }
    });
  }

  // Remove excluded fields
  exclude.forEach((field) => {
    const mappedField = fieldMappings[field] || field;
    delete selectObj[mappedField];
  });

  // Add populated relations with field mapping for consistency
  populateFields.forEach((field) => {
    // Map legacy field names through fieldMappings for consistency with include/exclude behavior
    const mappedField = fieldMappings[field] || field;

    const relationTemplate = getRelationTemplate({
      model,
      relationName: mappedField,
    });

    if (relationTemplate) {
      // It's a relation - use the template with mapped name
      selectObj[mappedField] = relationTemplate;

      // AUTOMATICALLY include dependent relations
      const dependencies = getRelationDependencies({
        model,
        relationName: mappedField,
      });
      dependencies.forEach((depRelationName) => {
        const depTemplate = getRelationTemplate({
          model,
          relationName: depRelationName,
        });
        if (depTemplate) {
          selectObj[depRelationName] = depTemplate;
        }
      });
    } else {
      // Not a relation in the schema - just set to true using mapped name
      // This allows for simple relation names not defined in config
      selectObj[mappedField] = true;
    }
  });

  return Object.keys(selectObj).length > 0 ? selectObj : undefined;
}

// Helper to build where clause with soft delete (already handled by middleware)
function buildWhereClause({model, query = {}, options = {}}) {
  const finalQuery = attachExtraQueriesFromOptions({
    model,
    originalQuery: query,
    options,
  });

  // Add soft delete filter (unless explicitly excluded with includeDeleted option)
  // Only add for models that actually have isDeleted field
  // This prevents errors on models like NurseRegion that don't support soft delete
  if (!options?.includeDeleted && MODELS_WITH_SOFT_DELETE.includes(model)) {
    finalQuery.isDeleted = null;
  }

  return finalQuery;
}

// ============================================================================
// FACTORY METHODS
// ============================================================================

/**
 * CREATE - Insert single or multiple documents
 */
module.exports.create = async ({
  model,
  data,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});

  // Build select object to apply field filtering
  // Always ensure 'id' is included
  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: createdDocs,
  } = await asyncTryCatch({
    fn: async () => {
      if (Array.isArray(data)) {
        // Batch create - Note: createMany returns {count: number}, not the created documents
        // To get actual documents, fetch them after creation or use createManyAndReturn (Prisma 5.14.0+)
        const result = await prismaClient[model].createMany({
          data,
          skipDuplicates: mergedOptions?.skipDuplicates || false,
        });

        // Return the count result - if you need actual documents, query them separately
        return result;
      } else {
        // Single create with field selection
        return await prismaClient[model].create({
          data,
          select: selectObj,
        });
      }
    },
  });

  // Handle batch create response (count object) vs single create response (document)
  const isBatchCreate = Array.isArray(data);

  const returnValue = isBatchCreate
    ? {count: createdDocs?.count || 0}
    : createdDocs;

  return {
    success,
    error,
    doc: isBatchCreate ? null : createdDocs,
    responseObj: returnValue,
    docs: isBatchCreate ? [] : [createdDocs],
    isBatchCreate,
  };
};

/**
 * CREATE MANY AND RETURN - Bulk insert documents and return them
 *
 * Uses Prisma's createManyAndReturn to insert multiple records
 * and return the created documents in a single database round-trip.
 *
 * Use this when you need the created documents back (e.g., attaching to a parent).
 * For fire-and-forget bulk inserts where you only need the count, use create() with an array.
 *
 * @param {string} model - Prisma model name
 * @param {Array} data - Array of data objects to insert
 * @param {object} [tx] - Prisma transaction client
 * @param {object} [options] - Query options
 * @param {object} [fieldsInclusion] - Field selection options
 * @param {Array} [populateFields] - Relations to populate
 * @returns {object} {success, error, docs, count}
 *
 * @example
 * const {success, docs} = await PrismaFactory.createManyAndReturn({
 *   model: 'County',
 *   data: [{name: 'Adams', regionId, organizationId}, {name: 'York', regionId, organizationId}],
 *   tx,
 * });
 */
module.exports.createManyAndReturn = async ({
  model,
  data,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: createdDocs,
  } = await asyncTryCatch({
    fn: async () => {
      return await prismaClient[model].createManyAndReturn({
        data,
        select: selectObj,
        skipDuplicates: mergedOptions?.skipDuplicates || false,
      });
    },
  });

  return {
    success,
    error,
    docs: createdDocs || [],
    count: createdDocs?.length || 0,
  };
};

/**
 * FIND - Query multiple documents with filters, sorting, pagination
 */
module.exports.find = async ({
  model,
  query = {},
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: docs,
  } = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].findMany({
        where: whereClause,
        select: selectObj,
        skip: mergedOptions?.skip,
        take: mergedOptions?.take,
        orderBy: mergedOptions?.sort,

        // Pass includeDeleted to middleware
        includeDeleted: mergedOptions?.includeDeleted,
      }),
  });

  return {
    success,
    error,
    docs: docs || [],
    responseObj: docs,
  };
};

/**
 * FIND BY ID - Query single document by primary key
 */
module.exports.findById = async ({
  model,
  id,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  // Build where clause with soft delete filter and ACL context queries
  const whereClause = buildWhereClause({
    model,
    query: {id},
    options: mergedOptions,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].findFirst({
        where: whereClause,
        select: selectObj,

        // Pass includeDeleted to middleware (stripped by extension; opt-in only)
        includeDeleted: mergedOptions?.includeDeleted,
      }),
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
  };
};

/**
 * FIND ONE - Query single document with where clause
 */
module.exports.findOne = async ({
  model,
  query = {},
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].findFirst({
        where: whereClause,
        select: selectObj,

        // Pass includeDeleted to middleware (stripped by extension; opt-in only)
        includeDeleted: mergedOptions?.includeDeleted,
      }),
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
  };
};

/**
 * UPDATE ONE - Update single document without returning
 *
 * Use this when you need to update a document but don't need the updated document back.
 * Returns only success/error status and update metadata.
 *
 * @example
 * const {success, error} = await PrismaFactory.updateOne({
 *   model: 'User',
 *   query: {email: 'user@example.com'},
 *   data: {firstName: 'John'}
 * });
 */
module.exports.updateOne = async ({
  model,
  data,
  query = {},
  tx = null,
  options = {},
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  // Opt-in only, and the key is omitted entirely when not requested. The
  // soft-delete extension returns early for models it does not manage, BEFORE
  // it strips this custom option — so an always-present key would reach Prisma
  // as an unknown argument on every non-soft-delete model.
  const includeDeletedArg = mergedOptions?.includeDeleted
    ? {includeDeleted: true}
    : {};

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model]
        .findFirstOrThrow(
          Object.assign({where: whereClause}, includeDeletedArg)
        )
        .then(async (foundDoc) => {
          // After finding, update it. The extension injects isDeleted: null into
          // `update` as well as into the read, so includeDeleted has to be
          // repeated here — without it a soft-deleted row is found and then
          // silently fails to update.
          return await prismaClient[model].update(
            Object.assign({where: {id: foundDoc.id}, data}, includeDeletedArg)
          );
        }),
  });

  return {
    success,
    error,
    responseObj: response,
    isDocumentUpdated: !!response,
  };
};

/**
 * UPDATE MANY - Update multiple documents
 *
 * Use when updating multiple documents without returning them.
 * Returns count of updated documents.
 * For returning the updated documents, use findAllAndUpdate() instead.
 *
 * @example
 * const {success, responseObj} = await PrismaFactory.updateMany({
 *   model: 'User',
 *   query: {organizationId: orgId},
 *   data: {isActive: false}
 * });
 * console.log(responseObj.count); // Number of updated documents
 */
module.exports.updateMany = async ({
  model,
  data,
  query = {},
  tx = null,
  options = {},
}) => {
  const prismaClient = tx || getPrismaClient(); // Use tx if in transaction, else use regular prisma
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  // The extension re-adds isDeleted: null to updateMany, so includeDeleted must
  // reach it too (see updateOne); only its own models may receive the key.
  const includeDeletedArg =
    mergedOptions?.includeDeleted && MODELS_WITH_SOFT_DELETE.includes(model)
      ? {includeDeleted: true}
      : {};

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].updateMany(
        Object.assign({where: whereClause, data}, includeDeletedArg)
      ),
  });

  return {
    success,
    error,
    responseObj: response,
    areDocumentsUpdated: response?.count > 0,
  };
};

/**
 * FIND AND UPDATE - Update and return single document
 *
 * Use this when you need to update a document AND get the updated document back.
 * Useful for workflows where you need to return the modified data to the user.
 * Unlike updateOne(), this returns the full updated document.
 *
 * @example
 * const {success, doc} = await PrismaFactory.findOneAndUpdate({
 *   model: 'User',
 *   query: {email: 'user@example.com'},
 *   data: {firstName: 'John'},
 *   fieldsInclusion: {include: ['userOrganizations']}
 * });
 * // Returns the updated user document with selected fields
 */
module.exports.findOneAndUpdate = async ({
  model,
  data,
  query = {},
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model]
        .findFirstOrThrow({
          where: whereClause,
          select: selectObj,
        })
        .then(async (foundDoc) => {
          // After finding, update it
          return await prismaClient[model].update({
            where: {id: foundDoc.id},
            data,
            select: selectObj,
          });
        }),
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
    isDocumentUpdated: !!doc,
  };
};

/**
 * FIND BY ID AND UPDATE - Update by ID and return
 *
 * Convenience method for updating a document when you have the ID.
 * Performs a two-step operation: validates the record exists via findFirstOrThrow,
 * then updates it. Always returns the updated document.
 *
 * IMPORTANT: This is NOT atomic. In high-concurrency scenarios, a record could be
 * deleted between the find check and update (TOCTOU race condition). If deletion
 * occurs, the update will fail with a clear error, which is handled gracefully.
 *
 * For atomic updates in critical operations, wrap in a transaction:
 * @example
 * const {response: {doc}} = await PrismaFactory.transaction({
 *   callback: async (tx) => {
 *     return await PrismaFactory.findByIdAndUpdate({
 *       model: 'User',
 *       id: userId,
 *       data: {firstName: 'John'},
 *       tx  // ← Makes operation atomic
 *     });
 *   }
 * });
 *
 * Or use without transaction for typical CRUD:
 * @example
 * const {success, doc} = await PrismaFactory.findByIdAndUpdate({
 *   model: 'User',
 *   id: userId,
 *   data: {firstName: 'John'},
 *   fieldsInclusion: {include: ['userOrganizations']}
 * });
 */
module.exports.findByIdAndUpdate = async ({
  model,
  id,
  data,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});

  const whereClause = buildWhereClause({
    model,
    query: {id},
    options: mergedOptions,
  });

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model]
        .findFirstOrThrow({
          where: whereClause,
          select: selectObj,
        })
        .then(async (foundDoc) => {
          // After validating record exists (with ACL checks), update it
          return await prismaClient[model].update({
            where: {id: foundDoc.id},
            data,
            select: selectObj,
          });
        }),
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
    isDocumentUpdated: !!doc,
  };
};

/**
 * FIND ALL AND UPDATE - Update multiple documents and return the updated documents
 *
 * Use when you need to update multiple documents AND get all of them back.
 * More resource-intensive than updateMany() since it fetches updated docs.
 *
 * Replicates MongoDB findAllAndUpdate behavior:
 * 1. Find matching documents
 * 2. Update them with the provided data
 * 3. Return the updated documents
 *
 * @example
 * const {success, docs} = await PrismaFactory.findAllAndUpdate({
 *   model: 'User',
 *   query: {organizationId: orgId},
 *   data: {isActive: false},
 *   fieldsInclusion: {include: ['userOrganizations']}
 * });
 * console.log(docs); // Array of updated documents with selected fields
 */
module.exports.findAllAndUpdate = async ({
  model,
  query = {},
  data,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});
  const selectObj = buildSelectObject({model, fieldsInclusion, populateFields});

  const {success, error, response} = await asyncTryCatch({
    fn: async () => {
      // First, find all matching document IDs
      const docsToUpdate = await prismaClient[model].findMany({
        where: whereClause,
        select: {id: true},
      });

      if (docsToUpdate.length === 0) {
        return {updated: null, docs: []};
      }

      const ids = docsToUpdate.map((doc) => doc.id);

      // Update all matching documents
      const updateResult = await prismaClient[model].updateMany({
        where: {id: {in: ids}},
        data,
      });

      // Fetch and return the updated documents
      const updatedDocs = await prismaClient[model].findMany({
        where: {id: {in: ids}},
        select: selectObj,
      });

      return {updated: updateResult, docs: updatedDocs};
    },
  });

  return {
    success,
    error,
    docs: response?.docs || [],
    responseObj: response?.updated,
    areDocumentsUpdated: (response?.updated?.count || 0) > 0,
  };
};

/**
 * FIND ALL AND DELETE - Delete multiple documents and return the deleted documents
 * Replicates MongoDB findAllAndDelete behavior:
 * 1. Find matching documents (before deletion)
 * 2. Delete them (soft or hard based on options)
 * 3. Return the documents that were deleted
 */
module.exports.findAllAndDelete = async ({
  model,
  query = {},
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const {hardDelete} = options;
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});
  const selectObj = buildSelectObject({model, fieldsInclusion, populateFields});

  const {success, error, response} = await asyncTryCatch({
    fn: async () => {
      // First, find all matching documents (to return them later)
      const docsToDelete = await prismaClient[model].findMany({
        where: whereClause,
        select: selectObj,
      });

      if (docsToDelete.length === 0) {
        return {deleted: null, docs: []};
      }

      const ids = docsToDelete.map((doc) => doc.id);

      let deleteResult;
      if (hardDelete) {
        // Hard delete - permanently remove
        deleteResult = await prismaClient[model].deleteMany({
          where: {id: {in: ids}},
        });
      } else {
        // Soft delete - mark as deleted
        const deletedAt = getCurrentDateTime();
        deleteResult = await prismaClient[model].updateMany({
          where: {id: {in: ids}},
          data: {isDeleted: deletedAt},
        });

        // Update the deletedAt in returned docs to match database value
        docsToDelete.forEach((doc) => (doc.isDeleted = deletedAt));
      }

      return {deleted: deleteResult, docs: docsToDelete};
    },
  });

  return {
    success,
    error,
    docs: response?.docs || [],
    deleteType: hardDelete ? 'hardDelete' : 'softDelete',
    responseObj: response?.deleted,
    areDocumentsDeleted: (response?.deleted?.count || 0) > 0,
  };
};

/**
 * Apply cascading deletes to related records when a parent is soft-deleted
 * Supports three modes per rule:
 * - Default: Soft-delete related records (set isDeleted timestamp)
 * - hardDelete: true → Permanently remove related records (junction tables without isDeleted)
 * - setNull: fieldName → Set the FK to null (e.g., County.regionId when Region is deleted)
 */
async function applyCascadingSoftDeletes({model, parentDocId, deletedAt, tx}) {
  const client = tx || getPrismaClient();
  const rules = CASCADE_SOFT_DELETE_RULES[model] || [];

  if (rules.length === 0) return;

  for (const rule of rules) {
    // Handle special case where foreign key field differs from relation field
    const foreignKeyValue = rule.foreignKeyValue
      ? await client[model]
          .findUnique({
            where: {id: parentDocId},
            select: {[rule.foreignKeyValue]: true},
          })
          .then((doc) => doc?.[rule.foreignKeyValue])
      : parentDocId;

    if (!foreignKeyValue) continue;

    const whereClause = {
      [rule.foreignKeyField]: foreignKeyValue,
    };

    if (rule.hardDelete) {
      // Junction/relation tables without isDeleted → permanently remove
      await client[rule.relatedModel].deleteMany({
        where: whereClause,
      });
    } else if (rule.setNull) {
      // Set the FK to null instead of deleting (e.g., County.regionId)
      await client[rule.relatedModel].updateMany({
        where: whereClause,
        data: {[rule.setNull]: null},
      });
    } else {
      // Default: soft-delete (only target non-deleted records)
      whereClause.isDeleted = null;
      await client[rule.relatedModel].updateMany({
        where: whereClause,
        data: {isDeleted: deletedAt},
      });
    }
  }
}

/**
 * SOFT DELETE ONE - Mark single document as deleted
 */
module.exports.softDeleteOne = async ({
  model,
  query = {},
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const deletedAt = getCurrentDateTime();

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () => {
      // First find the document to be deleted
      const existingDoc = await prismaClient[model].findFirst({
        where: whereClause,
        select: {id: true},
      });

      if (!existingDoc) return null;

      // Apply cascading soft deletes BEFORE deleting parent
      await applyCascadingSoftDeletes({
        model,
        parentDocId: existingDoc.id,
        deletedAt,
        tx,
      });

      // Update to soft delete
      const result = await prismaClient[model].update({
        where: {id: existingDoc.id},
        data: {isDeleted: deletedAt},
        select: selectObj,
      });

      return result;
    },
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
    isDocumentDeleted: !!doc,
  };
};

/**
 * SOFT DELETE BY ID - Mark by ID as deleted
 */
module.exports.softDeleteById = async ({
  model,
  id,
  tx = null,
  options = {},
  fieldsInclusion = {},
  populateFields = [],
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});

  const whereClause = buildWhereClause({
    model,
    query: {id},
    options: mergedOptions,
  });

  const selectObj = buildSelectObject({
    model,
    fieldsInclusion,
    populateFields,
  });

  const deletedAt = getCurrentDateTime();

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () => {
      // First check if the record exists with ACL context queries
      const existingDoc = await prismaClient[model].findFirst({
        where: whereClause,
        select: {id: true},
      });

      // If record doesn't exist or doesn't pass ACL checks, return null
      if (!existingDoc) {
        return null;
      }

      // Record exists and passes ACL, proceed with cascading soft delete
      await applyCascadingSoftDeletes({
        model,
        parentDocId: existingDoc.id,
        deletedAt,
        tx,
      });

      const updatedDoc = await prismaClient[model].update({
        where: {id: existingDoc.id},
        data: {isDeleted: deletedAt},
        select: selectObj,
      });

      return updatedDoc;
    },
  });

  return {
    success,
    error,
    doc,
    responseObj: doc,
    isDocumentDeleted: !!doc,
  };
};

/**
 * SOFT DELETE MANY - Mark multiple documents as deleted
 */
module.exports.softDeleteMany = async ({
  model,
  query = {},
  tx = null,
  options = {},
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].updateMany({
        where: whereClause,
        data: {isDeleted: getCurrentDateTime()},
      }),
  });

  return {
    success,
    error,
    responseObj: response,
    areDocumentsDeleted: response?.count > 0,
  };
};

/**
 * The extra argument that makes a delete on a soft-deletable model REAL.
 *
 * The soft-delete extension rewrites every `delete` / `deleteMany` on a model
 * in MODELS_WITH_SOFT_DELETE into an update of deleted_at, and the only way
 * past it is the same `includeDeleted` flag the reads use. A hard delete must
 * be hard, so the flag is always sent for those models -- and never for the
 * others, because the extension returns early for them without stripping it
 * and Prisma would reject the unknown argument.
 */
const buildHardDeleteArgs = ({model, whereClause}) =>
  MODELS_WITH_SOFT_DELETE.includes(model)
    ? {where: whereClause, includeDeleted: true}
    : {where: whereClause};

/**
 * HARD DELETE ONE - Permanently delete single document
 */
module.exports.hardDeleteOne = async ({
  model,
  query = {},
  tx = null,
  options = {},
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].deleteMany(
        buildHardDeleteArgs({model, whereClause})
      ),
  });

  return {
    success,
    error,
    responseObj: response,
    isDocumentDeleted: response?.count > 0,
  };
};

/**
 * HARD DELETE MANY - Permanently delete multiple documents
 */
module.exports.hardDeleteMany = async ({
  model,
  query = {},
  tx = null,
  options = {},
}) => {
  const prismaClient = tx || getPrismaClient();
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await prismaClient[model].deleteMany(
        buildHardDeleteArgs({model, whereClause})
      ),
  });

  return {
    success,
    error,
    responseObj: response,
    areDocumentsDeleted: response?.count > 0,
  };
};

/**
 * COUNT DOCUMENTS - Count documents matching query
 */
module.exports.countDocuments = async ({model, query = {}, options = {}}) => {
  const mergedOptions = mergeContextQueries({options});
  const whereClause = buildWhereClause({model, query, options: mergedOptions});

  const {
    success,
    error,
    response: count,
  } = await asyncTryCatch({
    fn: async () =>
      await getPrismaClient()[model].count({
        where: whereClause,

        // Pass includeDeleted to the soft-delete extension so the count
        // matches the rows returned by find() when archived are included.
        includeDeleted: mergedOptions?.includeDeleted,
      }),
  });

  return {
    success,
    error,
    count: count || 0,
    responseObj: {count},
  };
};

/**
 * AGGREGATE - Execute complex aggregation queries using raw SQL
 * For MongoDB-style aggregations, convert pipeline to SQL first using your preferred tool
 * @param {string} query - Raw SQL query string
 * @param {array} values - Parameter values for prepared statement (optional)
 *
 * Example usage:
 * PrismaFactory.aggregate({
 *   query: 'SELECT COUNT(*) as count, "organizationId" FROM "Entity" WHERE "isDeleted" IS NULL GROUP BY "organizationId"'
 * })
 */
module.exports.aggregate = async ({query, values = []}) => {
  const {success, error, response} = await asyncTryCatch({
    fn: async () => {
      if (!query) {
        throw new Error('Query parameter is required for aggregate function');
      }

      const prismaClient = getPrismaClient();

      // A Prisma.Sql object (built by Prisma.sql`...`) carries its own bound
      // parameters, so it is run with $queryRaw, which parameterizes and
      // escapes automatically — no `values` array is used. Prisma.Sql is not
      // exported by the generated client, so we discriminate on "not a string"
      // (the legacy callers below always pass a raw SQL string).
      if (typeof query !== 'string') {
        return await prismaClient.$queryRaw(query);
      }

      // Execute raw query using Prisma's $queryRawUnsafe for safe execution
      // For parameterized queries, build the array using safeConcat to avoid spread operator
      let results;

      if (values.length > 0) {
        // Use safeConcat to combine query and values without spread operator.
        // queryArray is [query, ...values]; apply() forwards each element as a
        // positional argument to $queryRawUnsafe(query, ...values) so the $n
        // placeholders bind, without using the (banned) spread operator.
        const queryArray = safeConcat({
          originalArray: [query],
          newArray: values,
        });
        results = await prismaClient.$queryRawUnsafe.apply(
          prismaClient,
          queryArray
        );
      } else {
        results = await prismaClient.$queryRawUnsafe(query);
      }

      return results;
    },
  });

  return {
    success,
    error,
    docs: response || [],
    responseObj: response,
  };
};

/**
 * RAW QUERY - Execute raw SQL queries for complex aggregations
 * @param {string} query - Raw SQL query string
 * @param {array} values - Parameter values for prepared statement (optional)
 */
module.exports.rawQuery = async ({query, values = []}) => {
  const {success, error, response} = await asyncTryCatch({
    fn: async () => {
      if (!query) {
        throw new Error('Query parameter is required');
      }

      // Use $queryRawUnsafe for queries
      // For parameterized queries, use safeConcat to build query array without spread operator
      if (values.length === 0) {
        return await getPrismaClient().$queryRawUnsafe(query);
      }

      // For parameterized queries, concatenate using safeConcat
      const queryArray = safeConcat({
        originalArray: [query],
        newArray: values,
      });

      return await getPrismaClient().$queryRawUnsafe(queryArray);
    },
  });

  return {
    success,
    error,
    docs: response || [],
    responseObj: response,
  };
};

/**
 * TRANSACTION - Execute multiple operations in transaction
 * @param {function} callback - Function receiving prisma client for transaction
 */
module.exports.transaction = async ({callback}) => {
  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await getPrismaClient().$transaction(async (tx) => {
        return await callback(tx);
      }),
  });

  return {
    success,
    error,
    response,
    responseObj: response,
  };
};
