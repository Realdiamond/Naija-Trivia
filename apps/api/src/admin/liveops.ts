/**
 * LiveOps in the console (doc 18 §8 and §11, build plan step 2.7c): flags and kill switches, and
 * the in-app status banner. Owners, admins, LiveOps and on-call engineers (`liveops.flags`);
 * every change needs a reason, goes in the audit log, and a kill switch flipped is announced to
 * the staff alerts. The banner's history is in `config_history`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KILL_SWITCHES } from '@whosabi/game-rules';
import {
  AdminBannerUpdate,
  AdminFlagUpdate,
  StatusBanner,
  type AdminBannerResponse,
  type AdminFlag,
  type AdminFlagsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { withTransaction } from '../db';
import { notFound, parse } from '../errors';
import { BANNER_KEY } from '../liveops/store';
import { raiseStaffAlert } from './alerts';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const FlagParams = z.object({ key: z.string().min(1).max(80) });

interface FlagRow {
  key: string;
  description: string;
  enabled: boolean;
  rules: AdminFlag['rules'];
  updated_by: string | null;
  updated_at: Date;
}

const isKillSwitch = (key: string) => (KILL_SWITCHES as readonly string[]).includes(key);

function flagView(row: FlagRow): AdminFlag {
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rules: row.rules,
    kill_switch: isKillSwitch(row.key),
    updated_by: row.updated_by,
    updated_at: row.updated_at.toISOString(),
  };
}

export function adminLiveOpsRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, liveops } = deps;
  const FLAG_SELECT = `SELECT f.key, f.description, f.enabled, f.rules, a.name AS updated_by, f.updated_at
                         FROM feature_flags f LEFT JOIN admin_users a ON a.id = f.updated_by`;

  app.get('/admin/flags', async (request): Promise<AdminFlagsResponse> => {
    await requireAdmin(request, ctx, 'liveops.flags');
    const rows = await pool.query<FlagRow>(`${FLAG_SELECT} ORDER BY f.key`);
    return { flags: rows.rows.map(flagView) };
  });

  app.post('/admin/flags/:key', async (request): Promise<AdminFlag> => {
    const admin = await requireAdmin(request, ctx, 'liveops.flags');
    const { key } = parse(FlagParams, request.params);
    const body = parse(AdminFlagUpdate, request.body);
    const now = clock.now();
    const updated = await withTransaction(pool, async (client) => {
      const before = (
        await client.query<FlagRow>('SELECT * FROM feature_flags WHERE key = $1 FOR UPDATE', [key])
      ).rows[0];
      if (!before) return null;
      await client.query(
        'UPDATE feature_flags SET enabled = $2, rules = $3, updated_by = $4, updated_at = $5 WHERE key = $1',
        [key, body.enabled, JSON.stringify(body.rules), admin.id, new Date(now)],
      );
      await writeAudit(client, {
        actor: admin.id,
        action: 'change_flag',
        entity: 'flag',
        entityId: key,
        reason: body.reason,
        before: { enabled: before.enabled, rules: before.rules },
        after: { enabled: body.enabled, rules: body.rules },
        ip: request.ip,
      });
      // Doc 18 §8: a kill switch flipped is announced in the alerts channel.
      if (isKillSwitch(key) && before.enabled !== body.enabled) {
        await raiseStaffAlert(client, {
          kind: 'problem',
          title: `${body.enabled ? 'Back on' : 'Switched off'}: ${before.description}`,
          body: `${admin.name}: ${body.reason}`,
          url: '/liveops',
          now,
        });
      }
      return (await client.query<FlagRow>(`${FLAG_SELECT} WHERE f.key = $1`, [key])).rows[0]!;
    });
    if (!updated) throw notFound('No such flag.');
    liveops.forget();
    return flagView(updated);
  });

  async function banner(): Promise<AdminBannerResponse> {
    const row = await pool.query<{ value: unknown; updated_by: string | null; updated_at: Date }>(
      `SELECT c.value, a.name AS updated_by, c.updated_at
         FROM app_config c LEFT JOIN admin_users a ON a.id = c.updated_by WHERE c.key = $1`,
      [BANNER_KEY],
    );
    const found = row.rows[0];
    const shown = StatusBanner.safeParse(found?.value);
    return {
      banner: shown.success ? shown.data : null,
      updated_by: found?.updated_by ?? null,
      updated_at: found?.updated_at.toISOString() ?? null,
    };
  }

  app.get('/admin/banner', async (request): Promise<AdminBannerResponse> => {
    await requireAdmin(request, ctx, 'liveops.flags');
    return banner();
  });

  /** Puts the banner up (or changes it), or takes it down with `banner: null`. */
  app.post('/admin/banner', async (request): Promise<AdminBannerResponse> => {
    const admin = await requireAdmin(request, ctx, 'liveops.flags');
    const body = parse(AdminBannerUpdate, request.body);
    const at = new Date(clock.now());
    // Taking it down keeps the row, as JSON null, so who did it and when stay on the page.
    const value = JSON.stringify(body.banner);
    await withTransaction(pool, async (client) => {
      const before = await client.query<{ value: unknown }>(
        'SELECT value FROM app_config WHERE key = $1 FOR UPDATE',
        [BANNER_KEY],
      );
      const old = before.rows[0]?.value ?? null;
      await client.query(
        `INSERT INTO app_config (key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = $4`,
        [BANNER_KEY, value, admin.id, at],
      );
      await client.query(
        `INSERT INTO config_history (key, old_value, new_value, changed_by, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [BANNER_KEY, JSON.stringify(old), value, admin.id, body.reason, at],
      );
      await writeAudit(client, {
        actor: admin.id,
        action: body.banner ? 'set_banner' : 'clear_banner',
        entity: 'config',
        entityId: BANNER_KEY,
        reason: body.reason,
        before: old,
        after: body.banner,
        ip: request.ip,
      });
    });
    liveops.forget();
    return banner();
  });
}
