const {alertsWorker} = require('./workers/alertsWorker');
const {followUpTasksWorker} = require('./workers/followUpTasksWorker');
const {hhaSyncWorker} = require('./workers/hhaSyncWorker');
const {notificationsWorker} = require('./workers/notificationsWorker');

const {WORKER_NAMES} = require('../../constants/queueConstants');

const workerRegistrations = [
  {
    name: WORKER_NAMES.START_FLAG_ESCALATION,
    loader: () => alertsWorker,
  },
  {
    name: WORKER_NAMES.DELIVER_NOTIFICATION,
    loader: () => notificationsWorker,
  },
  {
    name: WORKER_NAMES.RUN_HHA_SYNC,
    loader: () => hhaSyncWorker,
  },
  {
    name: WORKER_NAMES.PROCESS_OVERDUE_FOLLOW_UP_TASKS,
    loader: () => followUpTasksWorker,
  },
];

const startWorkers = () => {
  const workers = workerRegistrations.map(({name, loader}) => {
    const workerInstance = loader();

    return workerInstance;
  });

  return workers;
};

module.exports = {
  startWorkers,
};
