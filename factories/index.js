const ErrorsFactory = require('./errors');
const MongosFactory = require('./MongoFactories');
const PrismaFactory = require('./PrismaFactory');
const ResponsesFactory = require('./responses');

/* eslint-disable local-rules/no-spread-operator */
module.exports = {
  ...ErrorsFactory,
  ...ResponsesFactory,
  MongosFactory,
  PrismaFactory,
};
