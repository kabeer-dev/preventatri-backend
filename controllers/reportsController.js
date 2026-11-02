const {
  REPORTS_SUCCESS_TYPES,
} = require('../constants/responses/success/reports');

const {
  GeneralErrorsFactories,
  ReportsResponsesFactories,
} = require('../factories');
const {buildReportContext} = require('../helpers/reportContextHelpers');

const {
  ReportsCoverageServices,
  ReportsHighRiskPatientsServices,
  ReportsOverviewServices,
  ReportsRegionsServices,
  ReportsWorkItemsServices,
} = require('../services');

const failWith = ({message}) =>
  GeneralErrorsFactories.internalErr({customMessage: message});

const withRange = ({context, body}) =>
  Object.assign(
    {range: ReportsResponsesFactories.serializeRange({window: context.window})},
    body
  );

module.exports = class ReportsController {
  static async getOverview(req, res, next) {
    const context = await buildReportContext({req});
    const {success, doc} = await ReportsOverviewServices.getOverview({context});

    if (!success) throw failWith({message: 'Failed to fetch report overview'});

    return ReportsResponsesFactories.reportRetrieved({
      type: REPORTS_SUCCESS_TYPES.overviewRetrieved.value,
      message: 'Report overview retrieved successfully',
      body: withRange({context, body: doc}),
    });
  }

  static async getRegions(req, res, next) {
    const context = await buildReportContext({req});
    const {success, doc} = await ReportsRegionsServices.getRegions({context});

    if (!success) throw failWith({message: 'Failed to fetch region scorecard'});

    return ReportsResponsesFactories.reportRetrieved({
      type: REPORTS_SUCCESS_TYPES.regionsRetrieved.value,
      message: 'Region scorecard retrieved successfully',
      body: withRange({context, body: doc}),
    });
  }

  static async getHighRiskPatients(req, res, next) {
    const context = await buildReportContext({req});

    const {success, doc} = await ReportsHighRiskPatientsServices.getPatients({
      context,
    });

    if (!success)
      throw failWith({message: 'Failed to fetch high-risk patients'});

    return ReportsResponsesFactories.reportRetrieved({
      type: REPORTS_SUCCESS_TYPES.highRiskPatientsRetrieved.value,
      message: 'High-risk patients retrieved successfully',
      body: withRange({context, body: doc}),
    });
  }

  static async getWorkItems(req, res, next) {
    const context = await buildReportContext({req});

    const {success, doc} = await ReportsWorkItemsServices.getWorkItems({
      context,
    });

    if (!success)
      throw failWith({message: 'Failed to fetch work items report'});

    return ReportsResponsesFactories.reportRetrieved({
      type: REPORTS_SUCCESS_TYPES.workItemsRetrieved.value,
      message: 'Work items report retrieved successfully',
      body: withRange({context, body: doc}),
    });
  }

  // Live figures: no period, so no range.
  static async getCoverage(req, res, next) {
    const context = await buildReportContext({req});
    const {success, doc} = await ReportsCoverageServices.getCoverage({context});

    if (!success) throw failWith({message: 'Failed to fetch coverage gaps'});

    return ReportsResponsesFactories.reportRetrieved({
      type: REPORTS_SUCCESS_TYPES.coverageRetrieved.value,
      message: 'Coverage gaps retrieved successfully',
      body: doc,
    });
  }
};
