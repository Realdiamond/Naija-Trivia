/**
 * The API for end-to-end tests (the app's and the admin console's): resets its database and
 * Redis (db:e2e), then runs the API from source, and the worker too with E2E_WITH_WORKER=1.
 * Logs go to e2e/.output/ under the directory it is started from, where tests read sign-in codes.
 *   TEST_PG_ADMIN_URL  a login that can create databases (as for the API's own tests)
 *   E2E_API_PORT       default 3100; E2E_WEB_ORIGIN default http://localhost:8082
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(process.cwd(), 'e2e', '.output');
const adminUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14';
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = '/whosabi_e2e';

const run = (args, env, stdio) =>
  spawn('pnpm', ['--filter', '@whosabi/api', ...args], { cwd: repo, env: { ...process.env, ...env }, stdio });

const reset = run(['db:e2e'], { E2E_DATABASE: 'whosabi_e2e', E2E_REDIS_URL: redisUrl }, 'inherit');
const code = await new Promise((resolve) => reset.on('exit', resolve));
if (code !== 0) process.exit(code ?? 1);

const env = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  PORT: process.env.E2E_API_PORT ?? '3100',
  DATABASE_URL: databaseUrl.toString(),
  REDIS_URL: redisUrl,
  CORS_ORIGINS: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:8082',
  PUBLIC_WEB_URL: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:8082',
  GUEST_SIGNUPS_PER_IP_PER_HOUR: '10000',
  OTP_SENDS_PER_IP_PER_HOUR: '10000',
};

mkdirSync(output, { recursive: true });
const children = [];
function start(name, entry) {
  const log = createWriteStream(path.join(output, `${name}.log`));
  const child = run(['exec', 'tsx', entry], env, ['ignore', 'pipe', 'pipe']);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.stderr.pipe(process.stderr);
  child.on('exit', (status) => {
    for (const other of children) if (other !== child) other.kill('SIGTERM');
    process.exit(status ?? 0);
  });
  children.push(child);
}

start('api', 'src/server.ts');
if (process.env.E2E_WITH_WORKER === '1') start('worker', 'src/worker.ts');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}
