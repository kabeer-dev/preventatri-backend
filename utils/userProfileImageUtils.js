const {uploadFile, deleteFile} = require('./fileUtils');

const {S3_DIRS} = require('../constants/file');

function getProfileImageFileDir({userId}) {
  return `${S3_DIRS.profileImages}/${userId}`;
}

async function uploadProfileImage({file, userId}) {
  const fileDir = getProfileImageFileDir({userId});

  return uploadFile({file, fileDir});
}

// Best-effort cleanup -- failures are logged inside deleteFile and must never
// block the response for the DB write that already succeeded/failed.
function cleanupProfileImage({key}) {
  if (!key) return;

  deleteFile({key});
}

module.exports = {
  getProfileImageFileDir,
  uploadProfileImage,
  cleanupProfileImage,
};
