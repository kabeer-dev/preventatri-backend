const {MongoMemoryServer} = require('mongodb-memory-server');
const mongoose = require('mongoose');

const connectMockMongoose = async () => {
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  return mongoServer;
};

const disconnectMockMongoose = async ({mongoServer}) => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  await mongoServer.stop();
};

module.exports = {
  connectMockMongoose,
  disconnectMockMongoose,
};
