class AppError extends Error {
  constructor({
    message,
    statusCode,
    error = null,
    isKnown = true,
    submitForMonitoring = false,
  } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isKnown = isKnown;
    this.submitForMonitoring = submitForMonitoring;
    this.internalErr = error;
  }
}
module.exports = AppError;
