const bcrypt = require('bcrypt');

module.exports.hashString = async ({string}) => await bcrypt.hash(string, 10);

module.exports.compareHashedString = async ({simpleString, hashedString}) =>
  await bcrypt.compare(simpleString, hashedString);
