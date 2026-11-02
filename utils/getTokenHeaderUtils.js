const config = require('config');

function getTokenHeaderName() {
  const base = config.get('tokenVariable') || 'x-auth-token';
  const projectName = config.get('projectName') || 'default-project';

  return `${base}-${projectName}`;
}

module.exports = {
  getTokenHeaderName,
};
