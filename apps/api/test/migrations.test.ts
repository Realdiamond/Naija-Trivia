import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('database', () => {
  it('is migrated once and re-running is a no-op', async () => {
    const versions = (await t.pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version);
    const files = (await readdir(fileURLToPath(new URL('../migrations', import.meta.url))))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files[0]).toBe('0001_initial.sql');
    expect(versions).toEqual(files);
    expect(await migrate(t.pool, fileURLToPath(new URL('../migrations', import.meta.url)))).toEqual([]);
  });

  it('holds the 114 seed questions with the importer rules (q_ ids, d_rating = 1050 + 150 × level)', async () => {
    const row = (
      await t.pool.query(
        `SELECT count(*)::int AS n, bool_and(d_rating = 1050 + 150 * difficulty) AS ratings_ok,
                bool_and(id = 'q_' || lower(external_ref)) AS ids_ok FROM questions
          WHERE external_ref LIKE 'SEED-%'`,
      )
    ).rows[0];
    expect(row).toEqual({ n: 114, ratings_ok: true, ids_ok: true });
  });
});
