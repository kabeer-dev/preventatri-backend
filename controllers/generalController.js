const {modelConstants} = require('../constants');

const {
  GeneralResponsesFactories,
  GeneralErrorsFactories,
} = require('../factories');

const {GeneralServices} = require('../services');

const {
  createOptions,
  isDocumentDuplicationError,
  isDocumentNotFoundError,
} = require('../utils');
const {cleanUsersResponse} = require('../utils/userHelpers');

module.exports = class GeneralController {
  static create({model, key, data, options}) {
    return async (req, res, next) => {
      const {doc, error} = await GeneralServices.create({
        model,
        data,
        options,
      });

      if (isDocumentDuplicationError({error})) {
        throw GeneralErrorsFactories.duplicateRecordErr({error});
      }

      if (error) throw error;

      if (doc) {
        return GeneralResponsesFactories.dataSavedSuccessfully({
          data: doc,
          key,
        });
      }
    };
  }

  static find({model, query, key, options}) {
    // Method for finding all documents without a login user
    return async (req, res, next) => {
      const {success, docs, error} = await GeneralServices.find({
        model,
        query,
        options: createOptions({
          originalOptions: options,
        }),
      });
      if (!success) throw error;
      if (docs) {
        return GeneralResponsesFactories.dataRetrievedSuccessfully({
          data: docs,
          key,
        });
      } else {
        throw GeneralErrorsFactories.notFoundErr();
      }
    };
  }

  static findAll({model, key, options}) {
    return async (req, res, next) => {
      const {success, docs, error} = await GeneralServices.find({
        model,
        options: createOptions({
          originalOptions: options,
        }),
      });
      if (!success) throw error;
      if (docs) {
        // Clean up User response - remove raw relations, keep virtual currentActiveOrganization
        const cleanedDocs =
          model === modelConstants.MODELS.USER
            ? cleanUsersResponse({users: docs})
            : docs;

        return GeneralResponsesFactories.dataRetrievedSuccessfully({
          data: cleanedDocs,
          key,
        });
      } else {
        throw GeneralErrorsFactories.notFoundErr();
      }
    };
  }
  static findAllByUserId({model, id, key, options}) {
    // Method for finding all documents with a login user
    return async (req, res, next) => {
      const {success, docs, error} = await GeneralServices.findAllByUserId({
        model,
        id,
        options: createOptions({
          originalOptions: options,
        }),
      });
      if (!success) throw error;
      if (docs) {
        return GeneralResponsesFactories.dataRetrievedSuccessfully({
          data: docs,
          key,
        });
      } else {
        throw GeneralErrorsFactories.notFoundErr();
      }
    };
  }

  static updateById({model, id, key, data, options}) {
    return async (req, res, next) => {
      const {doc, error} = await GeneralServices.findByIdAndUpdate({
        model,
        id,
        data,
        options: createOptions({
          originalOptions: options,
        }),
      });

      if (isDocumentDuplicationError({error})) {
        throw GeneralErrorsFactories.duplicateRecordErr({error});
      }

      if (isDocumentNotFoundError({error})) {
        throw GeneralErrorsFactories.notFoundErr();
      }

      if (error) throw error;

      if (!doc) {
        throw GeneralErrorsFactories.notFoundErr();
      }

      return GeneralResponsesFactories.dataUpdatedSuccessfully({
        data: doc,
        key,
      });
    };
  }

  static delete({model, query, key, options}) {
    return async (req, res, next) => {
      const {success, doc, error} = await GeneralServices.findOneAndDelete({
        model,
        query,
        options: createOptions({
          originalOptions: options,
        }),
      });
      if (!success) throw error;

      if (!doc) {
        throw GeneralErrorsFactories.notFoundErr();
      } else {
        return GeneralResponsesFactories.dataDeletedSuccessfully({
          data: doc,
          key,
        });
      }
    };
  }

  static deleteById({model, id, key, options}) {
    return async (req, res, next) => {
      const {success, doc, error} = await GeneralServices.findByIdAndDelete({
        model,
        id,
        options: createOptions({
          originalOptions: options,
        }),
      });

      if (!success) throw error;

      if (!doc) {
        throw GeneralErrorsFactories.notFoundErr();
      } else {
        return GeneralResponsesFactories.dataDeletedSuccessfully({
          data: doc,
          key,
        });
      }
    };
  }
};
