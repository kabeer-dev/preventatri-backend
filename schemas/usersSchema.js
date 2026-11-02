const Yup = require('yup');

const {usersConstants} = require('../constants');
const {validatorUtils, safeMerge, dateUtils} = require('../utils');

const caregiversSchema = require('./caregiversSchema');
const caseManagersSchema = require('./caseManagersSchema');

const {commonListFiltersSchema} = require('./commonEntityValidations');

const {
  commonSchema,
  commonUserSchema,
  commonUserUpdateSchema,
  commonPaginationSchema,
} = require('./commonSchema');
const nursesSchema = require('./nursesSchema');
const {personFields} = require('./reportsSchema');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const commonFieldsSchema = commonSchema();

// � Create User
module.exports.validateCreateRequest = ({data: user}) => {
  const userSchema = Yup.object().shape(
    safeMerge({
      originalObj: commonUserSchema,
      newObj: {
        password: commonFieldsSchema
          .passwordWithValidation()
          .required('Password is required'),
        organizationName: Yup.string()
          .trim()
          .min(2, 'Organization name must be at least 2 characters')
          .max(120, 'Organization name must be at most 120 characters')
          .required('Organization name is required'),
      },
    })
  );

  return validatorUtils.validate({schema: userSchema, data: user});
};

// 🔐 Login
module.exports.validateLoginRequest = ({data: user}) => {
  const loginSchema = Yup.object().shape({
    email: commonFieldsSchema.email().required('Email is required'),
    password: commonFieldsSchema
      .passwordWithOutValidation()
      .required('Password is required'),
    token: Yup.string(),
    emailOtp: Yup.string().length(8, 'OTP must be exactly 8 characters'),
    phoneOtp: Yup.string().length(8, 'OTP must be exactly 8 characters'),
  });

  return validatorUtils.validate({schema: loginSchema, data: user});
};

module.exports.validateRegenerateOtpRequest = ({data: user}) => {
  const otpRegenerateSchema = Yup.object().shape({
    token: Yup.string().required('Token is required'),
  });

  return validatorUtils.validate({schema: otpRegenerateSchema, data: user});
};

// 📧 Send Reset Link
module.exports.validateEmail = ({data}) => {
  const emailSchema = Yup.object().shape({
    email: commonFieldsSchema.email().required('Email is required'),
  });

  return validatorUtils.validate({schema: emailSchema, data});
};

// 🔁 Reset Password
module.exports.validateResetPasswordRequest = ({data}) => {
  const resetSchema = Yup.object().shape({
    password: commonFieldsSchema
      .passwordWithValidation()
      .required('Password is required'),
  });

  return validatorUtils.validate({schema: resetSchema, data});
};

// 🆔 Validate User ID
module.exports.validateUserIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'User'}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 🔗 Validate the token of an emailed organization invitation link
module.exports.validateOrganizationInvitationTokenParams = ({data}) => {
  const tokenSchema = Yup.object().shape({
    token: Yup.string().trim().required('Invitation token is required'),
  });

  return validatorUtils.validate({schema: tokenSchema, data});
};

// ✉️ Invite User — which user type is being invited comes from the query string
module.exports.validateInviteUserTypeQuery = ({data}) => {
  const userTypeSchema = Yup.object().shape({
    userType: commonFieldsSchema
      .singleSelect({
        options: usersConstants.INVITE_USER_TYPES,
        fieldName: 'User type',
      })
      .required(),
  });

  return validatorUtils.validate({schema: userTypeSchema, data});
};

// Body shape depends on the invited user type, so the request is handed to that
// type's own invite schema. Runs after validateInviteUserTypeQuery, which is what
// guarantees the lookup resolves.
const INVITE_SCHEMA_BY_USER_TYPE = {
  [usersConstants.SYSTEM_ROLES.nurse.value]:
    nursesSchema.validateNurseInviteRequest,
  [usersConstants.SYSTEM_ROLES.caregiver.value]:
    caregiversSchema.validateCaregiverInviteRequest,
  [usersConstants.SYSTEM_ROLES.case_manager.value]:
    caseManagersSchema.validateCaseManagerInviteRequest,
};

