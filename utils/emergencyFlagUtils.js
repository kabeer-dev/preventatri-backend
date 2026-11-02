const {uploadFile, deleteFile} = require('./fileUtils');

const {S3_DIRS} = require('../constants/file');

const {RED_FLAG_MAX_IMAGES} = require('../constants/redFlagConstants');

const {EmergencyFlagErrorsFactories} = require('../factories');

// S3 storage directory value (S3_DIRS.redFlags === 'red-flags') is kept
// unchanged so existing uploaded files remain reachable without a migration.
function getEmergencyFlagFileDir({emergencyFlagId}) {
  return `${S3_DIRS.redFlags}/${emergencyFlagId}`;
}

async function uploadEmergencyFlagDocuments({
  imageFiles,
  audioFile,
  emergencyFlagId,
}) {
  const fileDir = getEmergencyFlagFileDir({emergencyFlagId});
  const uploads = (imageFiles || []).map((file) => uploadFile({file, fileDir}));

  if (audioFile) {
    uploads.push(uploadFile({file: audioFile, fileDir}));
  }

  const settled = await Promise.allSettled(uploads);

  // Collect keys of all successful uploads for potential cleanup
  const successfulKeys = settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.key);

  // If any upload failed, cleanup successful ones and throw
  const firstFailure = settled.find((r) => r.status === 'rejected');
  if (firstFailure) {
    cleanupFiles({keys: successfulKeys});
    throw firstFailure.reason;
  }

  const results = settled.map((r) => r.value);
  const images = results.slice(0, (imageFiles || []).length);

  const audioNote = audioFile
    ? {
        url: results[results.length - 1].url,
        key: results[results.length - 1].key,
      }
    : null;

  return {images, audioNote};
}

function separateEmergencyFlagFiles({files}) {
  const imageFiles = files.filter((f) => f.fieldname === 'images');
  const audioFile = files.find((f) => f.fieldname === 'audioNote');

  return {imageFiles, audioFile};
}

function validateMaxImages({currentCount, newCount}) {
  if (currentCount + newCount > RED_FLAG_MAX_IMAGES) {
    throw EmergencyFlagErrorsFactories.maxImagesExceededErr();
  }
}

function processImageRemovals({currentImages, imagesToRemove}) {
  if (!imagesToRemove || imagesToRemove.length === 0) {
    return {remainingImages: currentImages, removedKeys: []};
  }

  const existingKeys = new Set(currentImages.map((img) => img.key));
  const invalidKeys = imagesToRemove.filter((key) => !existingKeys.has(key));

  if (invalidKeys.length > 0) {
    throw EmergencyFlagErrorsFactories.invalidImagesToRemoveErr({invalidKeys});
  }

  const removeSet = new Set(imagesToRemove);
  const remainingImages = [];
  const removedKeys = [];

  for (const img of currentImages) {
    if (removeSet.has(img.key)) {
      removedKeys.push(img.key);
    } else {
      remainingImages.push(img);
    }
  }

  return {remainingImages, removedKeys};
}

function processAudioRemoval({existingAudioNote, removeAudioNote}) {
  if (removeAudioNote && existingAudioNote) {
    return {removedKey: existingAudioNote.key, audioNote: null};
  }

  return {removedKey: null, audioNote: undefined};
}

async function cleanupFiles({keys}) {
  if (!keys || keys.length === 0) return;

  keys.forEach((key) => deleteFile({key}));
}

module.exports = {
  getEmergencyFlagFileDir,
  uploadEmergencyFlagDocuments,
  separateEmergencyFlagFiles,
  validateMaxImages,
  processImageRemovals,
  processAudioRemoval,
  cleanupFiles,
};
