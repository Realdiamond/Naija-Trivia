/**
 * pnpm --filter @whosabi/api keys [heroku-app]   (or node dist/scripts/keys.js)
 *
 * New secrets for a staging or production API: the ES256 key pair that signs access tokens and
 * the analytics key, printed as one `heroku config:set` command. Run it once per environment and
 * keep the output private; changing the keys signs everyone out.
 */
import { randomBytes } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const app = process.argv.slice(2).find((a) => a !== '--');
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
const lines = [
  `heroku config:set${app ? ` --app ${app}` : ''} \\`,
  `  JWT_PRIVATE_KEY="${(await exportPKCS8(privateKey)).trim()}" \\`,
  `  JWT_PUBLIC_KEY="${(await exportSPKI(publicKey)).trim()}" \\`,
  `  ANALYTICS_KEY=${randomBytes(32).toString('hex')}`,
];
console.log(lines.join('\n'));
