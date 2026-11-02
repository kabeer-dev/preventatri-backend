const AppResponse = require('./app');

module.exports = class ReportsResponsesFactories {
  static serializeRange({window}) {
    return {
      from: window.from,
      to: window.to,
      grain: window.grain,
      timeZone: window.timeZone,
      spanDays: window.spanDays,
      buckets: window.buckets,
      previous: {from: window.previous.from, to: window.previous.to},
    };
  }

  static reportRetrieved({type, message, body}) {
    return new AppResponse({
      message,
      statusCode: 200,
      body: Object.assign({}, body, {type}),
    });
  }
};
