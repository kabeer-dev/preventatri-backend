const {createEventRecorder} = require('./workItemEventUtils');
const {modelConstants} = require('../constants');

const record = createEventRecorder({
  model: modelConstants.MODELS.FOLLOW_UP_TASK_EVENT,
  parentKey: 'taskId',
  label: 'follow-up task',
});

// Keeps the `task` name callers use; everything else passes through.
const recordTaskEvent = ({task, ...rest}) =>
  record(Object.assign({item: task}, rest));

module.exports = {recordTaskEvent};
