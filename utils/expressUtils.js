module.exports.finalizeResponse = ({req, res}) => {
  const header = {
    'Content-Type': 'application/json',
  };

  const data = req?.extra?.appResponse || req?.extra?.errResponse;

  return res.status(data.statusCode).set(header).json(data);
};

/* eslint-disable local-rules/enforce-single-object-param */
module.exports.dynamicRoutesMiddlewareChecker =
  (fn) => async (req, res, next) => {
    try {
      if (!req?.extra?.flags?.isRequestFullFilled) return fn(req, res, next);

      next();
    } catch (error) {
      next(error);
    }
  };
