/**
 * Integration tests run against real Postgres and Redis: a throwaway database per run
 * (migrated and seeded with the seed questions as live) and Redis database 15.
 *   TEST_PG_ADMIN_URL  a login that can create databases (default postgres://postgres@127.0.0.1:5432/postgres)
 *   REDIS_URL          default redis://127.0.0.1:6379
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/migrate';
import { seedQuestions } from '../../src/seed';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
  const dbName = `whosabi_test_${randomBytes(4).toString('hex')}`;
  await runAdmin(adminUrl, `CREATE DATABASE ${dbName}`);

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool, here('../../migrations'));
    await seedQuestions(pool, await readFile(here('../../../../docs/content/seed-questions.csv'), 'utf8'), {
      live: true,
    });
  } finally {
    await pool.end();
  }

  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  redisUrl.pathname = '/15';
  const redis = new Redis(redisUrl.toString());
  await redis.flushdb();
  await redis.quit();

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redisUrl.toString());

  return async () => {
    await runAdmin(adminUrl, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  };
}

async function runAdmin(adminUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
