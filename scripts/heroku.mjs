/**
 * Heroku entry points (build plan step 1.6, docs/deploy/heroku.md). One repository makes two
 * Heroku apps, told apart by WHOSABI_APP:
 *   game   (default)  web: the API, serving the web app and the event intake from one origin;
 *                     worker: the worker; release: database migrations
 *   admin             web: the admin console
 *
 *   node scripts/heroku.mjs build | release | web | worker
 * package.json's heroku-postbuild runs `build`; the Procfile runs the others.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.WHOSABI_APP ?? 'game';
const step = process.argv[2];
const api = path.join(repo, 'apps/api');
const admin = path.join(repo, 'apps/admin');

const plans = {
  game: {
    build: [
      ['pnpm', ['--filter', '@whosabi/api', 'build']],
      // The web app talks to its own origin, so its API and event URLs are empty.
      [
        'pnpm',
        ['--filter', '@whosabi/app', 'build:web'],
        { env: { EXPO_PUBLIC_API_URL: '', EXPO_PUBLIC_EVENTS_URL: '', EXPO_NO_TELEMETRY: '1' } },
      ],
      // The light party client for /r/{CODE} links (step 2.2c), also on this origin.
      ['pnpm', ['--filter', '@whosabi/web-guest', 'build'], { env: { VITE_API_URL: '' } }],
      // Brotli and gzip copies of both, served as they are (Data Saver, step 2.8b).
      ['node', ['scripts/precompress.mjs', 'apps/app/web-build', 'apps/web-guest/dist']],
    ],
    release: [['node', ['dist/scripts/migrate.js'], { cwd: api }]],
    web: [
      [
        'node',
        ['dist/server.js'],
        {
          cwd: api,
          env: {
            WEB_APP_DIR: process.env.WEB_APP_DIR ?? path.join(repo, 'apps/app/web-build'),
            WEB_GUEST_DIR: process.env.WEB_GUEST_DIR ?? path.join(repo, 'apps/web-guest/dist'),
            EVENTS_IN_API: process.env.EVENTS_IN_API ?? 'true',
          },
        },
      ],
    ],
    worker: [['node', ['dist/worker.js'], { cwd: api }]],
  },
  admin: {
    build: [['pnpm', ['--filter', '@whosabi/admin', 'build'], { env: { NEXT_TELEMETRY_DISABLED: '1' } }]],
    release: [],
    web: [
      [
        'node',
        [
          createRequire(path.join(admin, 'package.json')).resolve('next/dist/bin/next'),
          'start',
          '--port',
          process.env.PORT ?? '3002',
        ],
        { cwd: admin, env: { NEXT_TELEMETRY_DISABLED: '1' } },
      ],
    ],
    worker: [],
  },
};

const plan = plans[app]?.[step];
if (!plan) {
  console.error(
    `Unknown WHOSABI_APP "${app}" or step "${step}". Use game|admin and build|release|web|worker.`,
  );
  process.exit(1);
}
if (plan.length === 0) console.log(`${app}: nothing to do for ${step}.`);

for (const [command, args, options = {}] of plan) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repo,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });
  // Heroku stops dynos with SIGTERM; pass it on so servers shut down cleanly.
  const forward = (signal) => child.kill(signal);
  process.on('SIGTERM', forward);
  process.on('SIGINT', forward);
  const code = await new Promise((resolve) =>
    child.on('exit', (status, signal) => resolve(status ?? (signal ? 0 : 1))),
  );
  process.off('SIGTERM', forward);
  process.off('SIGINT', forward);
  if (code !== 0) process.exit(code);
}
