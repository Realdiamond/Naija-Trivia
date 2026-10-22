import { createPool } from '../db';
import { migrate } from '../migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const pool = createPool(url);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}
