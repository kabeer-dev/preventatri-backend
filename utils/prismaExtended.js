const bcryptUtils = require('./bcryptUtils');
const {safeMerge} = require('./general');
const {modelConstants} = require('../constants');
const {MODELS_WITH_SOFT_DELETE} = require('../constants/modelSchemaConfig');

/**
 * Prisma Client Extensions for Prisma 7
 *
 * This module provides Client Extensions that replace the deprecated $use() middleware.
 * Features:
 * - Soft-delete filtering extension
 * - Password hashing extension
 *
 * NOTE: Prisma 7 removed $use() middleware in favor of $extends() API.
 * This is more type-safe and provides better query interception.
 */
/**
 * Hash password if it's plaintext (doesn't start with bcrypt prefix '$2')
 * @param {string} passwordValue - The password to hash
 * @returns {Promise<string|null>} Hashed password or null if already hashed
 */
async function hashPasswordIfPlaintext({passwordValue}) {
  if (!passwordValue || typeof passwordValue !== 'string') {
    return null;
  }

  // Only hash if it looks like plain text (doesn't start with bcrypt prefix '$2')
  if (passwordValue.startsWith('$2')) {
    return null;
  }

  return bcryptUtils.hashString({string: passwordValue});
}

/**
 * Process password hashing for direct assignment syntax: password: 'plaintext'
 */
async function hashDirectPasswordAssignment({data}) {
  const hashed = await hashPasswordIfPlaintext({
    passwordValue: data?.password,
  });
  if (hashed) {
    data.password = hashed;
  }
}

/**
 * Process password hashing for field-operation syntax: password: { set: 'plaintext' }
 */
async function hashFieldOperationPassword({data}) {
  if (
    data?.password &&
    typeof data.password === 'object' &&
    data.password.set &&
    typeof data.password.set === 'string'
  ) {
    const hashed = await hashPasswordIfPlaintext({
      passwordValue: data.password.set,
    });
    if (hashed) {
      data.password.set = hashed;
    }
  }
}

/**
 * Process password hashing for updateMany array syntax: [{ password: 'plaintext' }]
 */
async function hashArrayPasswordUpdates({data}) {
  if (Array.isArray(data)) {
    return Promise.all(
      data.map(async (item) => {
        if (item.password) {
          const hashed = await hashPasswordIfPlaintext({
            passwordValue: item.password,
          });
          if (hashed) {
            return safeMerge({
              originalObj: item,
              newObj: {password: hashed},
            });
          }
        }

        return item;
      })
    );
  }

  return data;
}

/**
 * Creates soft-delete extension for Prisma 7
 * Note: We pass the basePrisma client to avoid circular imports
 * @param {Object} basePrisma - The base PrismaClient instance for delete/updateMany conversions
 */
function createSoftDeleteExtension({basePrisma}) {
  return {
    query: {
      $allModels: {
        async $allOperations({model, operation, args, query}) {
          // Skip for models without soft delete
          if (!MODELS_WITH_SOFT_DELETE.includes(model)) {
            return query(args);
          }

          // Skip for Idempotency model
          if (model === modelConstants.MODELS.IDEMPOTENCY) {
            return query(args);
          }

          // Check if client explicitly wants to include soft-deleted records
          const includeDeleted =
            args?.includeDeleted === true || args?.includeSoftDeleted === true;

          // Strip custom options before passing to Prisma
          if (args) {
            delete args.includeDeleted;
            delete args.includeSoftDeleted;
          }

          if (includeDeleted) {
            return query(args);
          }

          // Read operations - add isDeleted: null filter
          if (
            [
              'findUnique',
              'findUniqueOrThrow',
              'findFirst',
              'findFirstOrThrow',
              'findMany',
              'count',
              'aggregate',
            ].includes(operation)
          ) {
            args.where = safeMerge({
              originalObj: args?.where || {},
              newObj: {isDeleted: null},
            });
          }

          // Update operations - only update non-deleted records
          if (['update', 'updateMany', 'upsert'].includes(operation)) {
            args.where = safeMerge({
              originalObj: args?.where || {},
              newObj: {isDeleted: null},
            });
          }

          // Delete operations - convert to soft delete
          if (operation === 'delete') {
            // Convert delete to update with isDeleted timestamp
            const where = safeMerge({
              originalObj: args?.where || {},
              newObj: {isDeleted: null},
            });

            // Use passed basePrisma to avoid circular import
            const modelName = model.charAt(0).toLowerCase() + model.slice(1);

            return basePrisma[modelName].update({
              where,
              data: {isDeleted: new Date()},
            });
          }

          if (operation === 'deleteMany') {
            const where = safeMerge({
              originalObj: args?.where || {},
              newObj: {isDeleted: null},
            });

            const modelName = model.charAt(0).toLowerCase() + model.slice(1);

            return basePrisma[modelName].updateMany({
              where,
              data: {isDeleted: new Date()},
            });
          }

          return query(args);
        },
      },
    },
  };
}

/**
 * Password hashing extension for User model
 * Automatically hashes plaintext passwords before persistence
 */
const passwordHashExtension = {
  query: {
    user: {
      async create({args, query}) {
        await hashDirectPasswordAssignment({data: args.data});

        return query(args);
      },

      async update({args, query}) {
        await hashDirectPasswordAssignment({data: args.data});
        await hashFieldOperationPassword({data: args.data});

        return query(args);
      },

      async updateMany({args, query}) {
        await hashDirectPasswordAssignment({data: args.data});
        await hashFieldOperationPassword({data: args.data});
        args.data = await hashArrayPasswordUpdates({data: args.data});

        return query(args);
      },
    },
  },
};

/**
 * Create an extended Prisma client with all middleware as extensions
 * @param {Object} basePrisma - The base PrismaClient instance
 * @returns {Object} Extended PrismaClient with soft-delete and password hashing
 */

function createExtendedPrismaClient({basePrisma}) {
  // Create soft-delete extension with reference to base client for conversions

  const softDeleteExtension = createSoftDeleteExtension({basePrisma});

  return basePrisma
    .$extends(softDeleteExtension)
    .$extends(passwordHashExtension);
}

module.exports = {
  createExtendedPrismaClient,
  createSoftDeleteExtension,
  passwordHashExtension,
};
