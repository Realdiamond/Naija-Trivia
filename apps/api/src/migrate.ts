/**
 * Plain SQL migrations, applied in file-name order, each in its own transaction.
 * 0001_initial.sql is docs/schema/schema.sql v1.1; from here on, migrations are the
 * source of truth and the docs describe them.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction, type Pool } from './db';

const MIGRATION_LOCK = 727_274;

export async function migrate(
  pool: Pool,
  directory = path.resolve(process.cwd(), 'migrations'),
): Promise<string[]> {
  const client = await pool.connect();
  try {
    // One migrator at a time, even with several API instances starting together.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );
    const files = (await readdir(directory)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      await withTransaction(pool, async (tx) => {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      });
      done.push(file);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
