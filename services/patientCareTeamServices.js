const {modelConstants} = require('../constants');

const CaseManagersServices = require('./caseManagersServices');
const PatientsServices = require('./patientsServices');
const UsersServices = require('./usersServices');
const {ENTITY_STATUSES} = require('../constants/generalConstant');
const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');

const {
  WORK_ITEM_CARE_TEAM_ROLES: FOLLOW_UP_TASK_CARE_TEAM_ROLES,
} = require('../constants/workItemConstants');

const {PrismaFactory, GeneralErrorsFactories} = require('../factories');

const {
  ensurePatientAssignedToCaseManager,
} = require('../utils/caseManagerPatientAccessUtils');

const {MODELS} = modelConstants;

const PERSON_SELECT = {id: true, firstName: true, lastName: true, email: true};

// Picker order: the people closest to the patient first.
const CARE_TEAM_ROLE_ORDER = [
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.patientPrimaryNurse.value,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.patientSecondaryNurse.value,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.caseManager.value,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.regionDefaultNurse.value,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.caregiver.value,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES.admin.value,
];

const fail = ({error}) => ({success: false, members: [], error});

/**
 * The people a follow-up task for a patient may be assigned to: the patient's
 * primary/secondary nurse, the region's default nurses, the patient's case
 * manager, caregivers with a live checklist assignment and every org admin. Mirrors the
 * resolvers the escalation cascade already trusts.
 */
