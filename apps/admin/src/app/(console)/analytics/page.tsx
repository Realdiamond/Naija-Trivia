/**
 * Analytics dashboards (doc 18 §9, build plan steps 2.7j–2.7k): Engagement & time, Growth &
 * invites, Retention, Gameplay, Monetisation and Economy, each over a range of WAT days and a
 * platform. Every number follows its one definition in doc 18 §10. Players are counted, never named.
 */
import Link from 'next/link';
import {
  ANALYTICS_BOARD_PERMISSION,
  ANALYTICS_BOARDS,
  routes,
  type AdminProfile,
  type AnalyticsBoard,
  type AnalyticsResponse,
  type EconomyBoard,
  type EngagementBoard,
  type GameplayBoard,
  type GrowthBoard,
  type MonetisationBoard,
  type MoneyByCurrency,
  type RetentionBoard,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { BarList, DayBars, HourHeatmap, ShareCurve } from '../../../lib/charts';

const TITLES: Record<AnalyticsBoard, string> = {
  engagement: 'Engagement & time',
  growth: 'Growth & invites',
  retention: 'Retention',
  gameplay: 'Gameplay',
  monetisation: 'Monetisation',
  economy: 'Economy',
};
/** Dashboards whose numbers come from places that know no platform. */
const EVERY_PLATFORM: readonly AnalyticsBoard[] = ['economy'];
const PLATFORMS = [
  ['all', 'All platforms'],
  ['android', 'Android'],
  ['ios', 'iPhone'],
  ['web', 'Web'],
] as const;

const n = (value: number) => value.toLocaleString('en-NG');
const pct = (share: number | null) => (share === null ? '—' : `${Math.round(share * 1000) / 10}%`);
const one = (value: number) => (Math.round(value * 10) / 10).toLocaleString('en-NG');
const naira = (value: number) => `₦${Math.round(value).toLocaleString('en-NG')}`;
const money = (m: MoneyByCurrency) => {
  const entries = Object.entries(m);
  if (entries.length === 0) return '—';
  return entries
    .map(([currency, value]) => (currency === 'NGN' ? naira(value) : `${currency} ${one(value)}`))
    .join(' + ');
};

function Tile({
  title,
  value,
  note,
  testId,
}: {
  title: string;
  value: string;
  note?: string;
  testId?: string;
}) {
  return (
    <div className="tile" data-testid={testId}>
      {title}
      <b>{value}</b>
      {note ? <span className="muted small">{note}</span> : null}
    </div>
  );
}

function Engagement({ b }: { b: EngagementBoard }) {
  const last = b.days.at(-1)?.day;
  return (
    <>
      <div className="tiles six">
        <Tile title="Players a day" value={one(b.summary.dau)} note="average DAU" testId="dau" />
        <Tile title="Last 7 days" value={n(b.summary.wau)} note="WAU" testId="wau" />
        <Tile title="Last 30 days" value={n(b.summary.mau)} note="MAU" testId="mau" />
        <Tile title="Stickiness" value={pct(b.summary.stickiness)} note="DAU ÷ MAU" />
        <Tile
          title="Minutes a player"
          value={one(b.summary.minutes_per_dau)}
          note={`${one(b.summary.sessions_per_dau)} sessions a player`}
          testId="minutes-per-dau"
        />
        <Tile
          title="Daily finished"
          value={pct(b.summary.daily_completion)}
          note="of the Dailies started"
          testId="daily-completion"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Players a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.dau }))}
            label="Players a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Minutes in the app a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: Math.round(d.minutes) }))}
            label="Minutes in the app a day"
            lastLabel={last?.slice(5)}
          />
        </section>
        <section className="card">
          <h2>How long sessions last</h2>
          <BarList
            rows={b.session_lengths.map((s) => ({ label: s.bucket, value: s.sessions }))}
            testId="session-lengths"
            empty="No sessions in this range."
          />
          <h2>Time by screen</h2>
          <BarList
            rows={b.screens.map((s) => ({ label: s.screen, value: Math.round(s.minutes) }))}
            empty="No screen times in this range."
          />
          <p className="muted small">Minutes, from players who allow behaviour analytics.</p>
        </section>
      </div>
      <section className="card">
        <h2>Busiest hours (WAT)</h2>
        <HourHeatmap rows={b.hours} />
      </section>
    </>
  );
}

