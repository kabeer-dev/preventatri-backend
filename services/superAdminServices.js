const {modelConstants} = require('../constants');

const {ORGANIZATION_ACTIONS} = require('../constants/organizationsConstants');
const {PrismaFactory, GeneralErrorsFactories} = require('../factories');
const {getCurrentDateTime} = require('../utils/dateUtils');

// The founding admin, shown on each row and emailed about a decision.
const ORGANIZATION_ADMIN_INCLUSION = {
  include: {
    creator: {
      select: {id: true, firstName: true, lastName: true, email: true},
    },
  },
};

/**
 * Platform-level organization management. Nothing here reads an organization's
 * own data: only its name, status and founding admin.
 *
 * Every query bypasses the request's organization scope, because the super
 * admin acts across organizations.
 */
module.exports = class SuperAdminServices {
  static async listOrganizations({
    status = null,
    search = null,
    excludeOrganizationId = null,
    skip = 0,
    take = 25,
  }) {
    try {
      const query = {};

      if (excludeOrganizationId) query.id = {not: excludeOrganizationId};

      if (status) query.status = status;

      if (search) {
        query.organizationName = {contains: search, mode: 'insensitive'};
      }

      const {success, docs, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.ORGANIZATION,
        query,
        options: {
          bypassExtraQueries: true,
          skip,
          take,
          sort: [{createdAt: 'desc'}, {id: 'asc'}],
        },
        fieldsInclusion: ORGANIZATION_ADMIN_INCLUSION,
      });

      if (!success) return {success: false, docs: [], count: 0, error};

      const {
        success: countSuccess,
        count,
        error: countError,
      } = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.ORGANIZATION,
        query,
        options: {bypassExtraQueries: true},
      });

      // A failed count must not pass as an empty page.
      if (!countSuccess) {
        return {success: false, docs: [], count: 0, error: countError};
      }

      return {success: true, docs, count, error: null};
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }

  /**
   * Moves an organization to the status the action leads to. The update only
   * matches an organization still in the status the action starts from, so two
   * decisions at once cannot both apply.
   *
   * @returns {Promise<{success: boolean, organization: Object|null, error: Error|null}>}
   */
  static async changeOrganizationStatus({
    id,
    action,
    reason = null,
    actorOrganizationId,
  }) {
    try {
      // The super admin's own organization is never managed from here.
      if (id === actorOrganizationId) {
        return {
          success: false,
          organization: null,
          error: GeneralErrorsFactories.forbiddenErr({
            customMessage: 'You cannot change your own organization.',
          }),
        };
      }

      const {from, to} = ORGANIZATION_ACTIONS[action];

      const {
        success: findSuccess,
        doc: organization,
        error: findError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.ORGANIZATION,
        query: {id},
        options: {bypassExtraQueries: true},
        fieldsInclusion: ORGANIZATION_ADMIN_INCLUSION,
      });

      if (!findSuccess) {
        return {success: false, organization: null, error: findError};
      }

      if (!organization) {
        return {
          success: false,
          organization: null,
          error: GeneralErrorsFactories.notFoundErr({
            customMessage: 'Organization not found',
          }),
        };
      }

      if (organization.status !== from) {
        return {
          success: false,
          organization: null,
          error: GeneralErrorsFactories.conflictErr({
            customMessage: `Only a ${from} organization can be ${action}d. This one is ${organization.status}.`,
          }),
        };
      }

      const {
        success: updateSuccess,
        responseObj,
        error: updateError,
      } = await PrismaFactory.updateMany({
        model: modelConstants.MODELS.ORGANIZATION,
        query: {id, status: from},
        data: {
          status: to,
          statusChangedAt: getCurrentDateTime(),
          statusReason: reason || null,
        },
        options: {bypassExtraQueries: true},
      });

      if (!updateSuccess) {
        return {success: false, organization: null, error: updateError};
      }

      if (!responseObj?.count) {
        return {
          success: false,
          organization: null,
          error: GeneralErrorsFactories.conflictErr({
            customMessage:
              'This organization was just changed by someone else.',
          }),
        };
      }

      return {
        success: true,
        organization: Object.assign({}, organization, {
          status: to,
          statusReason: reason || null,
        }),
        error: null,
      };
    } catch (error) {
      return {success: false, organization: null, error};
    }
  }
};
