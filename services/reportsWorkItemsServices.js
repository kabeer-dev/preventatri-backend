const ReportsOverviewServices = require('./reportsOverviewServices');
const WORK_SQL = require('../constants/reports/workItemsReportSql');

const {
  SUPERVISORY_VISIT_STATUSES,
} = require('../constants/supervisoryVisitsConstants');
const {runReportQueries} = require('../helpers/reportQueryHelpers');

const {
  fillSeries,
  toInt,
  toNullableNumber,
  toPercent,
} = require('../utils/reportMetricsUtils');
const {toPeriodWindow} = require('../utils/reportWindowUtils');

// Segmented bar order from the design.
const STATUS_MIX_ORDER = [
  SUPERVISORY_VISIT_STATUSES.scheduled.value,
  SUPERVISORY_VISIT_STATUSES.underReview.value,
  SUPERVISORY_VISIT_STATUSES.approved.value,
  SUPERVISORY_VISIT_STATUSES.overdue.value,
  SUPERVISORY_VISIT_STATUSES.cancelled.value,
];

module.exports = class ReportsWorkItemsServices {
  // Query order: task KPIs, tasks created by bucket, tasks completed by
  // bucket, visit KPIs, visit status mix, overdue now.
  static async getWorkItems({context}) {
    try {
      const {organizationId, scope} = context;

      const args = {
        organizationId,
        scope,
        period: toPeriodWindow({window: context.window, period: 'current'}),
      };

      const [
        taskRows,
        createdRows,
        completedRows,
        visitRows,
        statusRows,
        overdueRows,
      ] = await runReportQueries({
        queries: [
          WORK_SQL.TASK_KPIS_SQL(args),
          WORK_SQL.TASKS_CREATED_BY_BUCKET_SQL(args),
          WORK_SQL.TASKS_COMPLETED_BY_BUCKET_SQL(args),
          WORK_SQL.VISIT_KPIS_SQL(args),
          WORK_SQL.VISIT_STATUS_MIX_SQL(args),
          WORK_SQL.OVERDUE_NOW_BY_REGION_SQL({organizationId, scope}),
        ],
      });

      const tasks = taskRows[0] || {};
      const visits = visitRows[0] || {};

      const overdueNow = ReportsOverviewServices.mapOverdueNow({
        rows: overdueRows,
      });
      const {buckets} = context.window;
      const completed = toInt({value: tasks.completed});
      const filed = toInt({value: visits.filed});

      return {
        success: true,
        doc: {
          followUps: {
            created: toInt({value: tasks.created}),
            completed,
            completedOnTimePct: toPercent({
              part: toInt({value: tasks.completed_on_time}),
              total: completed + toInt({value: tasks.overdue_in_period}),
            }),
            overdueNow: overdueNow.tasks,
            trend: {
              buckets,
              created: fillSeries({
                buckets,
                rows: createdRows,
                valueField: 'count',
              }),
              completed: fillSeries({
                buckets,
                rows: completedRows,
                valueField: 'count',
              }),
            },
          },
          visits: {
            scheduled: toInt({value: visits.scheduled}),
            filed,
            filedOnTimePct: toPercent({
              part: toInt({value: visits.filed_on_time}),
              total: filed + toInt({value: visits.overdue_in_period}),
            }),
            medianReviewSeconds: toNullableNumber({
              value: visits.median_review_seconds,
            }),
            overdueNow: overdueNow.visits,
            statusMix: STATUS_MIX_ORDER.map((status) => ({
              status,
              count: toInt({
                value: statusRows.find((row) => row.status === status)?.count,
              }),
            })),
            concernsNoted: toInt({value: visits.concerns_noted}),
            correctionRequested: toInt({value: visits.correction_requested}),
          },
        },
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
