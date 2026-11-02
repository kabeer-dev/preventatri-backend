const {
  attachExtraQueriesFromOptions,
  mergeContextQueries,
} = require('../utils/aclUtils');
const {convertMongoIdsInQuery, safeMerge} = require('../utils/general');
const {asyncTryCatch} = require('../utils/tryCatchUtils');

function generateSelectFields({fieldsInclusion = {}}) {
  const {
    exclude = [], // Array of field names to exclude from the response. Example: ['secretKeys.verification'] . no need to add fields that are marked as `select: false` in the schema as they are excluded by default.
    include = [], // Array of fields that are marked as `select: false` in the schema but should be included in the response. Example: ['password', 'createdAt', 'updatedAt'].
    includeSpecificFields = [], // If provided, only these specific fields will be included in the response, ignoring `exclude` and `include` options. Example: ['_id', 'name', 'email'].
  } = fieldsInclusion;

  // If specific fields are provided, return them directly
  if (includeSpecificFields.length > 0)
    return {
      select: includeSpecificFields.join(' '),
      skipMiddlewareGlobalPopulation: true,
    };

  // Create field selection strings
  const excludeString = exclude.map((field) => `-${field}`).join(' ');
  const includeString = include.map((field) => `+${field}`).join(' ');

  // Combine exclude and include strings, filtering out empty strings

  return {
    select: [includeString, excludeString].filter(Boolean).join(' '),
    skipMiddlewareGlobalPopulation: false,
  };
}

async function hardDeleteMany({
  model,
  query = {},
  session = null,
  options = {},
}) {
  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {success, error, response} = await asyncTryCatch({
    fn: async () => await model.deleteMany(finalQuery).session(session),
  });

  return {
    success,
    error,
    responseObj: response,
    areDocumentsDeleted: response?.deletedCount > 0,
  };
}

async function hardDeleteOne({
  model,
  query = {},
  session = null,
  options = {},
}) {
  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {success, error, response} = await asyncTryCatch({
    fn: async () => await model.deleteOne(finalQuery).session(session),
  });

  return {
    success,
    error,
    responseObj: response,
    isDocumentDeleted: response?.deletedCount > 0,
  };
}

async function updateOne({
  model,
  data,
  query = {},
  session = null,
  options = {},
}) {
  const {includeDeleted} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await model
        .updateOne(finalQuery, data)
        .session(session)
        .setOptions({includeDeleted}),
  });

  return {
    success,
    error,
    responseObj: response,
    isDocumentUpdated: response?.modifiedCount > 0,
  };
}

async function updateMany({
  model,
  data,
  query = {},
  options = {},
  session = null,
}) {
  const {includeDeleted} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await model
        .updateMany(finalQuery, data)
        .session(session)
        .setOptions({includeDeleted}),
  });

  return {
    success,
    error,
    responseObj: response,
    areDocumentsUpdated: response?.modifiedCount > 0,
  };
}

// CREATE FUNCTIONS
module.exports.create = async ({model, data, session = null, options = {}}) => {
  let docs = null;

  const {
    success,
    error,
    response: createdDocs,
  } = await asyncTryCatch({
    fn: async () => {
      if (Array.isArray(data)) {
        return await model.create(data, {session});
      } else {
        const doc = new model(data);

        return await doc.save({session});
      }
    },
  });

  const docsToFetch = Array.isArray(createdDocs) ? createdDocs : [createdDocs];

  if (success) {
    ({docs} = await this.find({
      model,
      session,
      options,
      query: {_id: {$in: docsToFetch.map((doc) => doc._id)}},
    }));
  }

  return {
    success,
    doc: success ? (Array.isArray(data) ? docs : docs[0]) : null,
    error,
  };
};

// FIND FUNCTIONS
module.exports.find = async ({
  model,
  query = {},
  options = {},
  session = null,
}) => {
  const {
    populateFields = '',
    queryProperties = {},
    includeDeleted,
    fieldsInclusion,
  } = options;

  const {select, skipMiddlewareGlobalPopulation} = generateSelectFields({
    fieldsInclusion,
  });

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {
    success,
    error,
    response: docs,
  } = await asyncTryCatch({
    fn: async () =>
      await model
        .find(finalQuery, null, queryProperties)
        .populate(populateFields)
        .select(select)
        .session(session)
        .setOptions({includeDeleted, skipMiddlewareGlobalPopulation}),
  });

  return {success, docs, error};
};