function Growth({ b }: { b: GrowthBoard }) {
  const last = b.days.at(-1)?.day;
  return (
    <>
      <div className="tiles six">
        <Tile title="New players" value={n(b.summary.new_players)} testId="new-players" />
        <Tile title="Sign-ups" value={n(b.summary.signups)} testId="signups" />
        <Tile
          title="Invites"
          value={n(b.summary.invites_shared)}
          note={`shared · ${n(b.summary.invites_opened)} opened`}
          testId="invites"
        />
        <Tile
          title="K-factor"
          value={b.summary.k_factor === null ? '—' : b.summary.k_factor.toFixed(2)}
          note="invites a new player × opened"
          testId="k-factor"
        />
        <Tile
          title="Web to account"
          value={b.summary.web_new_players ? pct(b.summary.web_to_account / b.summary.web_new_players) : '—'}
          note={`${n(b.summary.web_to_account)} of ${n(b.summary.web_new_players)} new on the web`}
          testId="web-to-account"
        />
        <Tile
          title="Web to app"
          value={b.summary.web_new_players ? pct(b.summary.web_to_app / b.summary.web_new_players) : '—'}
          note="later played on a phone"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>New players a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.new_players }))}
            label="New players a day"
            lastLabel={last?.slice(5)}
          />
          <table data-testid="growth-days">
            <thead>
              <tr>
                <th>Day</th>
                <th>New</th>
                <th>Android</th>
                <th>iPhone</th>
                <th>Web</th>
                <th>Sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {[...b.days]
                .reverse()
                .slice(0, 14)
                .map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{n(d.new_players)}</td>
                    <td>{n(d.android)}</td>
                    <td>{n(d.ios)}</td>
                    <td>{n(d.web)}</td>
                    <td>{n(d.signups)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Where new players came from</h2>
          <BarList
            rows={b.sources.map((s) => ({ label: s.source, value: s.players }))}
            empty="Nobody new yet."
          />
          <h2>How they signed up</h2>
          <BarList
            rows={b.signup_methods.map((s) => ({ label: s.method, value: s.signups }))}
            empty="No sign-ups yet."
          />
          <h2>Invites shared</h2>
          <BarList
            rows={b.invite_channels.map((c) => ({ label: c.channel, value: c.shared }))}
            testId="invite-channels"
            empty="No invites shared yet."
          />
          <h2>Invites opened</h2>
          <BarList
            rows={b.invites_opened_by.map((o) => ({
              label: `${o.type} · ${n(o.in_app)} in the app, ${n(o.on_web)} on the web`,
              value: o.in_app + o.on_web,
            }))}
            empty="No invites opened yet."
          />
        </section>
      </div>
    </>
  );
}

