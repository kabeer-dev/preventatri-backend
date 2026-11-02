const Yup = require('yup');

const {modelConstants} = require('../constants');
const {validatorUtils} = require('../utils');

module.exports.validateOtpMethodsIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: modelConstants.MODELS.USER}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

module.exports.validateUpdateOtpMethods = ({data}) => {
  const schema = Yup.object().shape({
    otpMethods: Yup.object()
      .shape({
        email: Yup.boolean()
          .typeError('email must be a boolean')
          .required('email is required'),
        phone: Yup.boolean()
          .typeError('phone must be a boolean')
          .required('phone is required'),
      })
      .test(
        'at-least-one-otp-method',
        'At least one OTP method (email or phone) must be enabled',
        (otpMethods) => !otpMethods || otpMethods.email || otpMethods.phone
      )
      .required('otpMethods is required'),
  });

  return validatorUtils.validate({schema, data});
};
