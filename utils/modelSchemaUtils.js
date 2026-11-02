/**
 * Model Schema Utility Functions
 * Provides easy access to centralized model schema configurations
 * Enables dynamic field and relation handling without hardcoded checks
 */

const {MODEL_SCHEMA_CONFIG} = require('../constants/modelSchemaConfig');

/**
 * Get default fields for a model
 * @param {string} model - Model name (from modelConstants.MODELS)
 * @returns {Array} Array of field names to include by default
 */
module.exports.getModelDefaultFields = ({model}) => {
  return MODEL_SCHEMA_CONFIG[model]?.defaultFields || [];
};

/**
 * Get relation template for a model
 * @param {string} model - Model name
 * @param {string} relationName - Relation field name (e.g., 'userOrganizations')
 * @returns {Object} Prisma select template for the relation
 */
module.exports.getRelationTemplate = ({model, relationName}) => {
  return MODEL_SCHEMA_CONFIG[model]?.relations?.[relationName];
};

/**
 * Get all relation names for a model
 * @param {string} model - Model name
 * @returns {Array} Array of relation field names
 */
module.exports.getModelRelationNames = ({model}) => {
  return Object.keys(MODEL_SCHEMA_CONFIG[model]?.relations || {});
};

/**
 * Get relations that should be auto-included for a model
 * @param {string} model - Model name
 * @returns {Array} Array of relation names to auto-include
 */
module.exports.getAutoIncludeRelations = ({model}) => {
  return MODEL_SCHEMA_CONFIG[model]?.autoIncludeRelations || [];
};

/**
 * Check if a model has relations
 * @param {string} model - Model name
 * @returns {boolean}
 */
module.exports.hasModelRelations = ({model}) => {
  return Object.keys(MODEL_SCHEMA_CONFIG[model]?.relations || {}).length > 0;
};

/**
 * Get complete model schema config
 * @param {string} model - Model name
 * @returns {Object} Complete schema config for the model
 */
module.exports.getModelSchemaConfig = ({model}) => {
  return MODEL_SCHEMA_CONFIG[model];
};

/**
 * Get model-specific field mappings (legacy names to Prisma field names)
 * Field mappings are model-specific to avoid conflicts when scaling to new models
 * @param {string} model - Model name (from modelConstants.MODELS)
 * @returns {Object} Field mappings for this specific model
 *
 * Example: User model maps 'organizations' → 'userOrganizations'
 * Future models can define their own mappings without affecting other models
 */
module.exports.getFieldMappings = ({model}) => {
  return MODEL_SCHEMA_CONFIG[model]?.fieldMappings || {};
};

/**
 * Get dependent relations for a specific relation
 * Returns relations that should be auto-included when this relation is requested
 * @param {string} model - Model name
 * @param {string} relationName - Relation field name
 * @returns {Array} Array of dependent relation names
 */
module.exports.getRelationDependencies = ({model, relationName}) => {
  return MODEL_SCHEMA_CONFIG[model]?.relationDependencies?.[relationName] || [];
};
