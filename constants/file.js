module.exports.FILE_NOT_FOUND = 'FILE_NOT_FOUND';

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
];

// PDF + Word (.doc / .docx) document types.
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Escalation resolution attachments accept supporting images as well as PDF/Word
// documents.
const ALLOWED_RESOLUTION_ATTACHMENT_TYPES = ALLOWED_IMAGE_TYPES.concat(
  ALLOWED_DOCUMENT_TYPES
);

// Follow-up task completion evidence: same image + PDF/Word set as resolutions.
const ALLOWED_TASK_EVIDENCE_TYPES = ALLOWED_RESOLUTION_ATTACHMENT_TYPES;
const MAX_TASK_EVIDENCE_FILES = 5;

// Profile images are restricted to JPEG/PNG only (narrower than the general
// ALLOWED_IMAGE_TYPES above, which also permits webp/heic/heif), capped at 5MB.
const ALLOWED_PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const PROFILE_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

const S3_DIRS = {
  submissions: 'submissions',
  redFlags: 'red-flags',
  supervisoryVisits: 'supervisory-visits',
  followUpTasks: 'follow-up-tasks',
  escalationResolutions: 'escalation-resolutions',
  profileImages: 'profile-images',
};

// Prefixes used to recognise a stored file reference ({url, key}) inside an
// arbitrary API response payload so its `url` can be signed on the way out.
const S3_KEY_PREFIXES = Object.values(S3_DIRS);

module.exports.ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_TYPES;

module.exports.ALLOWED_AUDIO_TYPES = ALLOWED_AUDIO_TYPES;
module.exports.ALLOWED_DOCUMENT_TYPES = ALLOWED_DOCUMENT_TYPES;
module.exports.ALLOWED_RESOLUTION_ATTACHMENT_TYPES =
  ALLOWED_RESOLUTION_ATTACHMENT_TYPES;
module.exports.ALLOWED_TASK_EVIDENCE_TYPES = ALLOWED_TASK_EVIDENCE_TYPES;
module.exports.MAX_TASK_EVIDENCE_FILES = MAX_TASK_EVIDENCE_FILES;
module.exports.ALLOWED_PROFILE_IMAGE_TYPES = ALLOWED_PROFILE_IMAGE_TYPES;
module.exports.PROFILE_IMAGE_MAX_SIZE_BYTES = PROFILE_IMAGE_MAX_SIZE_BYTES;
module.exports.S3_DIRS = S3_DIRS;
module.exports.S3_KEY_PREFIXES = S3_KEY_PREFIXES;
