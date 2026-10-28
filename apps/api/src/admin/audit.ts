/** The append-only audit log (doc 18 §8, §16): every staff view and action, reads included. */
import type { z } from 'zod';
import type { AdminAuditEntry, AdminAuditQuery, AdminAuditResponse } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';

export interface AuditEntry {
  /** admin_users.id, or 'system'. */
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export async function writeAudit(db: Pool | PoolClient, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log (actor, action, entity, entity_id, reason, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actor,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.reason ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
    ],
  );
}

/** A page of the log, newest first, for the audit screen and a player's "Admin history". */
export async function auditPage(
  pool: Pool,
  query: z.output<typeof AdminAuditQuery>,
): Promise<AdminAuditResponse> {
  const rows = await pool.query<{
    id: string;
    actor: string;
    actor_email: string | null;
    action: string;
    entity: string;
    entity_id: string | null;
    reason: string | null;
    ip: string | null;
    created_at: Date;
  }>(
    `SELECT l.id, l.actor, a.email AS actor_email, l.action, l.entity, l.entity_id, l.reason,
            host(l.ip) AS ip, l.created_at
       FROM admin_audit_log l LEFT JOIN admin_users a ON a.id = l.actor
      WHERE ($1::text IS NULL OR l.entity = $1)
        AND ($2::text IS NULL OR l.entity_id = $2)
        AND ($3::text IS NULL OR l.actor = $3)
        AND ($4::bigint IS NULL OR l.id < $4)
      ORDER BY l.id DESC
      LIMIT $5`,
    [query.entity ?? null, query.entity_id ?? null, query.actor ?? null, query.before ?? null, query.limit],
  );
  const entries: AdminAuditEntry[] = rows.rows.map((r) => ({
    id: Number(r.id),
    actor: r.actor,
    actor_email: r.actor_email,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    reason: r.reason,
    ip: r.ip,
    created_at: r.created_at.toISOString(),
  }));
  return {
    entries,
    next_before: entries.length === query.limit ? (entries.at(-1)?.id ?? null) : null,
  };
}
