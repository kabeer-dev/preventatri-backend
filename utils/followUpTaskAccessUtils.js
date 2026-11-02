const {
  FOLLOW_UP_TASK_ASSIGNABLE_ROLES,
} = require('../constants/followUpTasksConstants');

const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {FollowUpTasksErrorsFactories} = require('../factories');

const {
  buildCaseManagerPatientScopeClause,
} = require('./caseManagerPatientAccessUtils');

const {
  buildCaregiverPatientAccessClause,
} = require('./checklistAssignmentUtils');

const {buildNursePatientScopeClause} = require('./nursePatientScopeUtils');

const {
  resolveWorkItemActor,
  resolveCareTeamMembers,
} = require('./workItemAccessUtils');

module.exports.resolveFollowUpTaskActor = resolveWorkItemActor;

/**
 * Prisma clause narrowing tasks to what the actor may see. Admins see the org;
 * case managers their own tasks plus their caseload; nurses their own plus
 * every task on patients they can see, so a newly assigned nurse sees the
 * patient's history; caregivers only what is assigned to them on patients
 * they are still assigned to.
 */
module.exports.buildFollowUpTaskScopeClause = ({actor}) => {
  const assigned = {assigneeUserOrganizationId: actor.userOrgId};
  const created = {createdBy: actor.userId};

  switch (actor.role) {
    case SYSTEM_ROLES.admin.value:
      return {};
    case SYSTEM_ROLES.case_manager.value:
      return {
        OR: [
          assigned,
          created,
          buildCaseManagerPatientScopeClause({
            caseManagerProfileId: actor.caseManagerProfileId,
          }),
        ],
      };
    case SYSTEM_ROLES.nurse.value:
      return {
        OR: [
          assigned,
          created,
          {
            patient: buildNursePatientScopeClause({
              nurseScope: actor.nurseScope,
            }),
          },
        ],
      };
    case SYSTEM_ROLES.caregiver.value:
      return Object.assign(assigned, {
        patient: buildCaregiverPatientAccessClause({userId: actor.userId}),
      });
    default:
      return assigned;
  }
};

const isAdmin = ({actor}) => actor.role === SYSTEM_ROLES.admin.value;

const isAssignee = ({actor, task}) =>
  task.assigneeUserOrganizationId === actor.userOrgId;
const isCreator = ({actor, task}) => task.createdBy === actor.userId;

const isAdminOwned = ({task}) =>
  task.assignee?.role === SYSTEM_ROLES.admin.value;

const isCaseManager = ({actor}) =>
  actor.role === SYSTEM_ROLES.case_manager.value;

// Edit / cancel. A case manager only reaches a task through the scope clause
// (assigned, created, or caseload), so the role alone is enough here. Once a
// task sits with an admin (escalated or assigned), only admins manage it.
module.exports.canManageTask = ({actor, task}) =>
  isAdmin({actor}) ||
  (!isAdminOwned({task}) &&
    (isCreator({actor, task}) || isCaseManager({actor})));

// PREVENT-772: reopen removed for now; uncomment to restore.
// // Reopen: admins, or a case manager unless the task sits with an admin.
// module.exports.canReopenTask = ({actor, task}) =>
//   isAdmin({actor}) || (!isAdminOwned({task}) && isCaseManager({actor}));

// Only the current assignee solves a task; an admin gets it by escalation or reassignment.
module.exports.canActOnTask = ({actor, task}) => isAssignee({actor, task});

module.exports.assertCanManageTask = ({actor, task}) => {
  if (!module.exports.canManageTask({actor, task}))
    throw FollowUpTasksErrorsFactories.forbiddenTaskActionErr();
};

// PREVENT-772: reopen removed for now; uncomment to restore.
// module.exports.assertCanReopenTask = ({actor, task}) => {
//   if (!module.exports.canReopenTask({actor, task}))
//     throw FollowUpTasksErrorsFactories.forbiddenTaskActionErr();
// };

module.exports.assertCanActOnTask = ({actor, task}) => {
  if (!module.exports.canActOnTask({actor, task}))
    throw FollowUpTasksErrorsFactories.forbiddenTaskActionErr();
};

/**
 * The assignee must be on the patient's care team. Returns the member (with
 * userId for notifications) or throws 422.
 */
module.exports.validateAssignee = async ({
  assigneeUserOrganizationId,
  patientId,
  organizationId,
  tx,
}) => {
  const {success, members, error} = await resolveCareTeamMembers({
    userOrgIds: [assigneeUserOrganizationId],
    patientId,
    organizationId,
    roles: FOLLOW_UP_TASK_ASSIGNABLE_ROLES,
    tx,
  });

  if (!success) throw error;
  if (!members[0])
    throw FollowUpTasksErrorsFactories.assigneeNotInCareTeamErr();

  return members[0];
};
