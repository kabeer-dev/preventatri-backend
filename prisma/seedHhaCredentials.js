const {PrismaPg} = require('@prisma/adapter-pg');

const {PrismaClient} = require('../generated/prisma/client');
const {resolveDatabaseUrl} = require('../utils/awsSecretsManager');
const {encryptString} = require('../utils/encryptionUtils');

/**
 * Moves the single global HHAeXchange credential set into the organization it
 * belonged to, so that organization keeps syncing once credentials are stored
 * per organization.
 *
 * Run on its own, never through `prisma db seed`: that seed also replaces
 * checklist template sections, which deletes submission answers.
 *
 *   node --require dotenv/config prisma/seedHhaCredentials.js
 *
 * Reads HHAX_ORGANIZATION_ID, HHAX_APP_NAME, HHAX_APP_SECRET and HHAX_APP_KEY
 * from the environment, and needs ENCRYPTION_KEY. Does nothing when any of the
 * four is missing, when the organization does not exist, or when it already
 * has credentials.
 *
 * @returns {Promise<{organizationId: string}|null>} null when nothing changed
 */
async function seedHhaCredentials({prisma}) {
  const {
    HHAX_ORGANIZATION_ID: organizationId,
    HHAX_APP_NAME: appName,
    HHAX_APP_SECRET: appSecret,
    HHAX_APP_KEY: appKey,
  } = process.env;

  if (!organizationId || !appName || !appSecret || !appKey) return null;

  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Set it before storing HHAeXchange credentials.'
    );
  }

  const organization = await prisma.organization.findUnique({
    where: {id: organizationId},
    select: {id: true},
  });

  if (!organization) {
    // eslint-disable-next-line no-console -- Seed script output
    console.info(
      `HHAeXchange credentials: organization ${organizationId} not found. Nothing changed.`
    );

    return null;
  }

  const existing = await prisma.organizationHhaCredential.findUnique({
    where: {organizationId},
    select: {id: true},
  });

  if (existing) return null;

  // They worked as the global set, so the organization starts connected.
  await prisma.organizationHhaCredential.create({
    data: {
      organizationId,
      appName,
      encryptedAppSecret: encryptString({plainText: appSecret}),
      encryptedAppKey: encryptString({plainText: appKey}),
      isConnected: true,
    },
  });

  return {organizationId};
}

module.exports = {seedHhaCredentials};

/* eslint-disable no-console -- Script output */
if (require.main === module) {
  (async () => {
    const adapter = new PrismaPg({
      connectionString: await resolveDatabaseUrl(),
    });
    const prisma = new PrismaClient({adapter});

    try {
      const moved = await seedHhaCredentials({prisma});

      console.info(
        moved
          ? `Stored the HHAeXchange credentials for organization ${moved.organizationId}.`
          : 'Nothing to store: the four HHAX_* values are not all set, the organization was not found, or it already has credentials.'
      );
    } finally {
      await prisma.$disconnect();
    }
  })().catch((error) => {
    console.error('Storing the HHAeXchange credentials failed:', error.message);
    process.exitCode = 1;
  });
}
/* eslint-enable no-console */
