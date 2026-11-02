const populateFieldsPlugin = (schema, options = {}) => {
  const defaultPreHooks = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'save',
  ];
  const {fields = [], preHooks = defaultPreHooks} = options;

  // Mongoose 9: pre middleware no longer receives next parameter
  schema.pre(preHooks, function () {
    const skipMiddlewareGlobalPopulation =
      this.options?.skipMiddlewareGlobalPopulation;
    if (skipMiddlewareGlobalPopulation) return;

    if (fields.length > 0) {
      fields.forEach((field) => this.populate(field));
    }
  });

  // Mongoose 9: pre middleware no longer receives next parameter
  schema.pre('aggregate', function () {
    if (fields.length > 0) {
      fields.forEach((field) => {
        const path = schema.path(field);
        if (path?.options?.ref) {
          const from = path.options.ref.toLowerCase();

          this.pipeline().unshift({
            $lookup: {
              from,
              localField: field,
              foreignField: '_id',
              as: field,
            },
          });
        }
      });
    }
  });
};

module.exports = populateFieldsPlugin;
