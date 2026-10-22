import type { FastifyInstance } from 'fastify';
import type { CategoriesResponse } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { listCategories } from './questions';

export function contentRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/categories', async (): Promise<CategoriesResponse> => ({
    categories: await listCategories(deps.pool),
  }));
}
