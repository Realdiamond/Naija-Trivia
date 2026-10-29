/**
 * Writes a Brotli (.br) and a gzip (.gz) copy next to each text file of a built web app, so the
 * API sends them compressed without spending the dyno's time on it (Data Saver, build plan step
 * 2.8b; @fastify/static's `preCompressed`). Copies that save less than 10% are left out.
 *
 *   node scripts/precompress.mjs <dir> [<dir> ...]
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const TEXT = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
  '.ttf',
  '.otf',
]);
const MIN_BYTES = 1024;
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (TEXT.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: node scripts/precompress.mjs <dir> [<dir> ...]');
  process.exit(1);
}

for (const dir of dirs) {
  let before = 0;
  let after = 0;
  let count = 0;
  for await (const file of files(dir)) {
    if ((await stat(file)).size < MIN_BYTES) continue;
    const data = await readFile(file);
    const [br, gz] = await Promise.all([
      brotli(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
        },
      }),
      gzip(data, { level: zlib.constants.Z_BEST_COMPRESSION }),
    ]);
    if (br.length < data.length * 0.9) await writeFile(`${file}.br`, br);
    if (gz.length < data.length * 0.9) await writeFile(`${file}.gz`, gz);
    before += data.length;
    after += Math.min(br.length, data.length);
    count++;
  }
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`${dir}: ${count} files, ${kb(before)} → ${kb(after)} with Brotli`);
}
