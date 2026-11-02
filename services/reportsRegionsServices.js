const ALERTS_SQL = require('../constants/reports/alertsReportSql');
const ASSESSMENTS_SQL = require('../constants/reports/assessmentsReportSql');
const REGIONS_SQL = require('../constants/reports/regionsReportSql');
const SLA_SQL = require('../constants/reports/slaComplianceSql');
const WORK_SQL = require('../constants/reports/workItemsReportSql');
const {runReportQueries} = require('../helpers/reportQueryHelpers');

const {
  sumRows,
  toInt,
  toNullableNumber,
  toPercent,
} = require('../utils/reportMetricsUtils');
const {toPeriodWindow} = require('../utils/reportWindowUtils');

const byRegion = ({rows, regionId}) =>
  rows.filter((row) => (row.region_id || null) === regionId);

const scorecardRow = ({
  regionId,
  regionName,
  alertRows,
  patientRows,
  assessmentRows,
  overdueRows,
  slaRows,
}) => {
  const alerts = byRegion({rows: alertRows, regionId})[0] || {};
  const assessments = byRegion({rows: assessmentRows, regionId})[0] || {};
  const sla = byRegion({rows: slaRows, regionId})[0] || {};

  const activePatients = sumRows({
    rows: byRegion({rows: patientRows, regionId}),
    field: 'active_patients',
  });

  const raised = toInt({value: alerts.raised});
  const onTime = toInt({value: assessments.on_time});

  return {
    regionId,
    regionName,
    activePatients,
    alerts: raised,
    slaCompliancePct: toPercent({
      part: toInt({value: sla.within_sla}),
      total: toInt({value: sla.resolved_total}),
    }),
    medianResolveSeconds: toNullableNumber({
      value: alerts.median_resolve_seconds,
    }),
    medianAcceptSeconds: toNullableNumber({
      value: alerts.median_accept_seconds,
    }),
    assessmentsOnTimePct: toPercent({
      part: onTime,
      total:
        onTime +
        toInt({value: assessments.late}) +
        toInt({value: assessments.missed}),
    }),
    overdueNow: sumRows({
      rows: byRegion({rows: overdueRows, regionId}),
      field: 'count',
    }),
  };
};

const hasData = ({row}) =>
  Boolean(
    row.alerts ||
    row.activePatients ||
    row.overdueNow ||
    row.assessmentsOnTimePct !== null ||
    row.slaCompliancePct !== null
  );

// One row per active region, plus inactive ones that hold records, plus
// "Unassigned region" for All regions when it has alerts or patients.
const mergeRegionScorecard = ({
  regions,
  alertRows,
  patientRows,
  assessmentRows,
  overdueRows,
  slaRows,
  includeUnassigned,
}) => {
  const rows = regions
    .map((region) => ({
      isListed: region.is_listed !== false,
      row: scorecardRow({
        regionId: region.region_id,
        regionName: region.region_name,
        alertRows,
        patientRows,
        assessmentRows,
        overdueRows,
        slaRows,
      }),
    }))
    .filter(({isListed, row}) => isListed || hasData({row}))
    .map(({row}) => row);

  if (!includeUnassigned) return rows;

  const unassigned = scorecardRow({
    regionId: null,
    regionName: null,
    alertRows,
    patientRows,
    assessmentRows,
    overdueRows,
    slaRows,
  });

  return hasData({row: unassigned}) ? rows.concat([unassigned]) : rows;
};

module.exports = class ReportsRegionsServices {
  static mergeRegionScorecard({
    regions,
    alertRows,
    patientRows,
    assessmentRows,
    overdueRows,
    slaRows,
    includeUnassigned,
  }) {
    return mergeRegionScorecard({
      regions,
      alertRows,
      patientRows,
      assessmentRows,
      overdueRows,
      slaRows,
      includeUnassigned,
    });
  }

  // Query order: regions in scope, alerts by region, active patients,
  // assessments by region, overdue now, SLA by region.
  static async getRegions({context}) {
    try {
      const {organizationId, regionId, scope} = context;

      const period = toPeriodWindow({
        window: context.window,
        period: 'current',
      });

      const [
        regions,
        alertRows,
        patientRows,
        assessmentRows,
        overdueRows,
        slaRows,
      ] = await runReportQueries({
        queries: [
          REGIONS_SQL.REGIONS_IN_SCOPE_SQL({organizationId, regionId}),
          ALERTS_SQL.ALERTS_BY_REGION_SQL({organizationId, period, scope}),
          REGIONS_SQL.ACTIVE_PATIENTS_BY_REGION_SQL({organizationId, scope}),
          ASSESSMENTS_SQL.ASSESSMENTS_BY_REGION_SQL({
            organizationId,
            period,
            scope,
          }),
          WORK_SQL.OVERDUE_NOW_BY_REGION_SQL({organizationId, scope}),
          SLA_SQL.SLA_COMPLIANCE_BY_REGION_SQL({organizationId, period, scope}),
        ],
      });

      return {
        success: true,
        doc: {
          regions: mergeRegionScorecard({
            regions,
            alertRows,
            patientRows,
            assessmentRows,
            overdueRows,
            slaRows,
            includeUnassigned: !regionId,
          }),
        },
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