module.exports.findOne = async ({
  model,
  query = {},
  options = {},
  session = null,
}) => {
  const {populateFields = '', includeDeleted, fieldsInclusion} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {select, skipMiddlewareGlobalPopulation} = generateSelectFields({
    fieldsInclusion,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await model
        .findOne(finalQuery)
        .populate(populateFields)
        .select(select)
        .session(session)
        .setOptions({includeDeleted, skipMiddlewareGlobalPopulation}),
  });

  return {success, doc, error};
};

module.exports.findById = async ({model, _id, session = null, options = {}}) =>
  await this.findOne({
    model,
    query: {_id},
    options,
    session,
  });

// UPDATE FUNCTIONS

// findOneAndUpdate function is used to update a single document and return the updated document
module.exports.findOneAndUpdate = async ({
  model,
  query = {},
  data,
  session = null,
  options = {},
}) => {
  const {includeDeleted, populateFields = '', fieldsInclusion} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {select, skipMiddlewareGlobalPopulation} = generateSelectFields({
    fieldsInclusion,
  });

  const {
    success,
    error,
    response: doc,
  } = await asyncTryCatch({
    fn: async () =>
      await model
        .findOneAndUpdate(finalQuery, data, {new: true})
        .populate(populateFields)
        .select(select)
        .session(session)
        .setOptions({includeDeleted, skipMiddlewareGlobalPopulation}),
  });

  return {success, doc, error, isDocumentUpdated: !!doc};
};

// findByIdAndUpdate function is used to update a single document only by _id and return the updated document
module.exports.findByIdAndUpdate = async ({
  model,
  _id,
  data,
  session = null,
  options = {},
}) =>
  await this.findOneAndUpdate({
    model,
    query: {_id},
    data,
    session,
    options,
  });

// findAllAndUpdate function is used to update multiple documents and return the updated documents
module.exports.findAllAndUpdate = async ({
  model,
  query = {},
  data,
  session = null,
  options = {},
}) => {
  let updatedDocs = [];
  const {includeDeleted, extraQueries} = options;

  const {docs: documentIds} = await this.find({
    model,
    query,
    options: {
      includeDeleted,
      fieldsInclusion: {
        includeSpecificFields: ['_id'],
      },
      extraQueries,
    }, // these are the only options we need in the first find, while in the next one we'll pass all the options eventually. This is just to get ids of the documents to be updated
  });

  const {success, error, areDocumentsUpdated} = await updateMany({
    data,
    model,
    query,
    session,
    options,
  });

  if (documentIds.length > 0) {
    const {docs} = await this.find({
      model,
      query: {_id: {$in: documentIds}},
      options,
      session,
    });
    updatedDocs = docs;
  }

  return {success, error, docs: updatedDocs, areDocumentsUpdated};
};

// updateOne function is used to update a single document but doest not return the updated document
module.exports.updateOne = async ({
  model,
  query = {},
  data,
  session = null,
  options = {},
}) =>
  await updateOne({
    model,
    query,
    data,
    session,
    options,
  });

// updateMany function is used to update multiple documents but doest not return the updated documents
module.exports.updateMany = async ({
  model,
  query = {},
  data,
  session = null,
  options = {},
}) =>
  await updateMany({
    data,
    model,
    query,
    session,
    options,
  });

// DELETE FUNCTIONS

// findOneAndDelete function is used to delete a single document and return the deleted document
module.exports.findOneAndDelete = async ({
  model,
  query = {},
  session = null,
  options = {},
}) => {
  const {hardDelete, populateFields = '', fieldsInclusion} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {select, skipMiddlewareGlobalPopulation} = generateSelectFields({
    fieldsInclusion,
  });

  let {success, error, doc} = {};

  if (hardDelete) {
    ({
      success,
      error,
      response: doc,
    } = await asyncTryCatch({
      fn: async () =>
        await model
          .findOneAndDelete(finalQuery)
          .populate(populateFields)
          .select(select)
          .session(session)
          .setOptions({skipMiddlewareGlobalPopulation}),
    }));
  } else {
    ({
      success,
      error,
      response: doc,
    } = await asyncTryCatch({
      fn: async () =>
        await model
          .findOneAndUpdate(finalQuery, {deletedAt: new Date()}, {new: true})
          .populate(populateFields)
          .select(select)
          .session(session)
          .setOptions({skipMiddlewareGlobalPopulation}),
    }));
  }

  return {success, doc, error, isDocumentDeleted: !!doc};
};

// findByIdAndDelete function is used to delete a single document only by _id and return the deleted document
module.exports.findByIdAndDelete = async ({
  model,
  _id,
  options = {},
  session = null,
}) => await this.findOneAndDelete({model, query: {_id}, options, session});

