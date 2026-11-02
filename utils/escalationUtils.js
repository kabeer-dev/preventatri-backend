const {getDaysFromNow} = require('./dateUtils');
const {uploadFile, deleteFile} = require('./fileUtils');
const {sendPrivateSocketMessage} = require('./socketUtils');

const {
  ESCALATION_STATUSES,
  ALERT_STATS_WINDOW_DAYS,
} = require('../constants/escalationConstants');

const {S3_DIRS} = require('../constants/file');

const {REPORT_TIMEOUT_ACTIONS} = require('../constants/reportsConstants');

const {
  SOCKET_EVENTS,
  SOCKET_ROOM_PREFIXES,
} = require('../constants/socketsEventConstants');

// Payload is intentionally a one-field bell — recipients re-fetch the
// escalation/red-flag list on receipt rather than read details off the socket.
function notifyNextAssignee({assigneeUserId}) {
  if (!assigneeUserId) {
    return;
  }

  sendPrivateSocketMessage({
    room: `${SOCKET_ROOM_PREFIXES.USER.value}${assigneeUserId}`,
    event: SOCKET_EVENTS.ASSIGNED_RED_FLAG.value,
    data: {message: 'red flag raised'},
  });
}

function notifyPreviousAssignee({previousAssigneeUserId}) {
  if (!previousAssigneeUserId) {
    return;
  }

  sendPrivateSocketMessage({
    room: `${SOCKET_ROOM_PREFIXES.USER.value}${previousAssigneeUserId}`,
    event: SOCKET_EVENTS.ESCALATION_RED_FLAG.value,
    data: {message: 'red flag escalated'},
  });
}

// Upload the nurse's resolution attachments to S3, keyed under the escalation
// (one response per escalation, so escalationId is a stable, unique directory).
// All-or-nothing: if any upload fails, the already-uploaded ones are cleaned up
// and the error is re-thrown so the caller can fail the request cleanly.
async function uploadResolutionAttachments({files, escalationId}) {
  if (!files || files.length === 0) {
    return [];
  }

  const fileDir = `${S3_DIRS.escalationResolutions}/${escalationId}`;

  const settled = await Promise.allSettled(
    files.map((file) => uploadFile({file, fileDir}))
  );

  const uploadedKeys = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value.key);

  const firstFailure = settled.find((result) => result.status === 'rejected');

  if (firstFailure) {
    await cleanupResolutionAttachments({keys: uploadedKeys});
    throw firstFailure.reason;
  }

  return settled.map((result) => ({
    url: result.value.url,
    key: result.value.key,
  }));
}

// Best-effort removal of orphaned S3 objects (e.g. when the resolution write
// fails after files were already uploaded). Awaits all deletions (settled, so a
// single failure doesn't abort the rest) before resolving, so callers can be
// sure cleanup finished before the request returns.
async function cleanupResolutionAttachments({keys}) {
  if (!keys || keys.length === 0) {
    return;
  }

  await Promise.allSettled(keys.map((key) => deleteFile({key})));
}

function getAlertStatsWindowStart() {
  return getDaysFromNow({days: -ALERT_STATS_WINDOW_DAYS, isStartOfDay: false});
}

// An event query: every missed step deadline is one breach, so a flag that
// escalated three times counts three. The event model has no organizationId,
// hence the scope through the parent escalation. Voided flags do not count.
function buildSlaBreachQuery({organizationId}) {
  return {
    action: {in: REPORT_TIMEOUT_ACTIONS},
    endedAt: {gte: getAlertStatsWindowStart()},
    escalation: {
      organizationId,
      status: {not: ESCALATION_STATUSES.VOIDED.value},
    },
  };
}

module.exports = {
  buildSlaBreachQuery,
  getAlertStatsWindowStart,
  notifyNextAssignee,
  notifyPreviousAssignee,
  uploadResolutionAttachments,
  cleanupResolutionAttachments,
};
