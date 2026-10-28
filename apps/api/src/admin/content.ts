/**
 * The admin API, part three: the Content module (doc 18 §12). Questions and their workflow, the
 * CSV import and the player reports queue. Permissions are checked here and again per question
 * (writers only see their own); every change goes in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminBulkPublishRequest,
  AdminImportRequest,
  AdminQuestionActionRequest,
  AdminQuestionInput,
  AdminQuestionListQuery,
  AdminResolveReports,
  ErrorCode,
  type AdminBulkPublishResponse,
  type AdminImportResponse,
  type AdminQuestion,
  type AdminQuestionListResponse,
  type AdminReportsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { QuestionBank } from '../content/bank';
import { importQuestions } from '../content/import';
import { reportQueue, resolveReports } from '../content/reports';
import { ApiError, parse } from '../errors';
import { requireAdmin, type AdminDeps } from './context';

const QuestionParams = z.object({ id: z.string().min(3).max(60) });

export function adminContentRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock } = deps;
  const bank = new QuestionBank({ pool, now: clock.now });

  app.get('/admin/questions', async (request): Promise<AdminQuestionListResponse> => {
    const admin = await requireAdmin(request, ctx, 'content.view');
    return bank.list(parse(AdminQuestionListQuery, request.query), admin);
  });

  app.post('/admin/questions', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'content.write');
    const id = await bank.create(parse(AdminQuestionInput, request.body), admin, request.ip);
    return reply.code(201).send(await bank.detail(id, admin));
  });

  app.get('/admin/questions/:id', async (request): Promise<AdminQuestion> => {
    const admin = await requireAdmin(request, ctx, 'content.view');
    return bank.detail(parse(QuestionParams, request.params).id, admin);
  });

  app.put('/admin/questions/:id', async (request): Promise<AdminQuestion> => {
    const admin = await requireAdmin(request, ctx, 'content.write');
    const { id } = parse(QuestionParams, request.params);
    await bank.update(id, parse(AdminQuestionInput, request.body), admin, request.ip);
    return bank.detail(id, admin);
  });

  app.post('/admin/questions/:id/actions', async (request): Promise<AdminQuestion> => {
    const admin = await requireAdmin(request, ctx, 'content.view');
    const { id } = parse(QuestionParams, request.params);
    const { action, note } = parse(AdminQuestionActionRequest, request.body);
    await bank.act(id, action, note, admin, request.ip);
    return bank.detail(id, admin);
  });

  app.post('/admin/questions/publish', async (request): Promise<AdminBulkPublishResponse> => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    return bank.publishMany(parse(AdminBulkPublishRequest, request.body).ids, admin, request.ip);
  });

  // A question-bank category file is a few hundred kilobytes; the default limit is 64 KB.
  app.post(
    '/admin/questions/import',
    { bodyLimit: 3 * 1024 * 1024 },
    async (request): Promise<AdminImportResponse> => {
      const admin = await requireAdmin(request, ctx, 'content.import');
      const body = parse(AdminImportRequest, request.body);
      if (body.publish_approved && !admin.permissions.includes('content.publish')) {
        throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', 'Only an editor can publish on import.');
      }
      return importQuestions(pool, body.csv, {
        dryRun: body.dry_run,
        publishApproved: body.publish_approved,
        actor: admin.id,
        ip: request.ip,
        now: clock.now(),
      });
    },
  );

  app.get('/admin/reports', async (request): Promise<AdminReportsResponse> => {
    await requireAdmin(request, ctx, 'content.view');
    return reportQueue(pool);
  });

  app.post('/admin/questions/:id/reports/resolve', async (request): Promise<AdminQuestion> => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    const { id } = parse(QuestionParams, request.params);
    const { resolution, note } = parse(AdminResolveReports, request.body);
    await resolveReports(pool, {
      questionId: id,
      resolution,
      note: note ?? null,
      actor: admin.id,
      ip: request.ip,
      now: clock.now(),
    });
    return bank.detail(id, admin);
  });
}
