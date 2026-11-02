import {createRequire} from 'node:module';
import path from 'node:path';
import 'dotenv/config';
import {defineConfig} from 'prisma/config';

// Only resolve the real database URL when env vars are available (runtime).
// During build (e.g. prisma generate), neither DATABASE_URL nor RDS_SECRET_NAME
// is set — a placeholder is sufficient since generate only needs the schema.
const hasDbConfig =
  Boolean(process.env.DATABASE_URL) || Boolean(process.env.RDS_SECRET_NAME);

let dbUrl: string;

if (hasDbConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const {resolveDatabaseUrl}: any =
    await import('./utils/awsSecretsManager.js');
  dbUrl = await resolveDatabaseUrl();
} else {
  const require = createRequire(import.meta.url);
  const config = require('config');
  dbUrl = config.get('database.placeholderUrl');
}

export default defineConfig({
  // Main schema file location
  schema: path.join('prisma', 'schema.prisma'),

  // Migration configuration
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node prisma/seed.js',
  },

  // Database connection
  datasource: {
    url: dbUrl,
  },
});
