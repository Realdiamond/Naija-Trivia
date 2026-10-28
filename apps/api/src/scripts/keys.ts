/**
 * pnpm --filter @whosabi/api keys [heroku-app]   (or node dist/scripts/keys.js)
 *
 * New secrets for a staging or production API, printed as one `heroku config:set` command: the
 * ES256 key pair that signs access tokens, the analytics key, the key for sign-in codes and the
 * web push (VAPID) key. Run it once per environment and keep the output private. Changing the
 * token keys signs everyone out; changing the VAPID key turns web push off until each browser
 * subscribes again.
 */
import { randomBytes } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { newVapidKeys } from '../push/webpush';

const app = process.argv.slice(2).find((a) => a !== '--');
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
const lines = [
  `heroku config:set${app ? ` --app ${app}` : ''} \\`,
  `  JWT_PRIVATE_KEY="${(await exportPKCS8(privateKey)).trim()}" \\`,
  `  JWT_PUBLIC_KEY="${(await exportSPKI(publicKey)).trim()}" \\`,
  `  ANALYTICS_KEY=${randomBytes(32).toString('hex')} \\`,
  `  OTP_SECRET=${randomBytes(32).toString('hex')} \\`,
  `  VAPID_PRIVATE_KEY=${newVapidKeys('mailto:unused').privateKey}`,
];
console.log(lines.join('\n'));
