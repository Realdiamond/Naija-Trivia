/**
 * Wire format between the client tracker and the ingest service (doc 09 §2.11).
 * The client never sends its own user ID: the ingest service takes it from the token.
 */
import { z } from 'zod';
import { isEventName, TRACKING_PLAN } from './plan';

export const ClientEvent = z.object({
  event_id: z.uuid(),
  event: z.string().min(1).max(64),
  /** Device clock; the ingest service corrects skew using the batch's sent_at. */
  ts: z.iso.datetime(),
  session_id: z.string().min(1).max(64),
  seq: z.number().int().min(0),
  screen: z.string().max(64).nullable(),
  props: z.record(z.string(), z.unknown()),
});
export type ClientEvent = z.infer<typeof ClientEvent>;

export const BatchContext = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  app_version: z.string().min(1).max(32),
  os_version: z.string().max(32).optional(),
  device_model: z.string().max(64).optional(),
  browser: z.string().max(40).optional(),
  ram_mb: z.number().int().min(0).max(65_535).optional(),
  network_type: z.enum(['wifi', '4g', '3g', '2g', 'offline', 'unknown']).optional(),
  carrier: z.string().max(20).optional(),
  language: z.string().min(2).max(8),
  data_saver: z.boolean(),
  /** Install id (app) or browser id (web). */
  anon_id: z.string().min(8).max(64),
  /** What the player chose; the ingest service drops behaviour events without it. */
  consent: z.object({ behaviour: z.boolean() }),
});
export type BatchContext = z.infer<typeof BatchContext>;

export const EventBatch = z.object({
  /** Stable across retries: the ingest service accepts each batch once. */
  batch_id: z.string().min(8).max(64),
  /** Device clock at the moment this attempt was sent. */
  sent_at: z.iso.datetime(),
  context: BatchContext,
  events: z.array(ClientEvent).min(1).max(500),
});
export type EventBatch = z.infer<typeof EventBatch>;

export type RejectReason = 'unknown_event' | 'server_only' | 'bad_props' | 'no_consent';

export type EventCheck = { ok: true; props: Record<string, unknown> } | { ok: false; reason: RejectReason };

/** Check one client event against the tracking plan and the player's consent. */
export function checkClientEvent(event: ClientEvent, behaviourConsent: boolean): EventCheck {
  if (!isEventName(event.event)) return { ok: false, reason: 'unknown_event' };
  const spec = TRACKING_PLAN[event.event];
  if (spec.sentBy !== 'client') return { ok: false, reason: 'server_only' };
  if (spec.consent === 'behaviour' && !behaviourConsent) return { ok: false, reason: 'no_consent' };
  const parsed = spec.props.safeParse(event.props);
  if (!parsed.success) return { ok: false, reason: 'bad_props' };
  return { ok: true, props: parsed.data as Record<string, unknown> };
}
