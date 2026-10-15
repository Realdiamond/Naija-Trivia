/**
 * pnpm --filter @whosabi/api db:seed [path/to/questions.csv] [--live]
 * --live makes the questions playable immediately; development only.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../db';
import { seedQuestions } from '../seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const args = process.argv.slice(2);
const live = args.includes('--live');
if (live && process.env.NODE_ENV === 'production') {
  throw new Error('--live skips content review and is not allowed in production');
}
const csvPath =
  args.find((a) => !a.startsWith('--')) ??
  path.resolve(process.cwd(), '../../docs/content/seed-questions.csv');

const pool = createPool(url);
try {
  const result = await seedQuestions(pool, await readFile(csvPath, 'utf8'), { live });
  console.log(
    `Seeded ${result.inserted} questions (${result.skipped} already present)${live ? ' as live' : ' as drafts'}.`,
  );
} finally {
  await pool.end();
}
