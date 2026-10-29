/**
 * Commerce (doc 18 §13, build plan step 2.7i): store purchases and refunds, the money they
 * brought in (real purchases only, never store tests), coin packs side by side, purchases whose
 * coins never arrived, and each month as CSV for finance. Owners, admins and finance.
 */
import Link from 'next/link';
import {
  routes,
  type AdminCommerceResponse,
  type AdminProfile,
  type CommerceTotals,
  type MoneyByCurrency,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { BarList, DayBars } from '../../../lib/charts';
import { watDateTime } from '../../../lib/format';

const n = (value: number) => value.toLocaleString('en-NG');

function amount(money: MoneyByCurrency): string {
  const entries = Object.entries(money);
  if (entries.length === 0) return '₦0';
  return entries
    .map(([currency, value]) => (currency === 'NGN' ? `₦${n(value)}` : `${currency} ${n(value)}`))
    .join(' + ');
}

function Tile({ title, totals, testId }: { title: string; totals: CommerceTotals; testId: string }) {
  return (
    <div className="tile" data-testid={testId}>
      {title}
      <b>{amount(totals.revenue)}</b>
      <span className="muted small">
        {n(totals.purchases)} {totals.purchases === 1 ? 'purchase' : 'purchases'} · {n(totals.refunds)}{' '}
        {totals.refunds === 1 ? 'refund' : 'refunds'}
      </span>
    </div>
  );
}

/** This month and the two before it, in Lagos. */
function recentMonths(): string[] {
  const now = new Date(Date.now() + 3_600_000);
  return [0, 1, 2].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function Commerce({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sandbox?: string; before?: string }>;
}) {
  const asked = await searchParams;
  const status = asked.status === 'refunded' ? 'refunded' : undefined;
  const sandbox = asked.sandbox === 'true';
  const query = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(sandbox ? { sandbox: 'true' } : {}),
    ...(asked.before ? { before: asked.before } : {}),
  }).toString();
  const me = await adminApi<AdminProfile>('/admin/me');
  const canSeePlayers = me.permissions.includes('players.view');
  let page: AdminCommerceResponse;
  try {
    page = await adminApi<AdminCommerceResponse>(routes.admin.commerce(query ? `?${query}` : ''));
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load Commerce.'}</p>;
  }
  const filter = (params: Record<string, string>) => `/commerce?${new URLSearchParams(params).toString()}`;
  return (
    <>
      <div>
        <h1>Commerce</h1>
        <p className="muted">
          Coin packs bought in the stores, as RevenueCat reports them. Totals leave out store tests and what
          was refunded.
        </p>
      </div>

      {page.missing_coins > 0 ? (
        <p className="error" role="alert" data-testid="missing-coins">
          {page.missing_coins} paid {page.missing_coins === 1 ? 'purchase has' : 'purchases have'} no coins on
          the player&apos;s balance. Check RevenueCat before giving coins by hand.
        </p>
      ) : null}

      <div className="tiles four">
        <Tile title="Today" totals={page.today} testId="commerce-today" />
        <Tile title="Last 7 days" totals={page.last_7_days} testId="commerce-week" />
        <Tile title="Last 30 days" totals={page.last_30_days} testId="commerce-month" />
        <div className="tile">
          For finance
          <span className="stack small">
            {recentMonths().map((month) => (
              <a key={month} href={`/commerce/export?month=${month}`} data-testid={`export-${month}`}>
                {month} as CSV
              </a>
            ))}
          </span>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Naira by day</h2>
          <DayBars rows={page.days.map((d) => ({ day: d.day, value: d.revenue_ngn }))} label="Naira by day" />
        </section>
        <section className="card">
          <h2>Packs, last 30 days</h2>
          <BarList
            rows={page.by_product.map((p) => ({
              label: `${p.product_id} · ${amount(p.revenue)}`,
              value: p.purchases,
            }))}
            testId="by-product"
            empty="No purchases in the last 30 days."
          />
        </section>
      </div>

      <section className="card">
        <div className="row spread">
          <h2>Purchases</h2>
          <div className="row small">
            <Link href={filter(sandbox ? { sandbox: 'true' } : {})}>All</Link>
            <Link
              href={filter({ status: 'refunded', ...(sandbox ? { sandbox: 'true' } : {}) })}
              data-testid="only-refunds"
            >
              Refunds only
            </Link>
            <Link href={filter({ ...(status ? { status } : {}), ...(sandbox ? {} : { sandbox: 'true' }) })}>
              {sandbox ? 'Hide store tests' : 'Show store tests'}
            </Link>
          </div>
        </div>
        {page.purchases.length === 0 ? (
          <p className="muted small">No purchases here yet.</p>
        ) : (
          <table data-testid="purchases">
            <thead>
              <tr>
                <th>When (WAT)</th>
                <th>Player</th>
                <th>Pack</th>
                <th>Price</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {page.purchases.map((p) => (
                <tr key={p.id} data-testid={`purchase-${p.id}`}>
                  <td className="small">{watDateTime(p.created_at)}</td>
                  <td>
                    {canSeePlayers ? (
                      <Link href={`/players/${p.user_id}`}>{p.username ?? 'Guest'}</Link>
                    ) : (
                      (p.username ?? 'Guest')
                    )}
                  </td>
                  <td>
                    {p.product_id}
                    <div className="muted small">
                      {p.store === 'play' ? 'Google Play' : p.store === 'app_store' ? 'App Store' : p.store}
                      {p.coins !== null ? ` · ${n(p.coins)} coins` : ''}
                    </div>
                  </td>
                  <td>{p.price ?? '—'}</td>
                  <td>
                    {p.status === 'refunded' ? (
                      <span className="badge warn">
                        Refunded {p.refunded_at ? watDateTime(p.refunded_at) : ''}
                      </span>
                    ) : p.granted ? (
                      <span className="badge">Coins given</span>
                    ) : (
                      <span className="badge warn">No coins yet</span>
                    )}
                    {p.environment === 'sandbox' ? <span className="badge off">store test</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {page.next ? (
          <Link
            href={filter({
              ...(status ? { status } : {}),
              ...(sandbox ? { sandbox: 'true' } : {}),
              before: page.next,
            })}
          >
            Older
          </Link>
        ) : null}
      </section>
    </>
  );
}
