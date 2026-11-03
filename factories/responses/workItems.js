// Response shaping shared by follow-up tasks and supervisory visits: people,
// assignees and history events look the same on both.

const {withMembershipDetails} = require('../../utils/userUtils');

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

/**
 * A plain user (selected with buildUserMembershipsSelect) with the name, phone
 * and address they have in one organization. The membership list is dropped,
 * so other organizations' details never reach a response.
 */
const withOrganizationMember = ({user, organizationId}) => {
  if (!user) return user;

  const {userOrganizations, ...account} = user;

  const membership = (userOrganizations || []).find(
    (entry) => entry.organizationId === organizationId
  );

  return withMembershipDetails({user: account, membership});
};

/**
 * A profile whose `user` carries the profile's own membership details, with
 * the `userOrganization` it was read from dropped. A profile read with only
 * its membership gets a `user` holding just those details.
 */
const withProfileMember = ({profile}) => {
  if (!profile) return profile;

  const {userOrganization, ...rest} = profile;
  if (!rest.user && !userOrganization) return rest;

  return Object.assign(rest, {
    user: withMembershipDetails({
      user: rest.user || {},
      membership: userOrganization,
    }),
  });
};

const WORK_ITEM_PEOPLE_KEYS = [
  'createdByUser',
  'completedByUser',
  'reviewedByUser',
  'cancelledByUser',
];

/**
 * A task or visit whose plain-user people (creator, completer, reviewer,
 * canceller, event actors) read as they are in its organization. Mutates and
 * returns the item; safe on a null one.
 */
const withWorkItemPeople = ({item}) => {
  if (!item) return item;

  const {organizationId} = item;

  WORK_ITEM_PEOPLE_KEYS.forEach((key) => {
    if (item[key]) {
      item[key] = withOrganizationMember({user: item[key], organizationId});
    }
  });

  (item.events || []).forEach((event) => {
    if (event.actor) {
      event.actor = withOrganizationMember({user: event.actor, organizationId});
    }
  });

  return item;
};

// The membership is the person in that organization: names come from it.
const formatAssignee = ({userOrg}) =>
  userOrg
    ? {
        userOrgId: userOrg.id,
        role: userOrg.role,
        user: formatPerson({
          user: withMembershipDetails({
            user: userOrg.user,
            membership: userOrg,
          }),
        }),
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
  withOrganizationMember,
  withProfileMember,
  withWorkItemPeople,
  formatAssignee,
  formatWorkItemEvent,
  formatFlagSource,
  buildTemplateQuestionMap,
  formatChecklistAnswer,
};
