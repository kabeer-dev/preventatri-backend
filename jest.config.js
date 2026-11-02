/** @returns {Promise<import('jest').Config>} */
module.exports = async () => {
  return {
    testEnvironment: 'node',
    verbose: true,
    testTimeout: 20000,
    testPathIgnorePatterns: [
      '/node_modules/',
      'optional-features/mongodb-pipeline-to-sql-converter',
      'optional-features/aggregation-pipeline.test.js',
    ],
  };
};
