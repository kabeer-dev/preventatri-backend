const AppResponse = require('./app');

const {
  AUDIT_LOG_SUCCESS_TYPES,
} = require('../../constants/responses/success/auditLogs');

module.exports = class AuditLogsResponsesFactories {
  static auditLogsListed({auditLogs, meta}) {
    return new AppResponse({
      message: 'Audit logs retrieved successfully',
      statusCode: 200,
      body: {
        auditLogs: auditLogs || [],
        meta,
        type: AUDIT_LOG_SUCCESS_TYPES.auditLogsListed.value,
      },
    });
  }

  static dataExportLogged() {
    return new AppResponse({
      message: 'Data export logged successfully',
      statusCode: 201,
      body: {type: AUDIT_LOG_SUCCESS_TYPES.dataExportLogged.value},
    });
  }
};
