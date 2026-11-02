const SQL = require('../constants/reports/highRiskPatientsReportSql');
const {runReportQueries} = require('../helpers/reportQueryHelpers');
const {toInt} = require('../utils/reportMetricsUtils');
const {toPeriodWindow} = require('../utils/reportWindowUtils');

const mapPatient = ({row}) => ({
  patientId: row.patient_id,
  firstName: row.first_name,
  lastName: row.last_name,
  countyName: row.county_name || null,
  caseManager:
    row.cm_first_name || row.cm_last_name
      ? {firstName: row.cm_first_name, lastName: row.cm_last_name}
      : null,
  redAlerts: toInt({value: row.red_alerts}),
  yellowAlerts: toInt({value: row.yellow_alerts}),
  trend: row.trend || null,
  overdueFollowUps: toInt({value: row.overdue_follow_ups}),
  riskRank: toInt({value: row.risk_rank}),
});

module.exports = class ReportsHighRiskPatientsServices {
  static async getPatients({context}) {
    try {
      const [rows] = await runReportQueries({
        queries: [
          SQL.HIGH_RISK_PATIENTS_SQL({
            organizationId: context.organizationId,
            period: toPeriodWindow({window: context.window, period: 'current'}),
            scope: context.scope,
          }),
        ],
      });

      return {
        success: true,
        doc: {patients: rows.map((row) => mapPatient({row}))},
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
