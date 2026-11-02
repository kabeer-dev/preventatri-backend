// Queue identifiers — must match between Queue and Worker.
const QUEUE_NAMES = {
  FLAG_ESCALATION: 'flag-escalation',

  // Dedicated queue for delivering a persisted notification to a recipient's
  // external channels (SMS + email). Kept separate from FLAG_ESCALATION so
  // notification-delivery volume and retention are tuned independently of the
  // escalation-processing jobs.
  NOTIFICATION_DELIVERY: 'notification-delivery',

  // The HHAeXchange import: long, exclusive, and reported over a socket rather
  // than in the response.
  HHA_SYNC: 'hha-sync',

  // Work-item sweeps (nightly overdue escalation + reminders) for follow-up
  // tasks and supervisory visits. The name predates the visits; renaming a
  // queue would orphan its Redis scheduler keys.
  FOLLOW_UP_TASKS: 'follow-up-tasks',
};

// Job-type label passed to `queue.add(name, data)`.
const JOB_NAMES = {
  START_FLAG_ESCALATION: 'start-flag-escalation',
  PROCESS_ESCALATIONS: 'process-escalations',
  PROCESS_ESCALATION_EXPIRY: 'process-escalation-expiry',
  DELIVER_NOTIFICATION: 'deliver-notification',
  RUN_HHA_SYNC: 'run-hha-sync',
  PROCESS_OVERDUE_FOLLOW_UP_TASKS: 'process-overdue-follow-up-tasks',
  PROCESS_FOLLOW_UP_TASK_REMINDERS: 'process-follow-up-task-reminders',
  PROCESS_OVERDUE_SUPERVISORY_VISITS: 'process-overdue-supervisory-visits',
  PROCESS_SUPERVISORY_VISIT_REMINDERS: 'process-supervisory-visit-reminders',
};

// Stable ids for BullMQ Job Schedulers (repeatable jobs managed in Redis).
// upsertJobScheduler is keyed on this id, so re-running setup on every app
// boot updates the existing scheduler instead of creating duplicates.
const JOB_SCHEDULER_IDS = {
  PROCESS_ESCALATIONS: 'process-escalations-every-minute',
  PROCESS_OVERDUE_FOLLOW_UP_TASKS: 'process-overdue-follow-up-tasks-nightly',
  PROCESS_FOLLOW_UP_TASK_REMINDERS:
    'process-follow-up-task-reminders-every-five-minutes',
  PROCESS_OVERDUE_SUPERVISORY_VISITS:
    'process-overdue-supervisory-visits-nightly',
  PROCESS_SUPERVISORY_VISIT_REMINDERS:
    'process-supervisory-visit-reminders-every-five-minutes',
};

// Default BullMQ options for every job added to the alerts queue.
const DEFAULT_JOB_OPTIONS = {
  // Total tries before the job is marked failed (1 initial + 2 retries).
  attempts: 3,

  // Retry waits double each time: 5s → 10s → 20s.
  backoff: {type: 'exponential', delay: 5000},

  // Drop completed jobs from Redis after 1h OR once 50 newer ones exist.
  // The per-minute escalation scheduler emits 1,440 jobs/day, so keep the
  // completed footprint small — these are disposable no-op sweeps.
  removeOnComplete: {age: 3600, count: 50},

  // Keep failed jobs for debugging, but CAP the count. Without a count limit a
  // per-minute job that keeps failing accumulates ~1,440 job hashes/day (up to
  // ~10k over the 7-day age) and fills a small Redis — the memory leak that the
  // scheduler introduced. 24h + 200 newest is plenty to debug a failing sweep.
  removeOnFail: {age: 24 * 3600, count: 200},
};

// BullMQ options for notification-delivery jobs. Each in-app notification
// enqueues one delivery job per recipient, so retention is capped tightly (with
// a count limit on BOTH buckets) to keep the small Redis instance safe.
const NOTIFICATION_DELIVERY_JOB_OPTIONS = {
  // 1 initial try + 2 retries — covers a transient Twilio/Resend hiccup.
  attempts: 3,

  // Retry waits double each time: 5s → 10s → 20s.
  backoff: {type: 'exponential', delay: 5000},

  // Delivered jobs are disposable — drop after 1h or once 100 newer exist.
  removeOnComplete: {age: 3600, count: 100},

  // Keep failures 24h for debugging, capped at 500 so a broken Twilio/Resend
  // integration can't accumulate unbounded job hashes.
  removeOnFail: {age: 24 * 3600, count: 500},
};

// attempts: 1 is the point. A run reconciles thousands of records and is not
// cheap to repeat; the nightly cron is the real retry, and failures reach
// admins as a notification rather than being silently re-attempted.
const HHA_SYNC_JOB_OPTIONS = {
  attempts: 1,

  removeOnComplete: {age: 24 * 3600, count: 20},

  // Failed runs are worth keeping to inspect; the queued-slot marker (not the
  // job id) gates a new run, so a lingering failure never blocks the button.
  removeOnFail: {age: 7 * 24 * 3600, count: 50},
};

// Job-name values the worker's `switch (job.name)` matches on.
const WORKER_NAMES = {
  START_FLAG_ESCALATION: 'start-flag-escalation',
  PROCESS_ESCALATIONS: 'process-escalations',
  PROCESS_ESCALATION_EXPIRY: 'process-escalation-expiry',
  DELIVER_NOTIFICATION: 'deliver-notification',
  RUN_HHA_SYNC: 'run-hha-sync',
  PROCESS_OVERDUE_FOLLOW_UP_TASKS: 'process-overdue-follow-up-tasks',
  PROCESS_FOLLOW_UP_TASK_REMINDERS: 'process-follow-up-task-reminders',
  PROCESS_OVERDUE_SUPERVISORY_VISITS: 'process-overdue-supervisory-visits',
  PROCESS_SUPERVISORY_VISIT_REMINDERS: 'process-supervisory-visit-reminders',
};

// Basic-Auth challenge realm advertised on a 401 (an auth-scheme header value,
// not a response type — so it stays local rather than in the error constants).
const BULL_BOARD_AUTH_REALM = 'Basic realm="Bull Board"';

module.exports = {
  QUEUE_NAMES,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  DEFAULT_JOB_OPTIONS,
  NOTIFICATION_DELIVERY_JOB_OPTIONS,
  HHA_SYNC_JOB_OPTIONS,
  WORKER_NAMES,
  BULL_BOARD_AUTH_REALM,
};
