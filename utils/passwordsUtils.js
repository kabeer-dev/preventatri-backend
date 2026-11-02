const {hashString, compareHashedString} = require('./bcryptUtils');

module.exports.saltHashPassword = async ({password}) =>
  hashString({string: password});

module.exports.verify = async ({inputPassword, dbPassword}) =>
  compareHashedString({simpleString: inputPassword, hashedString: dbPassword});
