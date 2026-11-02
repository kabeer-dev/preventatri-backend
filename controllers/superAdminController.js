const {
  ORGANIZATION_ACTIONS_WITH_REASON,
} = require('../constants/organizationsConstants');
const {GeneralResponsesFactories} = require('../factories');
const logger = require('../middleware/loggerMiddleware');
const SuperAdminServices = require('../services/superAdminServices');
const actions = require('../utils/actions');
const {getListParams, getLocaleFromCookie} = require('../utils/general');

/**
 * Tells the organization's founding admin about the decision. The decision is
 * already saved, so a failed email is logged and never undoes it.
 */
const notifyOrganizationAdmin = async ({req, organization, action, reason}) => {
  try {
    if (!organization.creator?.email) return;

    await actions.users.organizationDecision({
      user: organization.creator,
      locale: getLocaleFromCookie({req}),
      organizationName: organization.organizationName,
      action,
      reason,
    });
  } catch (error) {
    logger.error(
      `[SuperAdmin] failed to email the admin of organization ${organization.id}: ${error?.message || error}`
    );
  }
};

/** Applies one decision to the organization in the path and tells its admin. */
const decideOrganization = async ({req, action}) => {
  const reason = ORGANIZATION_ACTIONS_WITH_REASON.includes(action)
    ? req.body?.reason || null
    : null;

  const {success, organization, error} =
    await SuperAdminServices.changeOrganizationStatus({
      id: req.params.id,
      action,
      reason,
      actorOrganizationId:
        req.extra.jwtToken.user.currentActiveOrganization.organizationId,
    });

  if (!success) throw error;

  await notifyOrganizationAdmin({req, organization, action, reason});

  return GeneralResponsesFactories.dataUpdatedSuccessfully({
    data: {
      id: organization.id,
      status: organization.status,
      statusReason: organization.statusReason,
    },
    key: 'organization',
  });
};

/**
 * Platform-level organization management. Reachable by the super admin only
 * (superAdminMiddleware); it never reads an organization's own data.
 */
module.exports = class SuperAdminController {
  /**
   * List organizations with their status and founding admin
   * GET /super-admin/organizations
   */
  static async listOrganizations(req, res, next) {
    const {page, limit, skip, search} = getListParams({req});
    const {status} = req.query;

    const actorOrganizationId =
      req.extra.jwtToken.user.currentActiveOrganization.organizationId;

    const {success, docs, count, error} =
      await SuperAdminServices.listOrganizations({
        status,
        search,
        excludeOrganizationId: actorOrganizationId,
        skip,
        take: limit,
      });

    if (!success) throw error;

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: {
        organizations: docs,
        meta: {page, limit, total: count},
      },
      key: 'result',
    });
  }

  /** POST /super-admin/organizations/:id/approve */
  static async approveOrganization(req, res, next) {
    return decideOrganization({req, action: 'approve'});
  }

  /** POST /super-admin/organizations/:id/reject */
  static async rejectOrganization(req, res, next) {
    return decideOrganization({req, action: 'reject'});
  }

  /** POST /super-admin/organizations/:id/suspend */
  static async suspendOrganization(req, res, next) {
    return decideOrganization({req, action: 'suspend'});
  }

  /** POST /super-admin/organizations/:id/reactivate */
  static async reactivateOrganization(req, res, next) {
    return decideOrganization({req, action: 'reactivate'});
  }
};
