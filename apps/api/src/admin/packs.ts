/**
 * Packs in the console's Content module (doc 18 §12, build plan step 2.8f). Everyone with
 * `content.view` sees them; editors, admins and owners (`content.publish`) make and change them
 * and choose their questions by id or reference. Packs are switched off, never deleted, so
 * unlocks and practice results keep their pack. Every change is audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { watDate } from '@whosabi/game-rules';
import {
  AdminPackInput,
  AdminPackQuestionsAdd,
  ErrorCode,
  type AdminPack,
  type AdminPackDetail,
  type AdminPackQuestionsAdded,
  type AdminPacksResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { conflict, notFound, parse } from '../errors';
import { newId } from '../ids';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const Params = z.object({ id: z.string().min(3).max(40) });
const QuestionParams = Params.extend({ qid: z.string().min(1).max(40) });
/** The chosen questions the pack page lists. */
const SHOWN_QUESTIONS = 300;

interface PackRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  access: AdminPack['access'];
  price_coins: number | null;
  category_id: AdminPack['category_id'];
  starts_at: Date | null;
  ends_at: Date | null;
  active: boolean;
  chosen: number;
  live: number;
  updated_at: Date;
}

const packShown = (p: PackRow): AdminPack => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  access: p.access,
  price_coins: p.price_coins,
  category_id: p.category_id,
  starts_at: p.starts_at?.toISOString() ?? null,
  ends_at: p.ends_at?.toISOString() ?? null,
  active: p.active,
  chosen: p.chosen,
  live: p.live,
  updated_at: p.updated_at.toISOString(),
});

/** What players can get from each pack now, family-safe or not and Dailies aside. */
const PACK_COLUMNS = `p.id, p.slug, p.title, p.description, p.access, p.price_coins, p.category_id, p.starts_at,
  p.ends_at, p.active, p.updated_at,
  (SELECT count(*)::int FROM pack_questions pq WHERE pq.pack_id = p.id) AS chosen,
  (SELECT count(*)::int FROM questions q
    WHERE q.status = 'live' AND q.type IN ('mcq4', 'true_false')
      AND (q.valid_until IS NULL OR q.valid_until >= $1::date)
      AND EXISTS (SELECT 1 FROM categories c WHERE c.id = q.category_id AND c.active)
      AND (q.category_id = p.category_id
           OR EXISTS (SELECT 1 FROM pack_questions pq WHERE pq.pack_id = p.id AND pq.question_id = q.id))) AS live`;

const slugTaken = () =>
  conflict(ErrorCode.conflict, 'That short name is taken', 'Another pack uses it: choose another.');

