const crypto = require('crypto');

// Helper to sort object keys recursively for consistent hashing
const sortObject = ({obj}) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  return Object.keys(obj)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortObject({obj: obj[key]});

      return sorted;
    }, {});
};

// Generate idempotency key from request signature
const generateIdempotencyKey = ({req}) => {
  const userId = req.extra.jwtToken.user.id;
  const params = JSON.stringify(sortObject({obj: req.params || {}}));
  const query = JSON.stringify(sortObject({obj: req.query || {}}));
  const body = JSON.stringify(sortObject({obj: req.body || {}}));
  const method = req.method;
  const path = req.path || req.url;

  // Create a unique signature
  const signature = `${userId}:${method}:${path}:${params}:${query}:${body}`;

  // Generate hash for consistent key length (crypto is Node.js built-in)
  return crypto.createHash('sha256').update(signature).digest('hex');
};

module.exports = {
  sortObject,
  generateIdempotencyKey,
};
