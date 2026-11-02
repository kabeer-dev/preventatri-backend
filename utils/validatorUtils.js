const Yup = require('yup');

module.exports.validate = async ({schema, data, context}) => {
  return await schema
    .validate(data, {abortEarly: false, stripUnknown: true, context})
    .then((parameters) => {
      return {parameters};
    })
    .catch((error) => {
      return {
        errors: error.errors.join(', '),
      };
    });
};

// UUID validator for Prisma UUIDs using Yup's built-in UUID validator
module.exports.uuidValidate = ({name, required = true}) => {
  let schema = Yup.string().uuid(`Invalid ${name} id`);

  return required ? schema.required(`${name} ID is required`) : schema;
};

// Optional numeric-enum filter for query params.
// An empty query string (e.g. ?flagType=) is coerced to null so it behaves as
// "no filter" instead of failing Yup.number() with a 400. The value, when
// present, must be an integer contained in `values`.
module.exports.nullableEnumNumberValidate = ({name, values}) =>
  Yup.number()
    .transform((value, originalValue) => (originalValue === '' ? null : value))
    .integer(`${name} must be an integer`)
    .oneOf(values, `${name} must be one of: ${values.join(', ')}`)
    .nullable();
