const mongoose = require('./mongoose');

const UsersModel = require(`./UsersModel`);
const PermissionsModel = require(`./PermissionsModel`);

module.exports = {
  mongoose,
  UsersModel,
  PermissionsModel,
};
