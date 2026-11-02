/**
 * Audit Logging Configuration
 *
 * Centralized configuration for the audit logging system.
 * Modify these settings to control what gets logged.
 */

const {AUDIT_CREDENTIAL_MASKED_FIELDS} = require('../constants/auditConstants');

module.exports = {
  // Fields to mask in audit logs (replaced with '[REDACTED]')
  maskedFields: ['password'].concat(AUDIT_CREDENTIAL_MASKED_FIELDS),

  // Retention period in days (HIPAA requires minimum 6 years)
  retentionDays: 2190, // 6 years
};
