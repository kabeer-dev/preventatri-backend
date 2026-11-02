const {finalizeResponse} = require('../utils/expressUtils');
const {signFileRefs} = require('../utils/fileUtils');

module.exports = async (req, res, next) => {
  try {
    // S3 objects are private, so every file reference leaving the API gets a
    // freshly presigned, expiring URL. Doing it here covers every route and
    // response factory without each one having to opt in.
    if (req?.extra?.appResponse) {
      await signFileRefs({payload: req.extra.appResponse});
    }

    return finalizeResponse({req, res});
  } catch (error) {
    next(error);
  }
};
