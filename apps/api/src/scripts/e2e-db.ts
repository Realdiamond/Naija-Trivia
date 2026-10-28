/**
 * pnpm --filter @whosabi/api db:e2e
 * Fresh state for the app's end-to-end tests: the database dropped, created, migrated and seeded
 * with the seed questions as live, and its Redis database emptied. Development and CI only.
 *   TEST_PG_ADMIN_URL  a login that can create databases
 *   E2E_DATABASE       the database to recreate (default whosabi_e2e)
 *   E2E_REDIS_URL      the Redis database to empty (default redis://127.0.0.1:6379/14)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import pg from 'pg';
import { migrate } from '../migrate';
import { seedQuestions } from '../seed';

if (process.env.NODE_ENV === 'production') throw new Error('db:e2e is for development and CI only');
const adminUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const dbName = process.env.E2E_DATABASE ?? 'whosabi_e2e';
if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`E2E_DATABASE must be a plain name, got ${dbName}`);

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
} finally {
  await admin.end();
}

const url = new URL(adminUrl);
url.pathname = `/${dbName}`;
const pool = new pg.Pool({ connectionString: url.toString() });
try {
  await migrate(pool, fileURLToPath(new URL('../../migrations', import.meta.url)));
  const csv = await readFile(
    fileURLToPath(new URL('../../../../docs/content/seed-questions.csv', import.meta.url)),
    'utf8',
  );
  const seeded = await seedQuestions(pool, csv, { live: true });
  console.log(`${dbName}: migrated, ${seeded.inserted} live questions`);
} finally {
  await pool.end();
}

const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14');
await redis.flushdb();
await redis.quit();
