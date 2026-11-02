const mongoose = require('mongoose');

const {softDeleteWithIndexesPlugin, showFieldsPlugin} = require('./plugins');

const {Schema} = mongoose;

const organizationsSchema = new Schema(
  {
    organizationName: {
      type: String,
      required: true,
    },
    creatorId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Users',
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    versionKey: false,
  }
);

organizationsSchema.plugin(softDeleteWithIndexesPlugin);

organizationsSchema.plugin(showFieldsPlugin, {
  fieldsToShow: ['organizationName'], // only these will be shown by default
});

module.exports = mongoose.model('Organizations', organizationsSchema);
