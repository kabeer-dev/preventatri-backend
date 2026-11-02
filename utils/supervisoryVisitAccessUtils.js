const {
  SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
  SUPERVISORY_VISIT_CAREGIVER_ROLES,
} = require('../constants/supervisoryVisitsConstants');

const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {SupervisoryVisitsErrorsFactories} = require('../factories');

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

module.exports.resolveSupervisoryVisitActor = resolveWorkItemActor;

/**
 * Prisma clause narrowing visits to what the actor may see. Admins see the
 * org; case managers their own visits plus their caseload; nurses their own
 * plus every visit on patients they can see, so a newly assigned nurse sees
 * the patient's history; caregivers only visits they are listed on, for
 * patients they are still assigned to.
 */
module.exports.buildSupervisoryVisitScopeClause = ({actor}) => {
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
      return {
        caregivers: {some: {userOrganizationId: actor.userOrgId}},
        patient: buildCaregiverPatientAccessClause({userId: actor.userId}),
      };
    default:
      return assigned;
  }
};

const isAdmin = ({actor}) => actor.role === SYSTEM_ROLES.admin.value;

const isCaseManager = ({actor}) =>
  actor.role === SYSTEM_ROLES.case_manager.value;

const isAssignee = ({actor, visit}) =>
  visit.assigneeUserOrganizationId === actor.userOrgId;

const isCreator = ({actor, visit}) => visit.createdBy === actor.userId;

const isFiler = ({actor, visit}) =>
  Boolean(visit.completedBy) && visit.completedBy === actor.userId;

const isAdminOwned = ({visit}) =>
  visit.assignee?.role === SYSTEM_ROLES.admin.value;

// Edit / cancel. A case manager only reaches a visit through the scope clause
// (assigned, created, or caseload), so the role alone is enough here. Once a
// visit sits with an admin (escalated or assigned), only admins manage it.
module.exports.canManageVisit = ({actor, visit}) =>
  isAdmin({actor}) ||
  (!isAdminOwned({visit}) &&
    (isCreator({actor, visit}) || isCaseManager({actor})));

// PREVENT-772: reopen removed for now; uncomment to restore.
// // Reopen: admins, or a case manager unless the visit sits with an admin.
// module.exports.canReopenVisit = ({actor, visit}) =>
//   isAdmin({actor}) || (!isAdminOwned({visit}) && isCaseManager({actor}));

// Only the current assignee performs and files a visit.
module.exports.canFileVisit = ({actor, visit}) => isAssignee({actor, visit});

// An admin's own filing is final: nobody sits above the admin to review it,
// and an org often has a single admin, so it would otherwise never be approved.
module.exports.approvesOnFiling = ({actor}) => isAdmin({actor});

// Review: admins and case managers, never the person who filed it.
module.exports.canReviewVisit = ({actor, visit}) =>
  (isAdmin({actor}) || isCaseManager({actor})) && !isFiler({actor, visit});

module.exports.assertCanManageVisit = ({actor, visit}) => {
  if (!module.exports.canManageVisit({actor, visit}))
    throw SupervisoryVisitsErrorsFactories.forbiddenVisitActionErr();
};

// PREVENT-772: reopen removed for now; uncomment to restore.
// module.exports.assertCanReopenVisit = ({actor, visit}) => {
//   if (!module.exports.canReopenVisit({actor, visit}))
//     throw SupervisoryVisitsErrorsFactories.forbiddenVisitActionErr();
// };

module.exports.assertCanFileVisit = ({actor, visit}) => {
  if (!module.exports.canFileVisit({actor, visit}))
    throw SupervisoryVisitsErrorsFactories.forbiddenVisitActionErr();
};

module.exports.assertCanReviewVisit = ({actor, visit}) => {
  if (isFiler({actor, visit}))
    throw SupervisoryVisitsErrorsFactories.cannotReviewOwnFilingErr();

  if (!module.exports.canReviewVisit({actor, visit}))
    throw SupervisoryVisitsErrorsFactories.forbiddenVisitActionErr();
};

/**
 * The assignee must be a nurse, admin or case manager on the patient's care
 * team. Returns the member (with userId for notifications) or throws 422.
 */
module.exports.validateVisitAssignee = async ({
  assigneeUserOrganizationId,
  patientId,
  organizationId,
  tx,
}) => {
  const {success, members, error} = await resolveCareTeamMembers({
    userOrgIds: [assigneeUserOrganizationId],
    patientId,
    organizationId,
    roles: SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
    tx,
  });

  if (!success) throw error;
  if (!members[0])
    throw SupervisoryVisitsErrorsFactories.assigneeNotInCareTeamErr();

  return members[0];
};

/**
 * Every caregiver present must be an active caregiver of the patient.
 * Returns the members (with userIds for notifications) or throws 422.
 */
module.exports.validateCaregiversPresent = async ({
  caregiverUserOrganizationIds,
  patientId,
  organizationId,
  tx,
}) => {
  if (!caregiverUserOrganizationIds?.length) return [];

  const {success, members, missingIds, error} = await resolveCareTeamMembers({
    userOrgIds: caregiverUserOrganizationIds,
    patientId,
    organizationId,
    roles: SUPERVISORY_VISIT_CAREGIVER_ROLES,
    tx,
  });

  if (!success) throw error;
  if (missingIds.length)
    throw SupervisoryVisitsErrorsFactories.caregiverNotInCareTeamErr({
      missingIds,
    });

  return members;
};
