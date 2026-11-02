const {modelConstants} = require('../constants');

const {OPEN_ESCALATION_STATUSES} = require('../constants/escalationConstants');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

const {PrismaFactory} = require('../factories');

const logger = require('../middleware/loggerMiddleware');

const {buildSlaBreachQuery} = require('../utils/escalationUtils');

module.exports = class TriageEngineServices {
  /**
   * Triage-engine dashboard stats:
   * - activeRedFlags / activeYellowFlags: current count of ACTIVE escalations by
   *   flag colour (live workload; not time-bound). Colour comes from the related
   *   submission flag.
   * - greenFlags: total GREEN submission flags created within the supplied date
   *   window (GREEN flags never escalate, so they're counted off the flag table).
   *
   * - slaBreaches: step deadlines missed in the last 30 days, one per step.
   *
   * Org-scoped via the explicit organizationId with bypassExtraQueries.
   *
   * @returns {Promise<{success, activeRedFlags, activeYellowFlags, greenFlags, slaBreaches, error}>}
   */
  /**
   * Paginated triage-engine alerts: submission flags (all colours), newest
   * first, plus the org-wide count for pagination. Raw enum values only —
   * the frontend maps flag/type to titles and colours.
   *
   * @returns {Promise<{success, alerts, count, error}>}
   */
  static async getRecentAlerts({organizationId, flag, regionIds, skip, take}) {
    try {
      const query = {organizationId};
      if (flag) query.flag = flag;
      if (regionIds?.length) {
        query.patient = {county: {regionId: {in: regionIds}}};
      }

      const [flagsResult, countResult] = await Promise.all([
        PrismaFactory.find({
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query,
          options: {
            // Secondary `id` key makes paging deterministic when several flags
            // share the same createdAt — without it, equal-timestamp rows can
            // shift between pages and cause duplicates or omissions.
            sort: [{createdAt: 'desc'}, {id: 'desc'}],
            skip,
            take,
            bypassExtraQueries: true,
          },

          // `type` (AUTO/MANUAL) and `submissionId` are not in the model's
          // default fields but the frontend needs them: `type` distinguishes
          // caregiver-submitted vs triage-engine-captured alerts, and
          // `submissionId` is the target when navigating an AUTO alert to its
          // submission detail page (MANUAL alerts have no submission). The
          // escalation's acknowledgedAt stops the alert's timer once accepted;
          // it is flattened to acceptedAt below.
          fieldsInclusion: {
            include: {
              type: true,
              submissionId: true,
              escalation: {select: {acknowledgedAt: true}},
            },
          },
        }),
        PrismaFactory.countDocuments({
          model: modelConstants.MODELS.SUBMISSION_FLAG,
          query,
          options: {bypassExtraQueries: true},
        }),
      ]);

      return {
        success: flagsResult.success && countResult.success,
        alerts: flagsResult.success
          ? flagsResult.docs.map(({escalation, ...alert}) =>
              Object.assign(alert, {
                acceptedAt: escalation?.acknowledgedAt || null,
              })
            )
          : [],
        count: countResult.success ? countResult.count : 0,
        error: flagsResult.error || countResult.error,
      };
    } catch (error) {
      logger.error(
        `[TriageEngine] failed to fetch recent alerts: ${error?.message || error}`
      );

      return {success: false, alerts: [], count: 0, error};
    }
  }

  static async getFlagStats({organizationId, greenStartDate, greenEndDate}) {
    try {
      const buildActiveQuery = ({flag}) => ({
        organizationId,
        status: {in: OPEN_ESCALATION_STATUSES},
        submissionFlag: {flag},
      });

      // The three counts are independent — run them concurrently.
      const [redResult, yellowResult, greenResult, slaResult] =
        await Promise.all([
          PrismaFactory.countDocuments({
            model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
            query: buildActiveQuery({flag: RISK_SCORE_THRESHOLDS.RED.flag}),
            options: {bypassExtraQueries: true},
          }),
          PrismaFactory.countDocuments({
            model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
            query: buildActiveQuery({flag: RISK_SCORE_THRESHOLDS.YELLOW.flag}),
            options: {bypassExtraQueries: true},
          }),
          PrismaFactory.countDocuments({
            model: modelConstants.MODELS.SUBMISSION_FLAG,
            query: {
              organizationId,
              flag: RISK_SCORE_THRESHOLDS.GREEN.flag,
              createdAt: {gte: greenStartDate, lte: greenEndDate},
            },
            options: {bypassExtraQueries: true},
          }),
          PrismaFactory.countDocuments({
            model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION_EVENT,
            query: buildSlaBreachQuery({organizationId}),
            options: {bypassExtraQueries: true},
          }),
        ]);

      return {
        success:
          redResult.success &&
          yellowResult.success &&
          greenResult.success &&
          slaResult.success,
        activeRedFlags: redResult.success ? redResult.count : 0,
        activeYellowFlags: yellowResult.success ? yellowResult.count : 0,
        greenFlags: greenResult.success ? greenResult.count : 0,
        slaBreaches: slaResult.success ? slaResult.count : 0,
        error:
          redResult.error ||
          yellowResult.error ||
          greenResult.error ||
          slaResult.error,
      };
    } catch (error) {
      logger.error(
        `[TriageEngine] failed to compute flag stats: ${error?.message || error}`
      );

      return {
        success: false,
        activeRedFlags: 0,
        activeYellowFlags: 0,
        greenFlags: 0,
        slaBreaches: 0,
        error,
      };
    }
  }
};
