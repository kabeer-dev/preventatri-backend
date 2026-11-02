describe('databaseConnectionManager - rotateAndReconnect concurrency', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function createDeferred() {
    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return {promise, resolve, reject};
  }

  it('keeps Prisma client available while credential rotation is in flight', async () => {
    const resolveUrlDeferred = createDeferred();

    const firstBaseClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ok: 1}]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const secondBaseClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ok: 1}]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const prismaClientCtor = jest
      .fn()
      .mockImplementationOnce(() => firstBaseClient)
      .mockImplementationOnce(() => secondBaseClient);

    jest.doMock('config', () => ({
      get: jest.fn((key) => {
        if (key === 'database.monitoring.logQueries') return false;

        return undefined;
      }),
    }));

    jest.doMock('@prisma/adapter-pg', () => ({
      PrismaPg: jest.fn().mockImplementation(({connectionString}) => ({
        connectionString,
      })),
    }));

    jest.doMock('../../generated/prisma/client.ts', () => ({
      PrismaClient: prismaClientCtor,
    }));

    jest.doMock('../../utils/prismaExtended', () => ({
      createExtendedPrismaClient: jest
        .fn()
        .mockImplementation(({basePrisma}) => basePrisma),
    }));

    jest.doMock('../../utils/awsSecretsManager', () => ({
      resolveDatabaseUrl: jest
        .fn()
        .mockResolvedValueOnce('postgres://initial-url')
        .mockReturnValueOnce(resolveUrlDeferred.promise),
      invalidateSecretCache: jest.fn(),
    }));

    jest.doMock('../../middleware/loggerMiddleware', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const manager = require('../../utils/databaseConnectionManager');

    await manager.connectDatabase();

    const initialClient = manager.getPrismaClient();

    const rotationPromise = manager.rotateAndReconnect();

    expect(() => manager.getPrismaClient()).not.toThrow();
    expect(manager.getPrismaClient()).toBe(initialClient);

    resolveUrlDeferred.resolve('postgres://rotated-url');
    await rotationPromise;

    expect(manager.getPrismaClient()).toBe(secondBaseClient);
  });

  it('deduplicates concurrent rotateAndReconnect calls', async () => {
    const resolveUrlDeferred = createDeferred();

    const firstBaseClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ok: 1}]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const secondBaseClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ok: 1}]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const resolveDatabaseUrl = jest
      .fn()
      .mockResolvedValueOnce('postgres://initial-url')
      .mockReturnValueOnce(resolveUrlDeferred.promise);

    const prismaClientCtor = jest
      .fn()
      .mockImplementationOnce(() => firstBaseClient)
      .mockImplementationOnce(() => secondBaseClient);

    jest.doMock('config', () => ({
      get: jest.fn((key) => {
        if (key === 'database.monitoring.logQueries') return false;

        return undefined;
      }),
    }));

    jest.doMock('@prisma/adapter-pg', () => ({
      PrismaPg: jest.fn().mockImplementation(({connectionString}) => ({
        connectionString,
      })),
    }));

    jest.doMock('../../generated/prisma/client.ts', () => ({
      PrismaClient: prismaClientCtor,
    }));

    jest.doMock('../../utils/prismaExtended', () => ({
      createExtendedPrismaClient: jest
        .fn()
        .mockImplementation(({basePrisma}) => basePrisma),
    }));

    jest.doMock('../../utils/awsSecretsManager', () => ({
      resolveDatabaseUrl,
      invalidateSecretCache: jest.fn(),
    }));

    jest.doMock('../../middleware/loggerMiddleware', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const manager = require('../../utils/databaseConnectionManager');

    await manager.connectDatabase();

    const firstRotation = manager.rotateAndReconnect();
    const secondRotation = manager.rotateAndReconnect();

    resolveUrlDeferred.resolve('postgres://rotated-url');

    await Promise.all([firstRotation, secondRotation]);

    expect(resolveDatabaseUrl).toHaveBeenCalledTimes(2);
    expect(prismaClientCtor).toHaveBeenCalledTimes(2);
  });
});
