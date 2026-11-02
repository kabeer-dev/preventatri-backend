const ALERTS_SQL = require('../constants/reports/alertsReportSql');
const ASSESSMENTS_SQL = require('../constants/reports/assessmentsReportSql');
const SLA_SQL = require('../constants/reports/slaComplianceSql');
const WORK_SQL = require('../constants/reports/workItemsReportSql');
const {runReportQueries} = require('../helpers/reportQueryHelpers');

const {
  sumRows,
  toInt,
  toKpi,
  toNullableNumber,
  toPercent,
} = require('../utils/reportMetricsUtils');
const {toPeriodWindow} = require('../utils/reportWindowUtils');

const argsFor = ({context, period}) => ({
  organizationId: context.organizationId,
  period: toPeriodWindow({window: context.window, period}),
  scope: context.scope,
});

const slaOf = ({row}) =>
  toPercent({
    part: toInt({value: row.within_sla}),
    total: toInt({value: row.resolved_total}),
  });

// Skipped and still-open assessments stay out of the rate.
const onTimeOf = ({row}) => {
  const onTime = toInt({value: row.on_time});

  return {
    part: onTime,
    total: onTime + toInt({value: row.late}) + toInt({value: row.missed}),
  };
};

const roleRow = ({part, total, people}) => ({
  pct: toPercent({part, total}),
  part,
  total,
  people: toInt({value: people}),
});

const mapOverdueNow = ({rows}) => {
  const tasks = sumRows({
    rows: rows.filter((row) => row.kind === 'task'),
    field: 'count',
  });

  const visits = sumRows({
    rows: rows.filter((row) => row.kind === 'visit'),
    field: 'count',
  });

  return {total: tasks + visits, tasks, visits};
};

module.exports = class ReportsOverviewServices {
  static mapOverdueNow({rows}) {
    return mapOverdueNow({rows});
  }

  // Query order: alert KPIs (current, previous), assessment KPIs (current,
  // previous), overdue now, nurse pages, case manager tasks, SLA (current,
  // previous), admin pages.
  static async getOverview({context}) {
    try {
      const current = argsFor({context, period: 'current'});
      const previous = argsFor({context, period: 'previous'});

      const [
        alertRows,
        previousAlertRows,
        assessmentRows,
        previousAssessmentRows,
        overdueRows,
        nurseRows,
        caseManagerRows,
        slaRows,
        previousSlaRows,
        adminRows,
      ] = await runReportQueries({
        queries: [
          ALERTS_SQL.ALERT_KPIS_SQL(current),
          ALERTS_SQL.ALERT_KPIS_SQL(previous),
          ASSESSMENTS_SQL.ASSESSMENT_KPIS_SQL(current),
          ASSESSMENTS_SQL.ASSESSMENT_KPIS_SQL(previous),
          WORK_SQL.OVERDUE_NOW_BY_REGION_SQL({
            organizationId: context.organizationId,
            scope: context.scope,
          }),
          ALERTS_SQL.NURSE_PAGES_SQL(current),
          WORK_SQL.CASE_MANAGER_TASKS_SQL(current),
          SLA_SQL.SLA_COMPLIANCE_TOTAL_SQL(current),
          SLA_SQL.SLA_COMPLIANCE_TOTAL_SQL(previous),
          ALERTS_SQL.ADMIN_PAGES_SQL(current),
        ],
      });

      const alerts = alertRows[0] || {};
      const previousAlerts = previousAlertRows[0] || {};
      const sla = slaRows[0] || {};
      const previousSla = previousSlaRows[0] || {};
      const admins = adminRows[0] || {};
      const raised = toInt({value: alerts.raised});
      const accepted = toInt({value: alerts.accepted});
      const resolved = toInt({value: alerts.resolved});
      const voided = toInt({value: alerts.voided});
      const assessments = assessmentRows[0] || {};
      const previousAssessments = previousAssessmentRows[0] || {};
      const nurses = nurseRows[0] || {};
      const caseManagers = caseManagerRows[0] || {};
      const onTime = onTimeOf({row: assessments});
      const previousOnTime = onTimeOf({row: previousAssessments});

      return {
        success: true,
        doc: {
          kpis: {
            alertsRaised: toKpi({
              value: raised,
              previous: toInt({value: previousAlerts.raised}),
            }),
            slaCompliancePct: toKpi({
              value: slaOf({row: sla}),
              previous: slaOf({row: previousSla}),
            }),
            medianResolveSeconds: toKpi({
              value: toNullableNumber({value: alerts.median_resolve_seconds}),
              previous: toNullableNumber({
                value: previousAlerts.median_resolve_seconds,
              }),
            }),
            assessmentsOnTimePct: toKpi({
              value: toPercent({part: onTime.part, total: onTime.total}),
              previous: toPercent({
                part: previousOnTime.part,
                total: previousOnTime.total,
              }),
            }),
          },
          kpiDetails: {
            red: toInt({value: alerts.raised_red}),
            yellow: toInt({value: alerts.raised_yellow}),
            timeouts:
              toInt({value: sla.resolved_total}) -
              toInt({value: sla.within_sla}),
            p90ResolveSeconds: toNullableNumber({
              value: alerts.p90_resolve_seconds,
            }),
            medianAcceptSeconds: toNullableNumber({
              value: alerts.median_accept_seconds,
            }),
            missed: toInt({value: assessments.missed}),
            late: toInt({value: assessments.late}),
          },
          overdueNow: mapOverdueNow({rows: overdueRows}),
          alertStatus: {
            open: raised - accepted - resolved - voided,
            accepted,
            resolved,
            voided,
          },
          roles: {
            nurses: roleRow({
              part: toInt({value: nurses.resolved}),
              total: toInt({value: nurses.closed}),
              people: nurses.people,
            }),
            caseManagers: roleRow({
              part: toInt({value: caseManagers.on_time}),
              total: toInt({value: caseManagers.closed_or_overdue}),
              people: caseManagers.people,
            }),
            caregivers: roleRow({
              part: onTime.part,
              total: onTime.total,
              people: assessments.people,
            }),
            admins: roleRow({
              part: toInt({value: admins.resolved}),
              total: toInt({value: admins.reached}),
              people: admins.people,
            }),
          },
        },
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
