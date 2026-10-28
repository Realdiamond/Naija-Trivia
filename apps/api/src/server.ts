import { buildApp } from './app';
import { createTokenService } from './auth/tokens';
import { systemClock } from './clock';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { createRedis } from './redis';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedis(config, { maxRetriesPerRequest: 2 });
const tokens = await createTokenService(
  { privateKeyPem: config.jwtPrivateKeyPem, publicKeyPem: config.jwtPublicKeyPem },
  systemClock.now,
);

if (config.env !== 'production') await migrate(pool);
const app = await buildApp({ config, pool, redis, tokens, clock: systemClock });
if (!config.jwtPrivateKeyPem)
  app.log.warn('Using a throwaway signing key: sessions end when the API restarts.');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