module.exports = class PatientCareTeamServices {
  // nurseProfileId -> care-team role, first reason wins (patient before region).
  static async collectNurseUserIds({patient, organizationId, tx}) {
    const roleByProfileId = new Map();

    const addProfile = ({nurseProfileId, careTeamRole}) => {
      if (nurseProfileId && !roleByProfileId.has(nurseProfileId))
        roleByProfileId.set(nurseProfileId, careTeamRole);
    };

    addProfile({
      nurseProfileId: patient.primaryNurseProfileId,
      careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.patientPrimaryNurse.value,
    });
    addProfile({
      nurseProfileId: patient.secondaryNurseProfileId,
      careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.patientSecondaryNurse.value,
    });

    const regionId = patient.county?.regionId || null;

    if (regionId) {
      const {success, docs, error} = await PrismaFactory.find({
        model: MODELS.REGION_DEFAULT_NURSE,
        query: {
          regionId,
          organizationId,
          nurseRegionRole: {
            in: [NURSE_REGION_ROLES.PRIMARY, NURSE_REGION_ROLES.SECONDARY],
          },
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!success) return {success: false, error};

      for (const regionNurse of docs) {
        addProfile({
          nurseProfileId: regionNurse.nurseProfileId,
          careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.regionDefaultNurse.value,
        });
      }
    }

    if (roleByProfileId.size === 0) return {success: true, entries: []};

    // Same eligibility bar as the escalation resolvers: ACTIVE, verified.
    const {success, docs, error} = await PrismaFactory.find({
      model: MODELS.NURSE_PROFILE,
      query: {
        id: {in: Array.from(roleByProfileId.keys())},
        organizationId,
        status: ENTITY_STATUSES.ACTIVE.value,
        user: {isVerified: true},
      },
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!success) return {success: false, error};

    return {
      success: true,
      entries: docs.map((profile) => ({
        userId: profile.userId,
        careTeamRole: roleByProfileId.get(profile.id),
      })),
    };
  }

  // Live checklist assignments, not caregiver_patients: that link outlives the
  // assignments, and the caregiver could not open the patient they were sent to.
  static async collectCaregiverUserIds({patientId, organizationId, tx}) {
    const {success, userIds, error} =
      await PatientsServices.getLiveCaregiverUserIds({
        patientId,
        organizationId,
        tx,
      });

    if (!success) return {success: false, error};

    return {
      success: true,
      entries: userIds.map((userId) => ({
        userId,
        careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.caregiver.value,
      })),
    };
  }

  /**
   * @returns {Promise<{success, members: [{userOrgId, userId, role,
   *   careTeamRole, firstName, lastName, email}], error}>}
   */
  static async resolveCareTeam({patientId, organizationId, tx}) {
    try {
      const {
        success: patientSuccess,
        doc: patient,
        error: patientError,
      } = await PrismaFactory.findOne({
        model: MODELS.PATIENT,
        query: {id: patientId, organizationId},
        fieldsInclusion: {include: {county: {select: {regionId: true}}}},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!patientSuccess) return fail({error: patientError});
      if (!patient) return {success: true, members: []};

      const [nurses, caseManager, caregivers, admins] = await Promise.all([
        this.collectNurseUserIds({patient, organizationId, tx}),
        CaseManagersServices.resolveCaseManagerForPatient({
          patientId,
          organizationId,
          tx,
        }),
        this.collectCaregiverUserIds({patientId, organizationId, tx}),
        UsersServices.getAdminUserIdsForOrganization({organizationId, tx}),
      ]);

      const failed = [nurses, caseManager, caregivers, admins].find(
        ({success}) => !success
      );
      if (failed) return fail({error: failed.error});

      // userId -> care-team role; insertion order = priority order above.
      const roleByUserId = new Map();

      const addUser = ({userId, careTeamRole}) => {
        if (userId && !roleByUserId.has(userId))
          roleByUserId.set(userId, careTeamRole);
      };

      for (const entry of nurses.entries) addUser(entry);
      addUser({
        userId: caseManager.userId,
        careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.caseManager.value,
      });
      for (const entry of caregivers.entries) addUser(entry);
      for (const userId of admins.userIds)
        addUser({
          userId,
          careTeamRole: FOLLOW_UP_TASK_CARE_TEAM_ROLES.admin.value,
        });

      if (roleByUserId.size === 0) return {success: true, members: []};

      const {
        success: userOrgsSuccess,
        docs: userOrgs,
        error: userOrgsError,
      } = await PrismaFactory.find({
        model: MODELS.USER_ORGANIZATION,
        query: {
          userId: {in: Array.from(roleByUserId.keys())},
          organizationId,
          isActive: true,
        },
        fieldsInclusion: {include: {user: {select: PERSON_SELECT}}},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!userOrgsSuccess) return fail({error: userOrgsError});

      const members = userOrgs
        .map((userOrg) => ({
          userOrgId: userOrg.id,
          userId: userOrg.userId,
          role: userOrg.role,
          careTeamRole: roleByUserId.get(userOrg.userId),
          firstName: userOrg.user?.firstName || null,
          lastName: userOrg.user?.lastName || null,
          email: userOrg.user?.email || null,
        }))
        .sort(
          (a, b) =>
            CARE_TEAM_ROLE_ORDER.indexOf(a.careTeamRole) -
              CARE_TEAM_ROLE_ORDER.indexOf(b.careTeamRole) ||
            `${a.lastName} ${a.firstName}`.localeCompare(
              `${b.lastName} ${b.firstName}`
            )
        );

      return {success: true, members};
    } catch (error) {
      return fail({error});
    }
  }

  /**
   * The care team as an assignee picker for `actor`: the patient must exist
   * and (for case managers) sit in their caseload. `roles` narrows the list
   * to the system roles a given work item may be assigned to.
   */
  static async listAssigneesForActor({actor, patientId, roles = null}) {
    const {doc: patient} = await PrismaFactory.findOne({
      model: MODELS.PATIENT,
      query: {id: patientId, organizationId: actor.organizationId},
      options: {bypassExtraQueries: true},
    });

    if (!patient)
      throw GeneralErrorsFactories.badRequestErr({
        customMessage: 'Patient not found',
      });

    await ensurePatientAssignedToCaseManager({
      caseManagerProfileId: actor.caseManagerProfileId,
      patientId,
    });

    const {success, members, error} = await this.resolveCareTeam({
      patientId,
      organizationId: actor.organizationId,
    });

    if (!success) throw error;

    return roles
      ? members.filter((member) => roles.includes(member.role))
      : members;
  }

  /**
   * The care-team members behind a set of UserOrganization ids, optionally
   * limited to `roles`. One care-team resolution serves every id, so
   * validating an assignee and a list of caregivers costs one lookup.
   *
   * @returns {Promise<{success, members, missingIds, error}>}
   */
  static async resolveCareTeamMembers({
    userOrgIds,
    patientId,
    organizationId,
    roles = null,
    tx,
  }) {
    const {success, members, error} = await this.resolveCareTeam({
      patientId,
      organizationId,
      tx,
    });

    if (!success) return {success: false, members: [], missingIds: [], error};

    const eligible = roles
      ? members.filter((member) => roles.includes(member.role))
      : members;

    const byUserOrgId = new Map(
      eligible.map((member) => [member.userOrgId, member])
    );

    const wanted = Array.from(new Set(userOrgIds || []));

    return {
      success: true,
      members: wanted.map((id) => byUserOrgId.get(id)).filter(Boolean),
      missingIds: wanted.filter((id) => !byUserOrgId.has(id)),
    };
  }

  /** The care-team member for a UserOrganization id, or null. */
  static async resolveCareTeamMember({
    userOrgId,
    patientId,
    organizationId,
    tx,
  }) {
    const {success, members, error} = await this.resolveCareTeam({
      patientId,
      organizationId,
      tx,
    });

    if (!success) return {success: false, member: null, error};

    return {
      success: true,
      member: members.find((member) => member.userOrgId === userOrgId) || null,
    };
  }
};
