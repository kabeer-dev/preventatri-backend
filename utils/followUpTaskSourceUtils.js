const {FOLLOW_UP_TASK_SOURCES} = require('../constants/followUpTasksConstants');

// A visit wins over its alert: a flag-triggered visit's follow-ups carry both.
module.exports.resolveTaskSourceType = ({
  supervisoryVisitId,
  submissionFlagId,
}) => {
  if (supervisoryVisitId) return FOLLOW_UP_TASK_SOURCES.supervisoryVisit.value;
  if (submissionFlagId) return FOLLOW_UP_TASK_SOURCES.alert.value;

  return FOLLOW_UP_TASK_SOURCES.standalone.value;
};
