const Yup = require('yup');

const {
  PREFERRED_CONTACT_METHODS_VALUES,
} = require('../constants/generalConstant');

const {
  EMAIL_PATTERN,
  PHONE_NUMBER_MAX_LENGTH,
  PHONE_NUMBER_PATTERN,
} = require('../constants/usersConstants');
const {safeConcat, safeMerge, normalizePhoneNumber} = require('../utils');

// Standalone helper so convenience methods (address, city, zipCode) can reference it
const optionalText = ({fieldName = 'Field', limit = 255} = {}) =>
  Yup.string()
    .nullable()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .max(limit, `${fieldName} must not exceed ${limit} characters`);

const commonSchema = () => ({
  // 📧 Email
  email: ({fieldName = 'Email'} = {}) =>
    Yup.string()
      .trim()
      .email(`${fieldName} must be a valid email`)
      .transform((value) => value?.toLowerCase())
      .matches(EMAIL_PATTERN, `${fieldName} is not valid`),

  /**
   * Phone number -- the SAME rule for every role and every form, aligned with
   * what HHAeXchange delivers: digits with an optional leading "+", at most
   * PHONE_NUMBER_MAX_LENGTH characters. Formatting characters are stripped
   * before validation, and an empty value or bare dial code becomes null, so a
   * cleared phone input never fails. Callers decide whether it is required;
   * by default it is optional and nullable.
   */
  phoneNo: ({fieldName = 'Phone number'} = {}) =>
    Yup.string()
      .nullable()

      // Yup leaves a non-string object untouched so its own type error
      // fires; hand it back as-is or the normaliser would strip
      // "[object Object]" to null and pass malformed input as a clear.
      .transform((value) =>
        typeof value === 'string' ? normalizePhoneNumber({value}) : value
      )
      .max(
        PHONE_NUMBER_MAX_LENGTH,
        `${fieldName} must not exceed ${PHONE_NUMBER_MAX_LENGTH} characters`
      )
      .matches(PHONE_NUMBER_PATTERN, {
        excludeEmptyString: true,
        message: `${fieldName} may contain digits only, with an optional leading +`,
      }),

  // 🔑 Password With Validation . This is only used for user creation (sign up) and update (change) password
  passwordWithValidation: () =>
    Yup.string()
      .trim()
      .matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()[\]{}\-_+=~`|:;"'<>,.?/\\])/,
        'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.'
      )
      .min(12, 'Password must be at least 12 characters long')
      .max(64, 'Password must not exceed 64 characters'),

  // 🔐 Password Without Validation . This is used for login where we don't need to validate the password complexity
  passwordWithOutValidation: () => Yup.string().trim(),

  // 🧑 Name fields
  name: ({fieldName = 'Name', limit = 20} = {}) =>
    Yup.string()
      .trim()
      .min(1, `${fieldName} must have at least 1 character`)
      .max(limit, `${fieldName} must not exceed ${limit} characters`),

  // ✍️ General text field
  text: ({fieldName = 'Text', limit = 255} = {}) =>
    Yup.string()
      .trim()
      .min(1, `${fieldName} must have at least 1 character`)
      .max(limit, `${fieldName} must not exceed ${limit} characters`),

  // 🔢 Number field
  number: ({type = 'integer', fieldName = 'Value'} = {}) => {
    let schema = Yup.number().typeError(`${fieldName} must be a number`);
    if (type === 'integer')
      schema = schema.integer(`${fieldName} must be an integer`);

    return schema;
  },

  address: () => optionalText({fieldName: 'Address', limit: 500}),
  city: () => optionalText({fieldName: 'City', limit: 100}),

  // users.state is VarChar(50), matching patients.state. It holds whatever the
  // caller sends; the HHAeXchange mapper narrows its own input to a two-letter
  // code before it ever reaches a column.
  state: () => optionalText({fieldName: 'State', limit: 50}),
  zipCode: () => optionalText({fieldName: 'Zip code', limit: 10}),

  // 🔘 Single select
  singleSelect: ({options = [], fieldName = 'Value'} = {}) =>
    Yup.mixed().oneOf(options, `${fieldName} must be a valid option`),

  // 🟦 Multi select
  multiSelect: ({options = [], fieldName = 'Values'} = {}) =>
    Yup.array()
      .typeError(`${fieldName} must be an array`)
      .min(1, `${fieldName} must have at least 1 selected option`)
      .of(Yup.mixed().oneOf(options, `${fieldName} must be a valid option`)),
});

/**
 * Common pagination and sorting schema
 * Used by all list endpoints for consistent pagination validation
 */
const commonPaginationSchema = ({
  sortFieldsValues = [],
  sortOrdersValues = [],
} = {}) => {
  // Base pagination shape
  const baseShape = {
    page: Yup.number()
      .typeError('page must be a number')
      .positive()
      .integer()
      .default(1),
    limit: Yup.number()
      .typeError('limit must be a number')
      .positive()
      .integer()
      .max(100)
      .default(25),
  };

  // Conditionally add sorting fields using safeMerge (no spread operators)
  let shapeWithSort = baseShape;

  if (sortFieldsValues.length > 0) {
    shapeWithSort = safeMerge({
      originalObj: shapeWithSort,
      newObj: {
        sortBy: Yup.string().oneOf(
          sortFieldsValues,
          `Sort field must be one of: ${sortFieldsValues.join(', ')}`
        ),
      },
    });
  }

  if (sortOrdersValues.length > 0) {
    shapeWithSort = safeMerge({
      originalObj: shapeWithSort,
      newObj: {
        sortDir: Yup.string().oneOf(sortOrdersValues).default('asc'),
      },
    });
  }

  return Yup.object().shape(shapeWithSort);
};

const commonFieldsSchema = commonSchema();

/**
 * Common user-related validation fields shared across User, Caregiver, and Patient schemas.
 */
const commonUserSchema = {
  firstName: commonFieldsSchema
    .name({fieldName: 'First Name'})
    .required('First Name is required'),
  lastName: commonFieldsSchema
    .name({fieldName: 'Last Name'})
    .required('Last Name is required'),
  email: commonFieldsSchema.email().required('Email is required'),
  phoneNo: commonFieldsSchema.phoneNo(),
};

/**
 * Common user-related validation fields for updates (all optional; phoneNo is
 * also nullable so a cleared phone can be saved as null)
 */
const commonUserUpdateSchema = {
  firstName: commonFieldsSchema.name({fieldName: 'First Name'}),
  lastName: commonFieldsSchema.name({fieldName: 'Last Name'}),
  phoneNo: commonFieldsSchema.phoneNo(),
};

/**
 * Preferred Contact Method validation
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest , validateCaregiverInviteRequest, validateCaregiverProfileUpdateRequest
 */
const preferredContactMethodSchema = ({
  required = false,
  nullable = false,
} = {}) => {
  let schema = Yup.string().oneOf(
    safeConcat({
      originalArray: PREFERRED_CONTACT_METHODS_VALUES,
      newArray: nullable ? [null, ''] : [''],
    }),
    `Preferred contact method must be one of: ${PREFERRED_CONTACT_METHODS_VALUES.join(', ')}`
  );

  if (nullable) {
    schema = schema.nullable();
  }

  return required
    ? schema.required('Preferred contact method is required')
    : schema;
};

module.exports = {
  commonSchema,
  commonPaginationSchema,
  commonUserSchema,
  commonUserUpdateSchema,
  preferredContactMethodSchema,
};
