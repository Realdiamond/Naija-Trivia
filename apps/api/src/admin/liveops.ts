/**
 * LiveOps in the console (doc 18 §8 and §11, build plan step 2.7c): flags and kill switches, the
 * in-app status banner, and (step 2.7g, `liveops.config`) the game and economy values with their
 * history and one-click rollback, and (step 2.7t) the ones the apps use set apart for a platform. Owners, admins, LiveOps and on-call engineers (`liveops.flags`);
 * every change needs a reason, goes in the audit log, and a kill switch flipped is announced to
 * the staff alerts. The banner's history is in `config_history`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_CONFIG, KILL_SWITCHES, TUNABLE, tunable, type ConfigKey } from '@whosabi/game-rules';
import {
  AdminBannerUpdate,
  AdminConfigChange,
  AdminConfigPlatformChange,
  AdminConfigRollback,
  AdminFlagUpdate,
  ErrorCode,
  StatusBanner,
  type AdminConfigHistory,
  type AdminConfigResponse,
  type AdminConfigValue,
  type AdminBannerResponse,
  type AdminFlag,
  type AdminFlagsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { withTransaction, type PoolClient } from '../db';
import { ApiError, conflict, notFound, parse } from '../errors';
import { BANNER_KEY, platformKey, platformValue, tunedValue } from '../liveops/store';
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

  // ----- Game and economy values (step 2.7g) -----

  const KeyParams = z.object({ key: z.string().min(1).max(80) });
  const known = (key: string) => {
    const t = tunable(key);
    if (!t) throw notFound('Not a value staff can change.');
    return t;
  };

  async function configList(): Promise<AdminConfigResponse> {
    const rows = await pool.query<{
      key: string;
      value: unknown;
      changed_by: string | null;
      updated_at: Date;
    }>(
      `SELECT c.key, c.value, a.name AS changed_by, c.updated_at
       FROM app_config c LEFT JOIN admin_users a ON a.id = c.updated_by
      WHERE c.key = ANY($1) OR c.key LIKE '%@%'`,
      [TUNABLE.map((t) => t.key)],
    );
    const byKey = new Map(rows.rows.map((r) => [r.key, r]));
    const apart = new Map<string, AdminConfigValue['platforms']>();
    for (const row of rows.rows) {
      const own = platformValue(row.key);
      const value = own ? tunedValue(own.key, row.value) : null;
      if (!own || value === null) continue;
      apart.set(own.key, [
        ...(apart.get(own.key) ?? []),
        {
          platform: own.platform,
          value,
          changed_by: row.changed_by,
          changed_at: row.updated_at.toISOString(),
        },
      ]);
    }
    return {
      values: TUNABLE.map((t): AdminConfigValue => {
        const row = byKey.get(t.key);
        return {
          key: t.key,
          label: t.label,
          value: tunedValue(t.key, row?.value) ?? DEFAULT_CONFIG[t.key],
          default: DEFAULT_CONFIG[t.key],
          min: t.min,
          max: t.max,
          client: t.client ?? false,
          changed_by: row?.changed_by ?? null,
          changed_at: row?.updated_at.toISOString() ?? null,
          platforms: (apart.get(t.key) ?? []).sort((a, b) => a.platform.localeCompare(b.platform)),
        };
      }),
    };
  }

  app.get('/admin/config', async (request): Promise<AdminConfigResponse> => {
    await requireAdmin(request, ctx, 'liveops.config');
    return configList();
  });

  /** Sets a value in one transaction with its history row and audit entry; returns the old one. */
  async function setValue(
    client: PoolClient,
    key: ConfigKey,
    value: number,
    who: { id: string; reason: string; ip: string; action: string },
  ): Promise<number | null> {
    const before = await client.query<{ value: unknown }>(
      'SELECT value FROM app_config WHERE key = $1 FOR UPDATE',
      [key],
    );
    const old = before.rows[0] ? tunedValue(key, before.rows[0].value) : null;
    if ((old ?? DEFAULT_CONFIG[key]) === value) {
      throw conflict(ErrorCode.conflict, 'Nothing to change', `It is ${value} already.`);
    }
    const at = new Date(clock.now());
    await client.query(
      `INSERT INTO app_config (key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = $4`,
      [key, JSON.stringify(value), who.id, at],
    );
    await client.query(
      `INSERT INTO config_history (key, old_value, new_value, changed_by, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [key, JSON.stringify(old), JSON.stringify(value), who.id, who.reason, at],
    );
    await writeAudit(client, {
      actor: who.id,
      action: who.action,
      entity: 'config',
      entityId: key,
      reason: who.reason,
      before: { value: old ?? DEFAULT_CONFIG[key] },
      after: { value },
      ip: who.ip,
    });
    return old;
  }

  app.post('/admin/config/:key', async (request): Promise<AdminConfigResponse> => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const t = known(parse(KeyParams, request.params).key);
    const body = parse(AdminConfigChange, request.body);
    if (body.value < t.min || body.value > t.max) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'Out of range',
        `${t.label}: between ${t.min} and ${t.max}.`,
      );
    }
    await withTransaction(pool, (client) =>
      setValue(client, t.key, body.value, {
        id: admin.id,
        reason: body.reason,
        ip: request.ip,
        action: 'change_config',
      }),
    );
    liveops.forget();
    return configList();
  });

  /**
   * A value for the players on one platform (step 2.7t), or back to the shared value with `value:
   * null`. Kept beside the value as `key@platform`, with its own history and audit entry.
   */
  app.post('/admin/config/:key/platform', async (request): Promise<AdminConfigResponse> => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const t = known(parse(KeyParams, request.params).key);
    const body = parse(AdminConfigPlatformChange, request.body);
    if (!t.client) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'Not by platform',
        `${t.label} is the same on every platform: the server alone uses it.`,
      );
    }
    if (body.value !== null && (body.value < t.min || body.value > t.max)) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'Out of range',
        `${t.label}: between ${t.min} and ${t.max}.`,
      );
    }
    const key = platformKey(t.key, body.platform);
    await withTransaction(pool, async (client) => {
      const before = await client.query<{ value: unknown }>(
        'SELECT value FROM app_config WHERE key = $1 FOR UPDATE',
        [key],
      );
      const old = before.rows[0] ? tunedValue(t.key, before.rows[0].value) : null;
      if (old === body.value) {
        throw conflict(
          ErrorCode.conflict,
          'Nothing to change',
          body.value === null ? 'It is the same as everywhere already.' : `It is ${body.value} already.`,
        );
      }
      const at = new Date(clock.now());
      if (body.value === null) {
        await client.query('DELETE FROM app_config WHERE key = $1', [key]);
      } else {
        await client.query(
          `INSERT INTO app_config (key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = $4`,
          [key, JSON.stringify(body.value), admin.id, at],
        );
      }
      await client.query(
        `INSERT INTO config_history (key, old_value, new_value, changed_by, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [key, JSON.stringify(old), JSON.stringify(body.value), admin.id, body.reason, at],
      );
      await writeAudit(client, {
        actor: admin.id,
        action: body.value === null ? 'clear_platform_config' : 'change_platform_config',
        entity: 'config',
        entityId: key,
        reason: body.reason,
        before: { value: old },
        after: { value: body.value },
        ip: request.ip,
      });
    });
    liveops.forget();
    return configList();
  });

  app.get('/admin/config/:key/history', async (request): Promise<AdminConfigHistory> => {
    await requireAdmin(request, ctx, 'liveops.config');
    const t = known(parse(KeyParams, request.params).key);
    const rows = await pool.query<{
      id: string;
      old_value: number | null;
      new_value: number;
      changed_by: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT h.id, h.old_value, h.new_value, coalesce(a.name, h.changed_by) AS changed_by, h.reason, h.created_at
         FROM config_history h LEFT JOIN admin_users a ON a.id = h.changed_by
        WHERE h.key = $1 ORDER BY h.id DESC LIMIT 50`,
      [t.key],
    );
    return {
      entries: rows.rows.map((r) => ({ ...r, id: Number(r.id), created_at: r.created_at.toISOString() })),
    };
  });

  /** One click back to the value before the latest change (the default, if it was the first). */
  app.post('/admin/config/:key/rollback', async (request): Promise<AdminConfigResponse> => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const t = known(parse(KeyParams, request.params).key);
    const body = parse(AdminConfigRollback, request.body);
    await withTransaction(pool, async (client) => {
      const last = await client.query<{ old_value: number | null }>(
        'SELECT old_value FROM config_history WHERE key = $1 ORDER BY id DESC LIMIT 1',
        [t.key],
      );
      if (!last.rows[0])
        throw conflict(ErrorCode.conflict, 'Nothing to roll back', 'This value was never changed.');
      const back = last.rows[0].old_value ?? DEFAULT_CONFIG[t.key];
      await setValue(client, t.key, back, {
        id: admin.id,
        reason: body.reason,
        ip: request.ip,
        action: 'rollback_config',
      });
    });
    liveops.forget();
    return configList();
  });
}
