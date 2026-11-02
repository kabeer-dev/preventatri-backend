const AppError = require('./app');

module.exports = class AuthErrorsFactories {
  static unauthorized() {
    return new AppError({
      message: "You're not allowed for this action",
      statusCode: 403,
    });
  }

  static unauthenticated() {
    return new AppError({
      message: "You're not authenticated for this action. Please login again",
      statusCode: 401,
    });
  }
};
