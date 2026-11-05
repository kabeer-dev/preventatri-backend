const Yup = require('yup');

const {validatorUtils} = require('../utils');
const commonOrganizationValidations = require('./commonOrganizationValidations');

const {
  ESCALATION_POLICY_FLAGS,
  ESCALATION_STEP_TYPES_VALUES,
  ESCALATION_TTL_UNITS,
  ESCALATION_STEP_CHANNELS,
} = require('../constants/escalationConstants');
const {isValidPolicySteps} = require('../utils/escalationPolicyUtils');

const ESCALATION_TTL_UNITS_VALUES = Object.values(ESCALATION_TTL_UNITS).map(
  (u) => u.value
);

// 🔄 Update Organization Working Hours
module.exports.validateUpdateWorkingHoursRequest = ({data}) => {
  const updateSchema = Yup.object().shape({
    workingHours: commonOrganizationValidations
      .workingHoursSchema()
      .required('workingHours is required'),
  });

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🔄 Update Organization Time Zone
module.exports.validateUpdateTimeZoneRequest = ({data}) => {
  const updateSchema = Yup.object().shape({
    timeZone: commonOrganizationValidations.timeZoneSchema(),
  });

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🔄 Connect HHAeXchange — the organization's own credentials
module.exports.validateSaveHhaCredentialsRequest = ({data}) => {
  const credentialField = ({label}) =>
    Yup.string()
      .trim()
      .max(255, `${label} must be at most 255 characters`)
      .required(`${label} is required`);

  const saveSchema = Yup.object().shape({
    appName: credentialField({label: 'appName'}),
    appSecret: credentialField({label: 'appSecret'}),
    appKey: credentialField({label: 'appKey'}),
  });

  return validatorUtils.validate({schema: saveSchema, data});
};

// 🔄 Update Escalation Policy — :flag param
module.exports.validateEscalationPolicyFlagParams = ({data}) => {
  const paramsSchema = Yup.object().shape({
    flag: Yup.string()
      .oneOf(
        ESCALATION_POLICY_FLAGS,
        `flag must be one of: ${ESCALATION_POLICY_FLAGS.join(', ')}`
      )
      .required('flag is required'),
  });

  return validatorUtils.validate({schema: paramsSchema, data});
};

// 🔄 Update Escalation Policy — body
// Field checks give readable errors per step; the final test applies the same
// rules the engine does (isValidPolicySteps) so a saved policy is always usable.
module.exports.validateUpdateEscalationPolicyRequest = ({data}) => {
  const stepSchema = Yup.object().shape({
    type: Yup.string()
      .oneOf(
        ESCALATION_STEP_TYPES_VALUES,
        `step type must be one of: ${ESCALATION_STEP_TYPES_VALUES.join(', ')}`
      )
      .required('step type is required'),
    ttlMinutes: Yup.number()
      .integer('ttlMinutes must be a whole number')
      .min(1, 'ttlMinutes must be at least 1')
      .nullable()
      .defined('ttlMinutes is required (null for the ADMIN step)'),
    ttlUnit: Yup.string()
      .oneOf(
        ESCALATION_TTL_UNITS_VALUES,
        `ttlUnit must be one of: ${ESCALATION_TTL_UNITS_VALUES.join(', ')}`
      )
      .nullable()
      .defined('ttlUnit is required (null for the ADMIN step)'),
    channels: Yup.array()
      .of(
        Yup.string().oneOf(
          ESCALATION_STEP_CHANNELS,
          `channels must be any of: ${ESCALATION_STEP_CHANNELS.join(', ')}`
        )
      )
      .min(1, 'each step needs at least one channel')
      .required('channels is required'),
  });

  const updateSchema = Yup.object().shape({
    // The version the admin loaded and edited. Saving on top of any other
    // version is rejected (409), so one admin can't silently overwrite another.
    version: Yup.number()
      .integer('version must be a whole number')
      .min(1, 'version must be at least 1')
      .required('version is required'),
    steps: Yup.array()
      .of(stepSchema)
      .min(1, 'steps must not be empty')
      .required('steps is required')
      .test(
        'valid-policy-steps',
        'steps must be distinct step types ending with ADMIN; every step before ADMIN needs a timer that is a whole number of its ttlUnit, ADMIN has no timer (ttlMinutes and ttlUnit null), and channels must not repeat',
        (steps) => isValidPolicySteps({steps})
      ),
  });

  return validatorUtils.validate({schema: updateSchema, data});
};
