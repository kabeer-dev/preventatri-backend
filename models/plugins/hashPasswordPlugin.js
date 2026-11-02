const {passwordsUtils} = require('../../utils');

module.exports = function hashPasswordPlugin(schema) {
  // Handle .save()
  // Mongoose 9: pre middleware no longer receives next parameter
  schema.pre('save', async function () {
    if (!this.isModified('password')) return;

    this.password = await passwordsUtils.saltHashPassword({
      password: this.password,
    });
  });

  // Shared logic for update hooks
  // Mongoose 9: pre middleware no longer receives next parameter
  const hashPasswordInUpdate = async function () {
    const update = this.getUpdate();
    if (!update) return;

    const password = update.password || update.$set?.password;

    if (!password || typeof password !== 'string') return;

    const hashed = await passwordsUtils.saltHashPassword({password});

    if (update.password) {
      update.password = hashed;
    }
    if (update.$set?.password) {
      update.$set.password = hashed;
    }
  };

  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany'],
    hashPasswordInUpdate
  );
};
