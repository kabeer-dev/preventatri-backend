const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

const otpMethodsResponseSchema = {
  type: 'object',
  properties: {
    email: {
      type: 'boolean',
      description: 'Whether email OTP is required during login',
      example: true,
    },
    phone: {
      type: 'boolean',
      description: 'Whether phone OTP is required during login',
      example: false,
    },
  },
};

module.exports = {
  '/api/v1/securities/otp-methods': {
    get: createSwaggerDocs({
      tags: ['Securities'],
      summary: "Get the logged-in user's OTP method preferences",
      description:
        'Returns which OTP channels (email/phone) are required for the ' +
        'logged-in user during the login OTP verification flow.',
      responses: {
        200: {
          description: 'OTP methods retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'OTP methods retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              otpMethods: otpMethodsResponseSchema,
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'OTP_METHODS_RETRIEVED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
      },
    }),
  },
  '/api/v1/securities/otp-methods/{id}': {
    patch: createSwaggerDocs({
      tags: ['Securities'],
      summary: "Update the logged-in user's OTP method preferences",
      description:
        'Replaces which OTP channels (email/phone) are required for the ' +
        'logged-in user during the login OTP verification flow.',
      parameters: [createIdPathParam({name: 'id', description: 'User ID'})],
      requestBody: {
        fields: {
          otpMethods: {
            type: 'object',
            description: 'The OTP methods to set',
            properties: {
              email: {
                type: 'boolean',
                description: 'Whether email OTP should be required',
                example: true,
              },
              phone: {
                type: 'boolean',
                description: 'Whether phone OTP should be required',
                example: false,
              },
            },
            required: ['email', 'phone'],
          },
        },
        required: ['otpMethods'],
      },
      responses: {
        200: {
          description: 'OTP methods updated successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'OTP methods updated successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              otpMethods: otpMethodsResponseSchema,
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'OTP_METHODS_UPDATED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid otpMethods payload',
          message: {
            description: 'Error message',
            example: 'email is required',
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
      },
    }),
  },
};
