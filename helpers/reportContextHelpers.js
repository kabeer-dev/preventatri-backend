const {REPORT_SCOPE_PARAMS} = require('../constants/reportsConstants');
const OrganizationsServices = require('../services/organizationsServices');
const {buildReportWindow} = require('../utils/reportWindowUtils');

const toReportScope = ({query}) =>
  Object.fromEntries(
    REPORT_SCOPE_PARAMS.map((param) => [param, query[param] || null])
  );

async function buildReportContext({req}) {
  const token = req.extra.jwtToken;
  const organizationId = token.user.currentActiveOrganization.organizationId;

  const timeZone = await OrganizationsServices.getOrganizationTimeZone({
    id: organizationId,
  });

  const {from, to, regionId} = req.query;

  return {
    organizationId,
    userId: token.user.id,
    window: buildReportWindow({from, to, timeZone}),
    regionId: regionId || null,
    scope: toReportScope({query: req.query}),
    query: req.query,
  };
}

module.exports = {buildReportContext, toReportScope};