function Retention({ b }: { b: RetentionBoard }) {
  return (
    <>
      <div className="tiles four">
        <Tile title="Day 1" value={pct(b.summary.d1)} note="back the next day" testId="d1" />
        <Tile title="Day 7" value={pct(b.summary.d7)} note="back a week later" testId="d7" />
        <Tile title="Day 30" value={pct(b.summary.d30)} note="back 30 days later" testId="d30" />
      </div>
      <section className="card">
        <h2>Back again, by days since they first played</h2>
        <ShareCurve rows={b.curve} label="Retention curve" />
      </section>
      <section className="card">
        <h2>By the week they first played</h2>
        {b.cohorts.length === 0 ? (
          <p className="muted small">Nobody new in this range.</p>
        ) : (
          <table data-testid="cohorts">
            <thead>
              <tr>
                <th>Week from</th>
                <th>New players</th>
                <th>Day 1</th>
                <th>Day 7</th>
                <th>Day 30</th>
              </tr>
            </thead>
            <tbody>
              {b.cohorts.map((c) => (
                <tr key={c.week}>
                  <td>{c.week}</td>
                  <td>{n(c.players)}</td>
                  <td>{pct(c.d1)}</td>
                  <td>{pct(c.d7)}</td>
                  <td>{pct(c.d30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">A dash means that day has not come yet for everyone in the week.</p>
      </section>
    </>
  );
}

function Gameplay({ b, platform }: { b: GameplayBoard; platform: string }) {
  const last = b.days.at(-1)?.day;
  return (
    <>
      {platform !== 'all' ? (
        <p className="muted small">
          Matches count every platform; answers and lifelines are from the platform you chose.
        </p>
      ) : null}
      <div className="tiles six">
        <Tile title="Duels finished" value={n(b.summary.duels_finished)} testId="duels-finished" />
        <Tile title="Forfeited" value={pct(b.summary.forfeit_rate)} note="of the duels finished" />
        <Tile
          title="A duel takes"
          value={b.summary.duel_hours_median === null ? '—' : `${one(b.summary.duel_hours_median)} h`}
          note="start to finish, the middle duel"
        />
        <Tile
          title="Party games"
          value={n(b.summary.party_games)}
          note={
            b.summary.party_players_avg === null
              ? undefined
              : `${one(b.summary.party_players_avg)} players · ${pct(b.summary.web_guest_share)} web guests`
          }
          testId="party-games"
        />
        <Tile title="Dailies finished" value={n(b.summary.dailies_finished)} testId="dailies-finished" />
        <Tile title="Answers right" value={pct(b.summary.correct_rate)} />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Duels finished a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.duels }))}
            label="Duels finished a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Dailies finished a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.dailies }))}
            label="Dailies finished a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Categories</h2>
          <BarList
            rows={b.categories.map((c) => ({
              label: `${c.category} · ${pct(c.correct_rate)} right`,
              value: c.answers,
            }))}
            testId="categories"
            empty="No answers in this range."
          />
        </section>
        <section className="card">
          <h2>Duels started: what became of them</h2>
          <BarList
            rows={b.duel_outcomes.map((o) => ({ label: o.outcome, value: o.duels }))}
            testId="duel-outcomes"
            empty="No duels started in this range."
          />
          <h2>How duels started</h2>
          <BarList
            rows={b.duel_sources.map((d) => ({ label: d.source, value: d.duels }))}
            empty="No duels yet."
          />
          <h2>Party sizes</h2>
          <BarList rows={b.party_sizes.map((p) => ({ label: `${p.size} players`, value: p.games }))} />
          <h2>Daily scores</h2>
          <BarList
            rows={b.daily_scores.map((d) => ({ label: `${d.correct} of 7`, value: d.players }))}
            testId="daily-scores"
          />
          <h2>Lifelines</h2>
          <BarList
            rows={b.lifelines.map((l) => ({
              label: `${l.type} · ${n(l.with_coins)} with coins, ${n(l.with_ads)} with ads`,
              value: l.with_coins + l.with_ads,
            }))}
            empty="No lifelines used in this range."
          />
        </section>
      </div>
    </>
  );
}

function Monetisation({ b }: { b: MonetisationBoard }) {
  const last = b.days.at(-1)?.day;
  const s = b.summary;
  return (
    <>
      <div className="tiles six">
        <Tile
          title="Store money"
          value={naira(s.store_revenue_ngn)}
          note={`${n(s.purchases)} purchases · ${n(s.refunds)} refunds`}
          testId="store-revenue"
        />
        <Tile
          title="Players who paid"
          value={n(s.payers)}
          note={`${pct(s.payer_conversion)} of players`}
          testId="payers"
        />
        <Tile
          title="ARPPU"
          value={s.arppu_ngn === null ? '—' : naira(s.arppu_ngn)}
          note="per player who paid"
        />
        <Tile
          title="ARPDAU"
          value={s.arpdau_ngn === null ? '—' : `₦${one(s.arpdau_ngn)}`}
          note="store money per player a day"
        />
        <Tile
          title="Ad money"
          value={money(s.ad_revenue)}
          note={`AdMob's estimate · ${n(s.ads_shown)} ads shown${s.fill_rate === null ? '' : `, ${pct(s.fill_rate)} filled`}`}
          testId="ad-revenue"
        />
        <Tile
          title="Rewarded ads"
          value={n(s.rewarded_views)}
          note={s.rewarded_per_dau === null ? undefined : `${one(s.rewarded_per_dau)} per player a day`}
          testId="rewarded"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Store naira a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: Math.round(d.store_ngn) }))}
            label="Store naira a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Rewarded ads a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.rewarded_views }))}
            label="Rewarded ads a day"
            lastLabel={last?.slice(5)}
          />
        </section>
        <section className="card">
          <h2>Packs</h2>
          <BarList
            rows={b.by_product.map((p) => ({
              label: `${p.product_id} · ${naira(p.revenue_ngn)}`,
              value: p.purchases,
            }))}
            testId="packs"
            empty="No purchases in this range."
          />
          <h2>Ads shown</h2>
          <BarList
            rows={b.ad_placements.map((p) => ({ label: `${p.format} · ${p.placement}`, value: p.shown }))}
            empty="No ads shown in this range."
          />
          <p className="muted small">Real purchases only, as on Commerce; store tests are left out.</p>
        </section>
      </div>
    </>
  );
}

