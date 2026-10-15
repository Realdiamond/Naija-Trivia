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
    expect(versions).toEqual(['0001_initial.sql']);
    expect(await migrate(t.pool, fileURLToPath(new URL('../migrations', import.meta.url)))).toEqual([]);
  });

  it('holds the 104 seed questions with the importer rules (q_ ids, d_rating = 1050 + 150 × level)', async () => {
    const row = (
      await t.pool.query(
        `SELECT count(*)::int AS n, bool_and(d_rating = 1050 + 150 * difficulty) AS ratings_ok,
                bool_and(id = 'q_' || lower(external_ref)) AS ids_ok FROM questions`,
      )
    ).rows[0];
    expect(row).toEqual({ n: 104, ratings_ok: true, ids_ok: true });
  });
});
