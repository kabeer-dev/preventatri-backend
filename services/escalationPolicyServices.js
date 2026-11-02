const {errorsConstants, modelConstants} = require('../constants');

const {ESCALATION_POLICY_FLAGS} = require('../constants/escalationConstants');

const {SORT_ORDERS} = require('../constants/generalConstant');
const {PrismaFactory} = require('../factories');

const logger = require('../middleware/loggerMiddleware');

const {
  formatPolicySettings,
  getDefaultPolicySteps,
  isSameSteps,
  isValidPolicySteps,
  normalizeStep,
} = require('../utils/escalationPolicyUtils');

module.exports = class EscalationPolicyServices {
  /**
   * Give an organization version 1 of the RED and YELLOW policies with the
   * built-in flow (primary nurse → secondary nurse → case manager → admin).
   * Called when the organization is created, inside its transaction. Idempotent:
   * a color that already has version 1 is skipped.
   */
  static async createDefaultPolicies({organizationId, tx}) {
    const {success, error} = await PrismaFactory.create({
      model: modelConstants.MODELS.ESCALATION_POLICY,
      data: ESCALATION_POLICY_FLAGS.map((flag) => ({
        organizationId,
        flag,
        version: 1,
        steps: getDefaultPolicySteps({flag}),
      })),
      options: {bypassExtraQueries: true, skipDuplicates: true},
      tx,
    });

    return {success, error};
  }

  /** Highest-version policy row for an organization + flag color, or null. */
  static async findLatestPolicy({organizationId, flag}) {
    const {success, docs, error} = await PrismaFactory.find({
      model: modelConstants.MODELS.ESCALATION_POLICY,
      query: {organizationId, flag},
      options: {
        bypassExtraQueries: true,
        take: 1,
        sort: {version: SORT_ORDERS.desc.value},
      },
    });

    return {success, policy: docs?.[0] || null, error};
  }

  /**
   * Highest-version policy row for an organization + flag color, creating
   * version 1 from the built-in default when there is none → {success, policy, error}.
   *
   * Organizations get version 1 when they are created (createDefaultPolicies);
   * this is the safety net for one that somehow has none, so no flag is ever
   * left without a flow. Two concurrent first uses race on the
   * (organizationId, flag, version) unique key: the loser's insert fails and it
   * re-reads the winner's row.
   */
  static async findOrCreateLatestPolicy({organizationId, flag}) {
    const {
      success: found,
      policy: latest,
      error: findError,
    } = await this.findLatestPolicy({organizationId, flag});

    if (!found) {
      return {success: false, error: findError};
    }

    if (latest) {
      return {success: true, policy: latest};
    }

    const {doc: created} = await PrismaFactory.create({
      model: modelConstants.MODELS.ESCALATION_POLICY,
      data: {
        organizationId,
        flag,
        version: 1,
        steps: getDefaultPolicySteps({flag}),
      },
      options: {bypassExtraQueries: true},
    });

    if (created) {
      return {success: true, policy: created};
    }

    // Insert lost the race (or failed) — whoever won wrote version 1.
    const {
      success: reFound,
      policy: reRead,
      error: reReadError,
    } = await this.findLatestPolicy({organizationId, flag});

    if (!reFound || !reRead) {
      return {
        success: false,
        error:
          reReadError ||
          new Error(
            `Failed to create default ${flag} escalation policy for organization ${organizationId}`
          ),
      };
    }

    return {success: true, policy: reRead};
  }

  /**
   * The policy a new escalation should follow → {success, policy: {id, steps}, error}.
   *
   * The active policy is the highest version for the organization + flag color
   * (see findOrCreateLatestPolicy).
   *
   * A stored policy that fails validation is not followed — the escalation runs
   * on the built-in default instead (policy.id null) and the bad row is logged,
   * since an unusable policy must never leave a flag unrouted.
   */
  static async getActivePolicy({organizationId, flag}) {
    const defaultSteps = getDefaultPolicySteps({flag});

    if (!defaultSteps) {
      return {
        success: false,
        error: new Error(`Flag color ${flag} has no escalation policy`),
      };
    }

    try {
      const {
        success: found,
        policy,
        error: findError,
      } = await this.findOrCreateLatestPolicy({organizationId, flag});

      if (!found) {
        return {success: false, error: findError};
      }

      if (!isValidPolicySteps({steps: policy.steps})) {
        logger.error(
          `[EscalationPolicy] policy ${policy.id} (${flag} v${policy.version}) for organization ${organizationId} has invalid steps — using the built-in default`
        );

        return {success: true, policy: {id: null, steps: defaultSteps}};
      }

      return {success: true, policy: {id: policy.id, steps: policy.steps}};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * The organization's current RED and YELLOW policies, as the settings screen
   * shows them → {success, policies: [{flag, version, steps, updatedAt, updatedBy}], error}.
   *
   * `steps` is what new escalations will actually follow: a stored version that
   * fails validation reports the built-in default, same as getActivePolicy.
   */
  static async getPolicySettings({organizationId}) {
    try {
      const results = await Promise.all(
        ESCALATION_POLICY_FLAGS.map((flag) =>
          this.findOrCreateLatestPolicy({organizationId, flag})
        )
      );

      const failed = results.find(({success}) => !success);

      if (failed) {
        return {success: false, error: failed.error};
      }

      const policies = results.map(({policy}) =>
        formatPolicySettings({policy})
      );

      return {success: true, policies};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Save `steps` as the next version of the organization's policy for `flag`
   * → {success, policy, isConflict, error}. Rows are immutable: escalations
   * already running stay on the version they pinned, and only escalations
   * started after this call follow the new one.
   *
   * `version` is the version the admin loaded and edited. If a newer one has
   * been saved since, the save is refused with isConflict — otherwise it would
   * silently discard the other admin's change. Two admins saving the same
   * version at the same instant race on the (organizationId, flag, version)
   * unique key, and the loser gets isConflict too.
   *
   * Saving steps identical to the current version is a no-op (no new version).
   */
  static async updatePolicy({organizationId, flag, steps, version, userId}) {
    try {
      const {
        success: found,
        policy: current,
        error: findError,
      } = await this.findOrCreateLatestPolicy({organizationId, flag});

      if (!found) {
        return {success: false, error: findError};
      }

      if (current.version !== version) {
        return {success: false, isConflict: true};
      }

      if (isSameSteps({a: current.steps, b: steps})) {
        return {success: true, policy: formatPolicySettings({policy: current})};
      }

      const {doc: created, error: createError} = await PrismaFactory.create({
        model: modelConstants.MODELS.ESCALATION_POLICY,
        data: {
          organizationId,
          flag,
          version: current.version + 1,
          steps: steps.map(normalizeStep),
          createdBy: userId,
        },
        options: {bypassExtraQueries: true},
      });

      if (!created) {
        return {
          success: false,

          // Unique constraint violation — another version was saved first.
          isConflict:
            createError?.code === errorsConstants.PRISMA_DUPLICATION_ERROR_CODE,
          error: createError,
        };
      }

      return {success: true, policy: formatPolicySettings({policy: created})};
    } catch (error) {
      return {success: false, error};
    }
  }
};