function Economy({ b }: { b: EconomyBoard }) {
  const last = b.days.at(-1)?.day;
  const s = b.summary;
  return (
    <>
      <p className="muted small">Coins on players&apos; balances, from every platform.</p>
      <div className="tiles four">
        <Tile title="Coins earned" value={n(s.earned)} testId="coins-earned" />
        <Tile title="Coins spent" value={n(s.spent)} testId="coins-spent" />
        <Tile
          title="Earned ÷ spent"
          value={s.inflation === null ? '—' : s.inflation.toFixed(2)}
          note="above 1, coins pile up"
          testId="inflation"
        />
        <Tile
          title="Players with coins"
          value={n(s.holders)}
          note={s.balance_median === null ? undefined : `${n(s.balance_median)} coins in the middle`}
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Coins earned a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.earned }))}
            label="Coins earned a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Coins spent a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.spent }))}
            label="Coins spent a day"
            lastLabel={last?.slice(5)}
          />
        </section>
        <section className="card">
          <h2>Where coins came from</h2>
          <BarList
            rows={b.sources.map((x) => ({ label: x.reason, value: x.coins }))}
            testId="coin-sources"
            empty="No coins earned in this range."
          />
          <h2>Where coins went</h2>
          <BarList
            rows={b.sinks.map((x) => ({ label: x.reason, value: x.coins }))}
            testId="coin-sinks"
            empty="No coins spent in this range."
          />
          <h2>Balances today</h2>
          <BarList rows={b.balances.map((x) => ({ label: `${x.bucket} coins`, value: x.players }))} />
        </section>
      </div>
    </>
  );
}

export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; from?: string; to?: string; platform?: string }>;
}) {
  const asked = await searchParams;
  const me = await adminApi<AdminProfile>('/admin/me');
  const boards = ANALYTICS_BOARDS.filter((b) => me.permissions.includes(ANALYTICS_BOARD_PERMISSION[b]));
  if (boards.length === 0) return <p className="error">You can&apos;t see the analytics dashboards.</p>;
  const board = boards.find((b) => b === asked.board) ?? boards[0]!;
  const platform = PLATFORMS.some(([p]) => p === asked.platform) ? asked.platform! : 'all';
  const filters = {
    ...(asked.from ? { from: asked.from } : {}),
    ...(asked.to ? { to: asked.to } : {}),
    ...(platform !== 'all' ? { platform } : {}),
  };
  const query = new URLSearchParams(filters).toString();

  let data: AnalyticsResponse;
  try {
    data = await adminApi<AnalyticsResponse>(routes.admin.analytics(board, query ? `?${query}` : ''));
  } catch (e) {
    return (
      <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the dashboard.'}</p>
    );
  }
  const link = (params: Record<string, string>) => `/analytics?${new URLSearchParams(params).toString()}`;

  return (
    <>
      <div>
        <h1>Analytics</h1>
        <p className="muted">
          {data.from} to {data.to} (WAT)
          {data.platform === 'all' ? '' : ` · ${PLATFORMS.find(([p]) => p === data.platform)![1]}`}
        </p>
      </div>
      <nav className="tabs" aria-label="Dashboards">
        {boards.map((b) => (
          <Link key={b} href={link({ ...filters, board: b })} aria-current={b === board ? 'page' : undefined}>
            {TITLES[b]}
          </Link>
        ))}
      </nav>
      <form className="inline filters" method="get" action="/analytics">
        <input type="hidden" name="board" value={board} />
        <label>
          From
          <input type="date" name="from" defaultValue={data.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={data.to} />
        </label>
        {EVERY_PLATFORM.includes(board) ? (
          <input type="hidden" name="platform" value={platform} />
        ) : (
          <label>
            Platform
            <select name="platform" defaultValue={platform}>
              {PLATFORMS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit">Show</button>
      </form>
      {data.board === 'engagement' ? <Engagement b={data} /> : null}
      {data.board === 'growth' ? <Growth b={data} /> : null}
      {data.board === 'retention' ? <Retention b={data} /> : null}
      {data.board === 'gameplay' ? <Gameplay b={data} platform={platform} /> : null}
      {data.board === 'monetisation' ? <Monetisation b={data} /> : null}
      {data.board === 'economy' ? <Economy b={data} /> : null}
    </>
  );
}
