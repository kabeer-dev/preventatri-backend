const {getPrismaClient} = require('./databaseConnectionManager');

/**
 * Wraps database operations in a Prisma transaction
 * Replaces Mongoose session-based transactions
 * @param {Function} fn - Async function to execute within transaction, receives tx object
 * @returns {Promise} Result of the function
 *
 * @example
 * const result = await wrapWithPrismaTransaction({
 *   fn: async (tx) => {
 *     const user = await UsersServices.createUser({data, tx});
 *     const org = await createOrganization({data, tx});
 *     return {user, org};
 *   }
 * });
 */
module.exports.wrapWithPrismaTransaction = async ({fn, timeout = 15000}) => {
  return await getPrismaClient().$transaction(
    async (tx) => {
      // Pass tx (transaction client) to callback
      // All DB operations inside fn MUST use tx parameter
      return await fn(tx);
    },
    {timeout}
  );
};

/**
 * Execute multiple operations in a single transaction
 * @param {Array<Function>} operations - Array of async functions to execute
 * @returns {Promise<Array>} Results of all operations
 */
module.exports.executeInTransaction = async ({operations}) => {
  return await getPrismaClient().$transaction(async (tx) => {
    const results = [];
    for (const operation of operations) {
      results.push(await operation(tx));
    }

    return results;
  });
};
