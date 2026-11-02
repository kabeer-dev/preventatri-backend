const {GeneralErrorsFactories} = require('../factories');
const {asyncTryCatch} = require('../utils/tryCatchUtils');

module.exports =
  ({validateFunction, reqProperty = 'body', options = {}}) =>
  async (req, res, next) => {
    try {
      const source = req[reqProperty];

      const context = {req, options};

      const {
        success,
        response: validationResult,
        error,
      } = await asyncTryCatch({
        fn: () => validateFunction({data: source, context}),
      });

      if (!success) return res.status(500).send(error);

      if (validationResult?.errors) {
        throw GeneralErrorsFactories.badRequestErr({
          customMessage: validationResult.errors,
        });
      }

      // Replace the original request property with the validated parameters.
      // Express 5 exposes `req.query` as a getter, so plain assignment is a no-op;
      // redefine the property to make the validated value stick.
      if (validationResult?.parameters) {
        Object.defineProperty(req, reqProperty, {
          value: validationResult.parameters,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