module.exports.validateInviteUserRequest = ({data, context}) =>
  INVITE_SCHEMA_BY_USER_TYPE[context.req.query.userType]({data, context});

// ✉️ Bulk invite people who already have a record
module.exports.validateBulkInvitationRequest = ({data}) => {
  const bulkSchema = Yup.object().shape({
    userIds: Yup.array()
      .of(validatorUtils.uuidValidate({name: 'User'}))
      .min(1, 'Select at least one person')
      .max(
        usersConstants.BULK_INVITATION_MAX_USERS,
        `At most ${usersConstants.BULK_INVITATION_MAX_USERS} people can be invited at once`
      )
      .required('userIds is required'),
  });

  return validatorUtils.validate({schema: bulkSchema, data});
};

// 🚫 Cancel an outstanding invitation
module.exports.validateRevokeInvitationRequest = ({data}) => {
  const revokeSchema = Yup.object().shape({
    userId: validatorUtils.uuidValidate({name: 'User'}),
  });

  return validatorUtils.validate({schema: revokeSchema, data});
};

// 🔀 Switch the organization this login works in
module.exports.validateSwitchOrganizationRequest = ({data}) => {
  const switchSchema = Yup.object().shape({
    organizationId: validatorUtils.uuidValidate({name: 'Organization'}),
  });

  return validatorUtils.validate({schema: switchSchema, data});
};

// ✅ Verify Invited User
module.exports.validateVerifyInvitedUserRequest = ({data}) => {
  const verifySchema = Yup.object().shape({
    firstName: commonFieldsSchema
      .name({fieldName: 'First Name'})
      .required('First Name is required'),
    lastName: commonFieldsSchema
      .name({fieldName: 'Last Name'})
      .required('Last Name is required'),
    password: commonFieldsSchema
      .passwordWithValidation()
      .required('Password is required'),
  });

  return validatorUtils.validate({schema: verifySchema, data});
};

// 📊 Admin Stats Query (from/to are optional — omitting both means all time)
module.exports.validateAdminStatsQuery = ({data}) => {
  const statsQuerySchema = Yup.object().shape({
    from: Yup.date().typeError('From must be a valid date'),
    to: Yup.date()
      .typeError('To must be a valid date')
      .when('from', {
        is: (from) => Boolean(from),
        then: (schema) =>
          schema.min(Yup.ref('from'), 'To date cannot be before From date'),
      }),
  });

  return validatorUtils.validate({schema: statsQuerySchema, data});
};

// 📈 Admin Stats Trends Query. from/to stay YYYY-MM-DD strings so days follow
// the org's zone; a Yup Date cast would use the server's zone.
module.exports.validateAdminStatsTrendsQuery = ({data}) => {
  const dateStringSchema = Yup.string()
    .matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'Date must be in YYYY-MM-DD format',
      excludeEmptyString: true,
    })

    // The regex only checks the shape, so impossible calendar dates like
    // 2026-02-30 still pass it. Reject them here so the request fails loudly
    // instead of the invalid bound being silently dropped downstream.
    .test(
      'is-valid-calendar-date',
      'Date is not a valid calendar date',
      (value) => !value || dateUtils.isValidDate({date: value})
    );

  const timeseriesQuerySchema = Yup.object()
    .shape(
      Object.assign(
        {
          from: dateStringSchema,
          to: dateStringSchema,
          regionId: Yup.string().uuid('regionId must be a uuid'),
        },
        personFields()
      )
    )
    .test(
      'to-not-before-from',
      'To date cannot be before From date',
      ({from, to}) => !from || !to || to >= from
    )
    .test(
      'within-max-span',
      `Date range cannot exceed ${usersConstants.MAX_TIMESERIES_RANGE_DAYS} days`,
      ({from, to}) => {
        if (!from || !to) return true;

        const spanDays = dateUtils.getDaysBetween({from, to});

        return spanDays <= usersConstants.MAX_TIMESERIES_RANGE_DAYS;
      }
    );

  return validatorUtils.validate({schema: timeseriesQuerySchema, data});
};

