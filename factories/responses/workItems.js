// Response shaping shared by follow-up tasks and supervisory visits: people,
// assignees and history events look the same on both.

const findMeta = ({catalog, value}) =>
  value ? Object.values(catalog).find((m) => m.value === value) || null : null;

const formatPerson = ({user}) =>
  user
    ? {
        id: user.id,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        email: user.email || null,
      }
    : null;

const formatAssignee = ({userOrg}) =>
  userOrg
    ? {
        userOrgId: userOrg.id,
        role: userOrg.role,
        user: formatPerson({user: userOrg.user}),
      }
    : null;

const formatWorkItemEvent = ({event, eventTypes}) => ({
  id: event.id,
  type: event.type,
  typeMeta: findMeta({catalog: eventTypes, value: event.type}),
  actorType: event.actorType,
  actor: formatPerson({user: event.actor}),
  fromStatus: event.fromStatus,
  toStatus: event.toStatus,
  fromAssignee: formatAssignee({userOrg: event.fromAssignee}),
  toAssignee: formatAssignee({userOrg: event.toAssignee}),
  payload: event.payload || {},
  createdAt: event.createdAt,
});

const formatFlagSource = ({flag, sources}) => ({
  type: flag ? sources.alert.value : sources.standalone.value,
  alert: flag
    ? {
        id: flag.id,
        flag: flag.flag,
        category: flag.category,
        reason: flag.reason,
        description: flag.description,
        status: flag.status,
        createdAt: flag.createdAt,
      }
    : null,
});

function buildTemplateQuestionMap({template}) {
  const questionMap = {};

  for (const section of template.sections || []) {
    for (const question of section.questions || []) {
      const rawOptions = Array.isArray(question.options)
        ? question.options
        : [];
      questionMap[question.id] = {
        id: question.id,
        title: question.title,
        type: question.type,
        required: question.required,
        sectionLabel: section.title,
        options: rawOptions.map((opt) => ({label: opt, value: opt})),
        section: {
          title: section.title,
        },
      };
    }
  }

  return questionMap;
}

const formatChecklistAnswer = ({answer, questionMap}) => ({
  questionId: answer.questionId,
  value: answer.value !== undefined ? answer.value : null,
  comment: answer.comment || null,
  files: Array.isArray(answer.files) ? answer.files : [],
  question: questionMap[answer.questionId] || null,
});

module.exports = {
  findMeta,
  formatPerson,
  formatAssignee,
  formatWorkItemEvent,
  formatFlagSource,
  buildTemplateQuestionMap,
  formatChecklistAnswer,
};