export function adminPackRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock } = deps;

  const loadPack = async (id: string): Promise<PackRow> => {
    const row = (
      await pool.query<PackRow>(`SELECT ${PACK_COLUMNS} FROM packs p WHERE p.id = $2`, [
        watDate(clock.now()),
        id,
      ])
    ).rows[0];
    if (!row) throw notFound('No such pack.');
    return row;
  };

  app.get('/admin/packs', async (request): Promise<AdminPacksResponse> => {
    await requireAdmin(request, ctx, 'content.view');
    const rows = await pool.query<PackRow>(
      `SELECT ${PACK_COLUMNS} FROM packs p LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.category_id IS NOT NULL, c.sort_order, p.created_at DESC, p.id`,
      [watDate(clock.now())],
    );
    return { packs: rows.rows.map(packShown) };
  });

  app.get('/admin/packs/:id', async (request): Promise<AdminPackDetail> => {
    await requireAdmin(request, ctx, 'content.view');
    const { id } = parse(Params, request.params);
    const pack = await loadPack(id);
    const questions = await pool.query<AdminPackDetail['questions'][number]>(
      `SELECT q.id, q.external_ref, q.text, q.category_id, q.status::text AS status
         FROM pack_questions pq JOIN questions q ON q.id = pq.question_id
        WHERE pq.pack_id = $1 ORDER BY q.created_at DESC, q.id LIMIT ${SHOWN_QUESTIONS}`,
      [id],
    );
    return { pack: packShown(pack), questions: questions.rows };
  });

  app.post('/admin/packs', async (request, reply): Promise<AdminPack> => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    const input = parse(AdminPackInput, request.body);
    const now = clock.now();
    const id = newId('pk', now);
    const inserted = await pool.query(
      `INSERT INTO packs (id, slug, title, description, access, price_coins, category_id, starts_at, ends_at, active,
                          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) ON CONFLICT (slug) DO NOTHING`,
      [
        id,
        input.slug,
        input.title,
        input.description,
        input.access,
        input.price_coins,
        input.category_id,
        input.starts_at,
        input.ends_at,
        input.active,
        new Date(now),
      ],
    );
    if (inserted.rowCount === 0) throw slugTaken();
    await writeAudit(pool, {
      actor: admin.id,
      action: 'create_pack',
      entity: 'pack',
      entityId: id,
      after: input,
      ip: request.ip,
    });
    reply.code(201);
    return packShown(await loadPack(id));
  });

  app.put('/admin/packs/:id', async (request): Promise<AdminPack> => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    const { id } = parse(Params, request.params);
    const input = parse(AdminPackInput, request.body);
    const before = await loadPack(id);
    const taken = await pool.query('SELECT 1 FROM packs WHERE slug = $1 AND id <> $2', [input.slug, id]);
    if ((taken.rowCount ?? 0) > 0) throw slugTaken();
    await pool.query(
      `UPDATE packs SET slug = $2, title = $3, description = $4, access = $5, price_coins = $6, category_id = $7,
              starts_at = $8, ends_at = $9, active = $10, updated_at = $11
        WHERE id = $1`,
      [
        id,
        input.slug,
        input.title,
        input.description,
        input.access,
        input.price_coins,
        input.category_id,
        input.starts_at,
        input.ends_at,
        input.active,
        new Date(clock.now()),
      ],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'update_pack',
      entity: 'pack',
      entityId: id,
      before: packShown(before),
      after: input,
      ip: request.ip,
    });
    return packShown(await loadPack(id));
  });

  /** Adds questions by id or reference; ones already in, and ones we don't know, are reported. */
  app.post('/admin/packs/:id/questions', async (request): Promise<AdminPackQuestionsAdded> => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    const { id } = parse(Params, request.params);
    const refs = [...new Set(parse(AdminPackQuestionsAdd, request.body).refs)];
    await loadPack(id);
    const found = await pool.query<{ id: string; ref: string }>(
      `SELECT q.id, r AS ref FROM unnest($1::text[]) AS r
         JOIN questions q ON q.id = r OR q.external_ref = r`,
      [refs],
    );
    const ids = [...new Set(found.rows.map((r) => r.id))];
    const added = await pool.query(
      `INSERT INTO pack_questions (pack_id, question_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [id, ids],
    );
    const known = new Set(found.rows.map((r) => r.ref));
    const result: AdminPackQuestionsAdded = {
      added: added.rowCount ?? 0,
      already: ids.length - (added.rowCount ?? 0),
      unknown: refs.filter((r) => !known.has(r)),
    };
    if (result.added > 0) {
      await pool.query('UPDATE packs SET updated_at = $2 WHERE id = $1', [id, new Date(clock.now())]);
      await writeAudit(pool, {
        actor: admin.id,
        action: 'add_pack_questions',
        entity: 'pack',
        entityId: id,
        after: { questions: ids, added: result.added },
        ip: request.ip,
      });
    }
    return result;
  });

  app.delete('/admin/packs/:id/questions/:qid', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'content.publish');
    const { id, qid } = parse(QuestionParams, request.params);
    const removed = await pool.query('DELETE FROM pack_questions WHERE pack_id = $1 AND question_id = $2', [
      id,
      qid,
    ]);
    if (removed.rowCount === 0) throw notFound('That question is not in this pack.');
    await pool.query('UPDATE packs SET updated_at = $2 WHERE id = $1', [id, new Date(clock.now())]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'remove_pack_question',
      entity: 'pack',
      entityId: id,
      before: { question: qid },
      ip: request.ip,
    });
    return reply.code(204).send();
  });
}
