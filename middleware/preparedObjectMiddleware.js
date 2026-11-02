const {GeneralErrorsFactories} = require('../factories');
const {PrismaFactory} = require('../factories');
const {asyncTryCatch} = require('../utils/tryCatchUtils');

module.exports.setPreparedObject =
  ({model, id, key}) =>
  async (req, _, next) => {
    try {
      const {response, error} = await asyncTryCatch({
        fn: async () => await PrismaFactory.findOne({model, query: {id}}),
      });

      if (error) throw GeneralErrorsFactories.badRequestErr();

      if (!response) throw GeneralErrorsFactories.notFoundErr();

      req.preparedObj = {
        [key]: response,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
