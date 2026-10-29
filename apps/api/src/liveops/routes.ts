/** `GET /v1/config` (step 2.7c): the flags as they apply to the caller, and the status banner. */
import type { FastifyInstance } from 'fastify';
import type { ClientConfig } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { audienceOf } from './store';

export function liveOpsRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Signed in or not (the welcome screens ask too); apps look again every `refresh_s`.
  app.get(
    '/v1/config',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request, reply): Promise<ClientConfig> => {
      void reply.header('cache-control', 'no-store');
      return deps.liveops.forClient(audienceOf(request));
    },
  );
}
