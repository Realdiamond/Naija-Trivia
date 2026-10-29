/**
 * Commerce in the console (doc 18 §13, build plan step 2.7i): store purchases and refunds as
 * RevenueCat told us about them (step 2.4d), the totals finance and owners look at, the
 * purchases whose coins never arrived, and a month's purchases as CSV for finance. Owners,
 * admins and finance (`commerce.view`); totals count real purchases only, never store tests.
 * Finance sees no names or numbers: a player is their pseudonymous id in the export.
 */
import type { FastifyInstance } from 'fastify';
import { pseudonymousId } from '@whosabi/analytics/server';
import {
  AdminCommerceExportQuery,
  AdminCommerceQuery,
  type AdminCommerceResponse,
  type AdminPurchase,
  type CommerceTotals,
  type MoneyByCurrency,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { parse } from '../errors';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';
import { csvCell } from './csv';

const DAY = 86_400_000;
/** West Africa Time is UTC+1 all year. */
const WAT = 3_600_000;
const PAGE = 50;
/** A purchase's coins should arrive within seconds; this long without them is a problem. */
const COINS_LATE_MS = 10 * 60_000;

/** Midnight WAT at the start of the day `now` falls in. */
const watMidnight = (now: number) => Math.floor((now + WAT) / DAY) * DAY - WAT;

interface PurchaseRow {
  id: string;
  user_id: string;
  username: string | null;
  store: string;
  product_id: string;
  store_tx_id: string;
  coins: number | null;
  price_micros: string | null;
  currency: string | null;
  status: AdminPurchase['status'];
  environment: AdminPurchase['environment'];
  ledger_tx_id: string | null;
  created_at: Date;
  refunded_at: Date | null;
}

function priceShown(micros: string | null, currency: string | null): string | null {
  if (micros === null || !currency) return null;
  const amount = Number(micros) / 1e6;
  return currency === 'NGN' ? `₦${amount.toLocaleString('en-NG')}` : `${currency} ${amount}`;
}

const money = (rows: { currency: string | null; micros: string | null }[]): MoneyByCurrency => {
  const out: MoneyByCurrency = {};
  for (const r of rows) if (r.currency && r.micros !== null) out[r.currency] = Number(r.micros) / 1e6;
  return out;
};

/** A time in Lagos, as finance reads it: 2026-10-29 14:05. */
const watText = (date: Date | null) =>
  date ? new Date(date.getTime() + WAT).toISOString().slice(0, 16).replace('T', ' ') : null;

export function adminCommerceRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  async function totals(from: number, to: number): Promise<CommerceTotals> {
    const [paid, refunds] = await Promise.all([
      pool.query<{ currency: string | null; n: string; micros: string | null }>(
        `SELECT currency, count(*) AS n, sum(price_micros) FILTER (WHERE status = 'completed') AS micros
           FROM purchases
          WHERE environment = 'production' AND status <> 'pending' AND created_at >= $1 AND created_at <= $2
          GROUP BY currency`,
        [new Date(from), new Date(to)],
      ),
      pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM purchases
          WHERE environment = 'production' AND refunded_at >= $1 AND refunded_at <= $2`,
        [new Date(from), new Date(to)],
      ),
    ]);
    return {
      purchases: paid.rows.reduce((sum, r) => sum + Number(r.n), 0),
      refunds: Number(refunds.rows[0]!.n),
      revenue: money(paid.rows),
    };
  }

  app.get('/admin/commerce', async (request): Promise<AdminCommerceResponse> => {
    await requireAdmin(request, ctx, 'commerce.view');
    const query = parse(AdminCommerceQuery, request.query);
    const now = clock.now();
    const today = watMidnight(now);
    const monthAgo = today - 29 * DAY;

    const [day, week, month, days, products, missing, page] = await Promise.all([
      totals(today, now),
      totals(today - 6 * DAY, now),
      totals(monthAgo, now),
      pool.query<{ day: string; n: string; micros: string | null }>(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(p.id) AS n,
                sum(p.price_micros) FILTER (WHERE p.status = 'completed' AND p.currency = 'NGN') AS micros
           FROM generate_series($1::date, $2::date, interval '1 day') AS d(day)
           LEFT JOIN purchases p
             ON (p.created_at AT TIME ZONE 'Africa/Lagos')::date = d.day::date
            AND p.environment = 'production' AND p.status <> 'pending' AND p.created_at <= $3
          GROUP BY d.day ORDER BY d.day`,
        [
          new Date(monthAgo + WAT).toISOString().slice(0, 10),
          new Date(today + WAT).toISOString().slice(0, 10),
          new Date(now),
        ],
      ),
      pool.query<{ product_id: string; currency: string | null; n: string; micros: string | null }>(
        `SELECT product_id, currency, count(*) AS n, sum(price_micros) AS micros
           FROM purchases
          WHERE environment = 'production' AND status = 'completed' AND created_at >= $1 AND created_at <= $2
          GROUP BY product_id, currency ORDER BY product_id`,
        [new Date(monthAgo), new Date(now)],
      ),
      pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM purchases
          WHERE status = 'completed' AND ledger_tx_id IS NULL AND created_at < $1`,
        [new Date(now - COINS_LATE_MS)],
      ),
      pool.query<PurchaseRow>(
        `SELECT p.id, p.user_id, u.username, p.store, p.product_id, p.store_tx_id, p.coins, p.price_micros,
                p.currency, p.status, p.environment, p.ledger_tx_id, p.created_at, p.refunded_at
           FROM purchases p JOIN users u ON u.id = p.user_id
          WHERE p.created_at <= $1 AND ($2::text IS NULL OR p.status = $2)
            AND ($3::boolean OR p.environment = 'production')
          ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE + 1}`,
        [
          query.before ? new Date(Math.min(Date.parse(query.before) - 1, now)) : new Date(now),
          query.status ?? null,
          query.sandbox === 'true',
        ],
      ),
    ]);

    const byProduct = new Map<string, { purchases: number; revenue: MoneyByCurrency }>();
    for (const r of products.rows) {
      const entry = byProduct.get(r.product_id) ?? { purchases: 0, revenue: {} };
      entry.purchases += Number(r.n);
      Object.assign(entry.revenue, money([r]));
      byProduct.set(r.product_id, entry);
    }
    const rows = page.rows.slice(0, PAGE);
    return {
      today: day,
      last_7_days: week,
      last_30_days: month,
      days: days.rows.map((d) => ({
        day: d.day,
        purchases: Number(d.n),
        revenue_ngn: d.micros === null ? 0 : Number(d.micros) / 1e6,
      })),
      by_product: [...byProduct].map(([product_id, v]) => ({ product_id, ...v })),
      missing_coins: Number(missing.rows[0]!.n),
      purchases: rows.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        username: p.username,
        store: p.store,
        product_id: p.product_id,
        store_tx_id: p.store_tx_id,
        coins: p.coins,
        price: priceShown(p.price_micros, p.currency),
        status: p.status,
        environment: p.environment,
        granted: p.ledger_tx_id !== null,
        created_at: p.created_at.toISOString(),
        refunded_at: p.refunded_at?.toISOString() ?? null,
      })),
      next: page.rows.length > PAGE ? rows.at(-1)!.created_at.toISOString() : null,
    };
  });

  /** A WAT month's purchases (store tests included, marked) as CSV, for finance's books. */
  app.get('/admin/commerce/export', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'commerce.view');
    const { month } = parse(AdminCommerceExportQuery, request.query);
    const [year, m] = month.split('-').map(Number) as [number, number];
    const from = Date.UTC(year, m - 1, 1) - WAT;
    const to = Date.UTC(year, m, 1) - WAT;
    const rows = await pool.query<PurchaseRow>(
      `SELECT id, user_id, store, product_id, store_tx_id, coins, price_micros, currency, status, environment,
              ledger_tx_id, created_at, refunded_at
         FROM purchases WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at, id`,
      [new Date(from), new Date(Math.min(to, clock.now() + 1))],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'export_purchases',
      entity: 'commerce',
      entityId: month,
      after: { rows: rows.rowCount },
      ip: request.ip,
    });
    const header = [
      'purchase_id',
      'bought_at_wat',
      'store',
      'product_id',
      'store_transaction_id',
      'price',
      'currency',
      'coins',
      'status',
      'refunded_at_wat',
      'environment',
      'player',
    ];
    const lines = rows.rows.map((p) =>
      [
        p.id,
        watText(p.created_at),
        p.store,
        p.product_id,
        p.store_tx_id,
        p.price_micros === null ? null : Number(p.price_micros) / 1e6,
        p.currency,
        p.coins,
        p.status,
        watText(p.refunded_at),
        p.environment,
        pseudonymousId(p.user_id, config.analyticsKey),
      ]
        .map(csvCell)
        .join(','),
    );
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="whosabi-purchases-${month}.csv"`)
      .send([header.join(','), ...lines].join('\n') + '\n');
  });
}
