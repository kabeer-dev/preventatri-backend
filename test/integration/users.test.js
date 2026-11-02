const UsersModel = require('../../models/UsersModel');
const {
  disconnectMockMongoose,
  connectMockMongoose,
} = require('../utils/mockMongoose');
const {postRequest} = require('../utils/request');

describe('Users API testing', () => {
  let mongoServer;

  beforeAll(async () => {
    jest.setTimeout(60000);
    mongoServer = await connectMockMongoose();
    await UsersModel.create([
      {
        firstName: 'John1',
        lastName: 'Kail',
        email: 'john@mail.com',
        password: 'ABC@123@abc',
        phoneNo: '+1234567890',
      },
    ]);
  });

  afterAll(async () => {
    await disconnectMockMongoose({mongoServer});
  });

  test('Signup - Success', async () => {
    const response = await postRequest({
      requestUrl: '/api/v1/users/signup',
      payload: {
        firstName: 'John2',
        lastName: 'Kail',
        email: 'john2@mail.com',
        password: 'ABC@123@abc',
        phoneNo: '+1234567891',
      },
    });

    expect(response.body.message).toBe('User registered successfully');
    expect(response.status).toBe(201);
  });
});