// findAllAndDelete function is used to delete multiple documents and return the deleted documents
module.exports.findAllAndDelete = async ({
  model,
  query = {},
  options = {},
  session = null,
}) => {
  const {hardDelete} = options;
  let {success, error, areDocumentsDeleted} = {};

  const {docs: documentsToBeDeleted} = await this.find({
    model,
    query,
    options,
    session,
  });
  if (hardDelete) {
    ({error, success, areDocumentsDeleted} = await hardDeleteMany({
      model,
      query,
      session,
      options,
    }));
  } else {
    const deletedAt = new Date();
    ({
      error,
      success,
      areDocumentsUpdated: areDocumentsDeleted,
    } = await this.updateMany({
      model,
      query,
      data: {deletedAt},
      options,
      session,
    }));

    //  Update the `deletedAt` field in each document to mark them as soft-deleted.
    documentsToBeDeleted.forEach((doc) => (doc.deletedAt = deletedAt));
  }

  const deleteType = hardDelete ? 'hardDelete' : 'softDelete';

  return {
    success,
    error,
    docs: documentsToBeDeleted,
    deleteType,
    areDocumentsDeleted,
  };
};

// deleteOne function is used to delete a single document but doest not return the deleted document
module.exports.deleteOne = async ({
  model,
  query = {},
  session = null,
  options = {},
}) => {
  const {hardDelete} = options;

  let {success, error, responseObj, isDocumentDeleted} = {};

  if (hardDelete) {
    ({error, responseObj, success, isDocumentDeleted} = await hardDeleteOne({
      model,
      options,
      query,
      session,
    }));
  } else {
    ({
      error,
      responseObj,
      success,
      isDocumentUpdated: isDocumentDeleted,
    } = await this.updateOne({
      model,
      query,
      data: {deletedAt: new Date()},
      options,
      session,
    }));
  }

  const deleteType = hardDelete ? 'hardDelete' : 'softDelete';

  return {
    success,
    error,
    responseObj,
    deleteType,
    isDocumentDeleted,
  };
};

// deleteMany function is used to delete multiple documents but doest not return the deleted documents
module.exports.deleteMany = async ({
  model,
  query = {},
  session = null,
  options = {},
}) => {
  const {hardDelete} = options;

  let {success, error, responseObj, areDocumentsDeleted} = {};
  if (hardDelete) {
    ({error, responseObj, success, areDocumentsDeleted} = await hardDeleteMany({
      model,
      query,
      session,
      options,
    }));
  } else {
    ({
      error,
      responseObj,
      success,
      areDocumentsUpdated: areDocumentsDeleted,
    } = await this.updateMany({
      model,
      query,
      data: {deletedAt: new Date()},
      session,
      options,
    }));
  }

  const deleteType = hardDelete ? 'hardDelete' : 'softDelete';

  return {
    success,
    error,
    responseObj,
    deleteType,
    areDocumentsDeleted,
  };
};

// AGGREGATE FUNCTION
module.exports.aggregate = async ({model, pipeline, options = {}}) => {
  const mergedOptions = mergeContextQueries({options});
  const {includeDeleted, extraQueries = {}} = mergedOptions;

  const hasMatchStage = pipeline.some((stage) => !!stage?.$match);
  const convertedExtraQueries = convertMongoIdsInQuery({query: extraQueries});

  const finalPipeline = pipeline.map((stage) => {
    if (stage?.$match) {
      return safeMerge({
        originalObj: stage,
        newObj: {
          $match: safeMerge({
            originalObj: stage.$match,
            newObj: convertedExtraQueries,
          }),
        },
      });
    }

    return stage;
  });

  // If no $match stage, add one at the beginning
  if (!hasMatchStage) {
    finalPipeline.unshift({$match: convertedExtraQueries});
  }

  const {
    success,
    error,
    response: docs,
  } = await asyncTryCatch({
    fn: async () => await model.aggregate(finalPipeline, {includeDeleted}),
  });

  return {success, docs, error};
};

module.exports.countDocuments = async ({model, query = {}, options = {}}) => {
  const {includeDeleted} = options;

  const finalQuery = attachExtraQueriesFromOptions({
    originalQuery: query,
    options,
  });

  const {success, error, response} = await asyncTryCatch({
    fn: async () =>
      await model.countDocuments(finalQuery).setOptions({includeDeleted}),
  });

  return {
    success,
    error,
    count: response,
  };
};
