const {PrismaFactory} = require('../factories');

// Runs every query at once; results keep the array order.
async function runReportQueries({queries}) {
  const results = await Promise.all(
    queries.map((query) => PrismaFactory.aggregate({query}))
  );

  const failed = results.find(({success}) => !success);

  if (failed) throw failed.error || new Error('Report query failed');

  return results.map(({docs}) => docs || []);
}

module.exports = {runReportQueries};
