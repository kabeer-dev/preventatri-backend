const config = require('config');

const {GeneralErrorsFactories} = require('../factories');
const {getPlatforms} = require('../utils/extraReqUtils');

const platformHeader = config.get('platformHeader');

module.exports = (req, res, next) => {
  try {
    const platformFlag = req.headers[platformHeader];

    const platformFlags = getPlatforms({platformFlag});

    req.extra.flags.platforms = platformFlags;
  } catch (error) {
    // if any error occurs while setting platform, return bad request error
    return next(
      GeneralErrorsFactories.badRequestErr({
        customMessage: 'Invalid Platform',
      })
    );
  }

  next();
};
