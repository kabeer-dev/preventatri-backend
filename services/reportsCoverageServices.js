const SQL = require('../constants/reports/coverageReportSql');
const {REPORT_COVERAGE} = require('../constants/reportsConstants');
const {runReportQueries} = require('../helpers/reportQueryHelpers');

const {addToFormattedUTC, getCurrentUTCISO} = require('../utils/dateUtils');
const {toInt} = require('../utils/reportMetricsUtils');

const DATE_FORMAT = 'yyyy-MM-dd';

const countOf = ({rows}) => toInt({value: rows[0]?.total});

module.exports = class ReportsCoverageServices {
  // Query order: without primary nurse, without case manager, without active
  // checklist, regions without primary default, licenses, then without county.
  static async getCoverage({context}) {
    try {
      const {organizationId, regionId} = context;
      const {today} = context.window;

      const cutoffDate = addToFormattedUTC({
        value: today,
        format: DATE_FORMAT,
        duration: {days: REPORT_COVERAGE.licenseWarningDays},
      });

      const queries = [
        SQL.PATIENTS_WITHOUT_PRIMARY_NURSE_SQL({organizationId, regionId}),
        SQL.PATIENTS_WITHOUT_CASE_MANAGER_SQL({organizationId, regionId}),
        SQL.PATIENTS_WITHOUT_ACTIVE_CHECKLIST_SQL({
          organizationId,
          regionId,
          today,
        }),
        SQL.REGIONS_WITHOUT_PRIMARY_DEFAULT_SQL({organizationId, regionId}),
        SQL.NURSES_LICENSE_EXPIRING_SQL({organizationId, regionId, cutoffDate}),
      ];

      // No county means no region, so this gap exists only for All regions.
      const [primary, caseManager, checklist, regions, licenses, county] = (
        await runReportQueries({
          queries: regionId
            ? queries
            : queries.concat([
                SQL.PATIENTS_WITHOUT_COUNTY_SQL({organizationId}),
              ]),
        })
      ).map((rows) => countOf({rows}));

      return {
        success: true,
        doc: {
          asOf: getCurrentUTCISO(),
          gaps: {
            patientsWithoutCounty: regionId ? null : county,
            patientsWithoutPrimaryNurse: primary,
            patientsWithoutCaseManager: caseManager,
            patientsWithoutActiveChecklist: checklist,
            regionsWithoutPrimaryDefault: regions,
            nursesLicenseExpiring: licenses,
          },
        },
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
