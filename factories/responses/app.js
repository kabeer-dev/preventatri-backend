class AppResponse {
  constructor({message, statusCode, body} = {}) {
    this.statusCode = statusCode;
    this.message = message;
    this.body = body;
  }
}
module.exports = AppResponse;
