const mongoose = require('mongoose');

const {
  softDeleteWithIndexesPlugin,
  hashPasswordPlugin,
  showFieldsPlugin,
} = require('./plugins');

const {usersConstants} = require('../constants');
const {jwtUtils} = require('../utils');

const {Schema} = mongoose;

const organizationsSchema = new Schema(
  {
    permissions: {type: Schema.Types.ObjectId, ref: 'Permissions'},
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
    },
    role: {
      type: String,
      enum: usersConstants.SYSTEM_ROLES_VALUES,
    },
    isActive: {type: Boolean},
  },
  {_id: false}
);

const usersSchema = new Schema(
  {
    firstName: {
      type: String,
    },
    lastName: {
      type: String,
    },
    phoneNo: {
      type: String,
      required: [true, 'User must have a phone number'],
    },
    email: {
      type: String,
      required: [true, 'User must have a email'],
      minlength: 4,
      maxlength: 255,
      lowercase: true,
    },
    password: {
      type: String,
      minlength: 6,
      maxlength: 2048,
    },
    organizations: [
      {
        type: organizationsSchema,
      },
    ],
    language: {
      type: String,
      enum: usersConstants.LANGUAGES_VALUES,
      default: usersConstants.DEFAULT_LANGUAGE,
    },
    isVerified: {type: Boolean, default: false},
    OTPs: {
      email: {
        type: String,
        select: false,
      },
      phone: {
        type: String,
        select: false,
      },
    },
    secretKeys: {
      auth: {
        type: String,
        select: false,
      },
      otp: {
        type: String,
        select: false,
      },
      verification: {
        type: String,
        select: false,
      },
      invitation: {
        type: String,
        select: false,
      },
      loginReset: {
        type: String,
        select: false,
      },
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
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);

usersSchema.plugin(showFieldsPlugin, {
  fieldsToShow: [
    'firstName',
    'lastName',
    'email',
    'phoneNo',
    'isVerified',
    'language',
  ], // only these will be shown by default
}); // Whenever you need to get the currentActiveOrganization to show, then you just need to make sure that the organizations is included in the include fields options. Organizations are not selected by default, so that affect the currentActiveOrganization and they show or hide together

// Apply soft delete plugin with scoped unique index
// Ensures `email` is unique per organization.
// - `fields`: main unique field
// - `scopedTo`: scope for uniqueness (e.g., organizationId)
// - `options`: optional MongoDB index options (e.g., { sparse: true })
//
// Example:
// unique: [{ fields: ['email'], scopedTo: ['orgId'], options: { sparse: true } }]
usersSchema.plugin(softDeleteWithIndexesPlugin, {
  unique: [
    {fields: ['email'], scopedTo: ['organizations.organizationId']},
    {fields: ['phoneNo'], scopedTo: ['organizations.organizationId']},
  ],
});

// This plugin will hash the password before saving the user
usersSchema.plugin(hashPasswordPlugin);

usersSchema.virtual('currentActiveOrganization').get(function () {
  return this?.organizations?.find((org) => org.isActive) || null;
});

usersSchema.methods = {
  /**
   * Unified token generator for reset, verification, or invitation.
   * @param {'loginReset'|'verification'|'invitation'} type - Type of token to generate
   * @param {Object} [payload] - Optional custom payload
   * @returns {String} token
   */
  generateToken({type, payload}) {
    return jwtUtils.generateUserToken({user: this, type, payload});
  },
};

module.exports = mongoose.model('Users', usersSchema);
