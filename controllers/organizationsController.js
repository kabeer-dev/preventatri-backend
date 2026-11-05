const {AVAILABLE_TIME_ZONES} = require('../constants/organizationsConstants');

const {
  GeneralErrorsFactories,
  GeneralResponsesFactories,
  HhaExchangeErrorsFactories,
} = require('../factories');

const {
  OrganizationsServices,
  EscalationPolicyServices,
  HhaCredentialsServices,
  HhaExchangeServices,
} = require('../services');

// What a screen may know about the organization's HHAeXchange connection. The
// secret and key are never part of it.
const toHhaConnection = ({credential}) => ({
  isConnected: Boolean(credential?.isConnected),
  appName: credential?.appName || null,
  lastVerifiedAt: credential?.lastVerifiedAt || null,
  lastError: credential?.lastError || null,
});

module.exports = class OrganizationsController {
  /**
   * Whether the organization is connected to HHAeXchange. The secret and key
   * are never returned.
   * GET /organizations/hha-credentials
   */
  static async getHhaCredentials(req, res, next) {
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success, doc, error} = await HhaCredentialsServices.getConnection({
      organizationId,
    });

    if (!success) throw error;

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: toHhaConnection({credential: doc}),
      key: 'hhaCredentials',
    });
  }

  /**
   * Connect the organization to HHAeXchange. The credentials are checked with
   * HHAeXchange first and saved only if it accepts them, so a wrong entry never
   * replaces a working connection.
   * PUT /organizations/hha-credentials
   */
  static async saveHhaCredentials(req, res, next) {
    const {appName, appSecret, appKey} = req.body;

    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success: isAccepted, isUnreachable} =
      await HhaExchangeServices.verifyCredentials({
        credentials: {appName, appSecret, appKey},
      });

    // An outage is not a refusal: the admin is not told the credentials are wrong.
    if (isUnreachable) throw HhaExchangeErrorsFactories.unreachableErr();

    if (!isAccepted) throw HhaExchangeErrorsFactories.credentialsRejectedErr();

    const {success, error} = await HhaCredentialsServices.saveCredentials({
      organizationId,
      appName,
      appSecret,
      appKey,
      connectedByUserId: req.extra.jwtToken.user.id,
      isConnected: true,
    });

    if (!success) throw error;

    // The audit entry is the organization row, which does not change, so say
    // what was connected.
    if (req.extra.audit) {
      req.extra.audit.afterDetails = {appName, isConnected: true};
    }

    const {
      success: isRead,
      doc,
      error: readError,
    } = await HhaCredentialsServices.getConnection({organizationId});

    if (!isRead) throw readError;

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: toHhaConnection({credential: doc}),
      key: 'hhaCredentials',
    });
  }

  /**
   * Disconnect the organization from HHAeXchange. Its stored credentials are
   * removed and the sync stops for it.
   * DELETE /organizations/hha-credentials
   */
  static async disconnectHhaCredentials(req, res, next) {
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success, error} = await HhaCredentialsServices.disconnect({
      organizationId,
    });

    if (!success) throw error;

    return GeneralResponsesFactories.dataDeletedSuccessfully({
      data: toHhaConnection({credential: null}),
      key: 'hhaCredentials',
    });
  }

  /**
   * Get the current organization's working hours
   * GET /organizations/working-hours
   */
  static async getWorkingHours(req, res, next) {
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success, doc: organization} =
      await OrganizationsServices.getOrganizationById({id: organizationId});

    if (!success || !organization) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Organization not found',
      });
    }

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: organization.workingHours,
      key: 'workingHours',
    });
  }

  /**
   * Update the current organization's working hours
   * PATCH /organizations/working-hours
   * Per-day replace — only the day keys provided are overwritten, other days
   * are left untouched.
   */
  static async updateWorkingHours(req, res, next) {
    const {workingHours: workingHoursUpdate} = req.body;
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success: getSuccess, doc: organization} =
      await OrganizationsServices.getOrganizationById({id: organizationId});

    if (!getSuccess || !organization) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Organization not found',
      });
    }

    const {
      success,
      doc: updatedOrganization,
      error,
    } = await OrganizationsServices.updateOrganizationWorkingHours({
      id: organizationId,
      currentWorkingHours: organization.workingHours,
      workingHoursUpdate,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update working hours',
      });
    }

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: updatedOrganization.workingHours,
      key: 'workingHours',
    });
  }

  /**
   * Get the current organization's time zone
   * GET /organizations/time-zone
   */
  static async getTimeZone(req, res, next) {
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success, doc: organization} =
      await OrganizationsServices.getOrganizationById({id: organizationId});

    if (!success || !organization) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Organization not found',
      });
    }

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: AVAILABLE_TIME_ZONES[organization.timeZone.toLowerCase()],
      key: 'timeZone',
    });
  }

  /**
   * Update the current organization's time zone
   * PATCH /organizations/time-zone
   */
  static async updateTimeZone(req, res, next) {
    const {timeZone} = req.body;
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success: getSuccess, doc: organization} =
      await OrganizationsServices.getOrganizationById({id: organizationId});

    if (!getSuccess || !organization) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Organization not found',
      });
    }

    const {
      success,
      doc: updatedOrganization,
      error,
    } = await OrganizationsServices.updateOrganizationTimeZone({
      id: organizationId,
      timeZone,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update time zone',
      });
    }

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: AVAILABLE_TIME_ZONES[updatedOrganization.timeZone.toLowerCase()],
      key: 'timeZone',
    });
  }

  /**
   * Get the current organization's RED and YELLOW escalation policies
   * GET /organizations/escalation-policies
   */
  static async getEscalationPolicies(req, res, next) {
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    const {success, policies} =
      await EscalationPolicyServices.getPolicySettings({organizationId});

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch escalation policies',
      });
    }

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: policies,
      key: 'escalationPolicies',
    });
  }

  /**
   * Update the current organization's escalation policy for one flag color
   * PUT /organizations/escalation-policies/:flag
   * Saves a new policy version; escalations already running keep the version
   * they started on.
   */
  static async updateEscalationPolicy(req, res, next) {
    const {flag} = req.params;
    const {steps, version} = req.body;
    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;
    const userId = req.extra.jwtToken.user.id;

    const {success, policy, isConflict} =
      await EscalationPolicyServices.updatePolicy({
        organizationId,
        flag,
        steps,
        version,
        userId,
      });

    if (isConflict) {
      throw GeneralErrorsFactories.conflictErr({
        customMessage:
          'The escalation policy was changed by someone else. Reload it and try again.',
      });
    }

    if (!success) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to update escalation policy',
      });
    }

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: policy,
      key: 'escalationPolicy',
    });
  }
};
