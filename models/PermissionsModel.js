const mongoose = require('mongoose');

const {softDeleteWithIndexesPlugin, showFieldsPlugin} = require('./plugins');

const {Schema} = mongoose;

const userAccessLevelSchema = new Schema(
  {
    view: {
      type: [String],
      default: [],

      // [ALL]         => can view all users
      // [selfId, ids1,ids2] || [selfId] || [ids1,ids2]  => can view only the users with these ids (if user needs to modify him/herself along with others, then their id has to be added in this array in addition to every other user needed, and if he is only allowed to modify himself but no one else, then the array will only have his/her id, and if they are allowed to modify others only but not themselves, then the array will have users ids and not theirs
      // [NONE]        => cannot view any user
      // []            => empty means he cannot do anything . it is just like placeholder
    },
    update: {
      type: [String],
      default: [],
    },
  },
  {_id: false}
);

const entitiesAccessLevelSchema = new Schema(
  {
    view: {
      type: [String],
      default: [],
    },
    update: {
      type: [String],
      default: [],
    },
  },
  {_id: false}
);

const levelsSchema = new Schema(
  {
    users: userAccessLevelSchema,
    entities: entitiesAccessLevelSchema,

    // You can add more modules/resources here
    // e.g. companies: companyAccessLevelSchema,
  },
  {_id: false}
);

const permissionsSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Users',
    },
    levels: levelsSchema,
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

permissionsSchema.plugin(softDeleteWithIndexesPlugin);

permissionsSchema.plugin(showFieldsPlugin, {
  fieldsToShow: ['organizationId', 'userId', 'levels'], // only these will be shown by default
});

module.exports = mongoose.model('Permissions', permissionsSchema);
