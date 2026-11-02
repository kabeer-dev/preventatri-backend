const {createEventRecorder} = require('./workItemEventUtils');
const {modelConstants} = require('../constants');

const record = createEventRecorder({
  model: modelConstants.MODELS.SUPERVISORY_VISIT_EVENT,
  parentKey: 'visitId',
  label: 'supervisory visit',
});

const recordVisitEvent = ({visit, ...rest}) =>
  record(Object.assign({item: visit}, rest));

module.exports = {recordVisitEvent};