// 🌐 Update Language
module.exports.validateLanguage = ({data}) => {
  const languageSchema = Yup.object().shape({
    language: commonFieldsSchema
      .singleSelect({
        options: usersConstants.LANGUAGES_VALUES,
        fieldName: 'Language',
      })
      .required(),
  });

  return validatorUtils.validate({schema: languageSchema, data});
};

//Profile update
module.exports.validateProfileUpdateRequest = ({data: user}) => {
  const profileUpdateSchema = Yup.object().shape(
    safeMerge({
      originalObj: commonUserUpdateSchema,
      newObj: {
        email: commonFieldsSchema.email(), // Added back for profile update, but not nullable
        address: commonFieldsSchema.address(),
        city: commonFieldsSchema.city(),
        zipCode: commonFieldsSchema.zipCode(),
        currentPassword: Yup.string().nullable(),
        newPassword: Yup.string()
          .nullable()
          .when('currentPassword', {
            is: (val) => !!val,
            then: (schema) =>
              schema
                .concat(commonFieldsSchema.passwordWithValidation())
                .required('New password is required')
                .notOneOf(
                  [Yup.ref('currentPassword')],
                  'New password must be different from current password'
                ),
            otherwise: (schema) => schema.notRequired().nullable(),
          }),
        token: Yup.string(),
        emailOtp: Yup.string().length(8, 'OTP must be exactly 8 characters'),
        phoneOtp: Yup.string().length(8, 'OTP must be exactly 8 characters'),
        isLogoutFromAllDevices: Yup.boolean().default(false),
      },
    })
  );

  return validatorUtils.validate({schema: profileUpdateSchema, data: user});
};

/**
 * Query validation for the unified Users & Roles roster.
 *
 * Every param has to be declared here -- the validator strips anything it does
 * not know about before the controller runs.
 */
module.exports.validateListUsersQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: usersConstants.USERS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape(
    safeMerge({
      originalObj: commonListFiltersSchema({
        withRegionId: true,
        statusSchema: Yup.string().oneOf(
          usersConstants.ROSTER_STATUSES_VALUES,
          `status must be one of: ${usersConstants.ROSTER_STATUSES_VALUES.join(', ')}`
        ),
        roleSchema: Yup.string().oneOf(
          usersConstants.ROSTER_ROLES,
          `role must be one of: ${usersConstants.ROSTER_ROLES.join(', ')}`
        ),
      }),
      newObj: {
        // active (default) hides archived people, all returns both, archived
        // returns only archived.
        archiveFilter: Yup.string()
          .oneOf(
            usersConstants.ROSTER_ARCHIVE_FILTERS_VALUES,
            `archiveFilter must be one of: ${usersConstants.ROSTER_ARCHIVE_FILTERS_VALUES.join(', ')}`
          )
          .default(usersConstants.ROSTER_ARCHIVE_FILTERS.ACTIVE.value),
        invitationStatus: Yup.string().oneOf(
          usersConstants.INVITATION_STATUSES_VALUES,
          `invitationStatus must be one of: ${usersConstants.INVITATION_STATUSES_VALUES.join(', ')}`
        ),
        source: Yup.array()
          .transform((value, originalValue) => {
            if (originalValue === undefined || originalValue === null) {
              return undefined;
            }
            if (Array.isArray(originalValue)) return originalValue;

            return String(originalValue)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          })
          .of(
            Yup.string().oneOf(
              usersConstants.ROSTER_SOURCES_VALUES,
              `source must be one of: ${usersConstants.ROSTER_SOURCES_VALUES.join(', ')}`
            )
          ),
      },
    })
  );

  return validatorUtils.validate({schema: querySchema, data});
};
