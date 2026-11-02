const {AsyncLocalStorage} = require('async_hooks');

const requestContext = new AsyncLocalStorage();

module.exports.initializeContext = ({context, nextFn}) =>
  requestContext.run(context, nextFn);

module.exports.getRequestContext = () => requestContext.getStore()?.req || {};

module.exports.getExtraContext = () =>
  requestContext.getStore()?.req?.extra || {};
