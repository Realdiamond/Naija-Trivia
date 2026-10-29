/**
 * Analytics dashboards (doc 18 §9, build plan steps 2.7j–2.7l): Engagement & time, Growth &
 * invites, Retention, Funnels, Gameplay, Content performance, Monetisation, Economy, Platforms &
 * tech health and Integrity, each over a range of WAT days and a
 * platform. Every number follows its one definition in doc 18 §10. Players are counted, never named.
 */
import Link from 'next/link';
import {
  ANALYTICS_BOARD_PERMISSION,
  ANALYTICS_BOARDS,
  FILTERED_BOARDS,
  routes,
  type AdminProfile,
  type AdminSegmentsResponse,
  type AnalyticsBoard,
  type AnalyticsResponse,
  type ContentBoard,
  type EconomyBoard,
  type EngagementBoard,
  type FunnelsBoard,
  type GameplayBoard,
  type GrowthBoard,
  type IntegrityBoard,
  type MonetisationBoard,
  type MoneyByCurrency,
  type RetentionBoard,
  type TechBoard,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { BarList, DayBars, HourHeatmap, ShareCurve } from '../../../lib/charts';

const TITLES: Record<AnalyticsBoard, string> = {
  engagement: 'Engagement & time',
  growth: 'Growth & invites',
  retention: 'Retention',
  funnels: 'Funnels',
  gameplay: 'Gameplay',
  content: 'Content',
  monetisation: 'Monetisation',
  economy: 'Economy',
  tech: 'Tech health',
  integrity: 'Integrity',
};
/** Dashboards whose numbers come from places that know no platform. */
const EVERY_PLATFORM: readonly AnalyticsBoard[] = ['economy', 'integrity'];
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

function Funnels({ b, filters }: { b: FunnelsBoard; filters: Record<string, string> }) {
  const custom = b.funnel === 'custom';
  return (
    <>
      <nav className="row small funnel-picks" aria-label="Funnels">
        {b.ready.map((f) => (
          <Link
            key={f.id}
            href={`/analytics?${new URLSearchParams({ ...filters, board: 'funnels', funnel: f.id }).toString()}`}
            aria-current={b.funnel === f.id ? 'page' : undefined}
          >
            {f.title}
          </Link>
        ))}
      </nav>
      <form className="inline filters" method="get" action="/analytics" data-testid="funnel-builder">
        <input type="hidden" name="board" value="funnels" />
        <input type="hidden" name="funnel" value="custom" />
        {Object.entries(filters).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label>
          Events in order, with commas
          <input
            name="steps"
            list="funnel-events"
            size={48}
            defaultValue={custom ? b.steps.map((s) => s.events[0]).join(',') : ''}
            placeholder="store_viewed,purchase_started,purchase_completed"
          />
        </label>
        <datalist id="funnel-events">
          {b.events.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <label>
          Within (hours)
          <input type="number" name="window" min={1} max={168} defaultValue={b.window_hours} />
        </label>
        <button type="submit">Build</button>
      </form>
      <section className="card">
        <h2>
          {custom ? 'Your funnel' : (b.ready.find((f) => f.id === b.funnel)?.title ?? b.funnel)} · within{' '}
          {b.window_hours} hours of the first step
        </h2>
        <table data-testid="funnel">
          <thead>
            <tr>
              <th>Step</th>
              <th>Players</th>
              <th>Of the first step</th>
              <th>Of the step before</th>
            </tr>
          </thead>
          <tbody>
            {b.steps.map((s, i) => (
              <tr key={`${i}-${s.label}`}>
                <td>
                  {i + 1}. {s.label}
                  {s.events.length > 1 || custom ? null : <div className="muted small">{s.events[0]}</div>}
                  {s.events.length > 1 ? <div className="muted small">{s.events.join(' or ')}</div> : null}
                </td>
                <td>{n(s.players)}</td>
                <td>{pct(s.of_first)}</td>
                <td>{pct(s.of_previous)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <BarList
          rows={b.steps.map((s, i) => ({ label: `${i + 1}. ${s.label}`, value: s.players }))}
          empty="Nobody yet."
        />
      </section>
    </>
  );
}

function Content({ b }: { b: ContentBoard }) {
  const s = b.summary;
  return (
    <>
      <div className="tiles six">
        <Tile
          title="Answers"
          value={n(s.answers)}
          note={`${n(s.questions_played)} questions`}
          testId="answers"
        />
        <Tile title="Right" value={pct(s.correct_rate)} note="of all answers" />
        <Tile
          title="Reports"
          value={n(s.reports)}
          note={s.reports_per_1k === null ? undefined : `${one(s.reports_per_1k)} per 1,000 answers`}
          testId="reports"
        />
        <Tile
          title="Too easy"
          value={n(s.too_easy)}
          note="90% or more right, 30+ answers"
          testId="too-easy"
        />
        <Tile
          title="Too hard"
          value={n(s.too_hard)}
          note="15% or fewer right, 30+ answers"
          testId="too-hard"
        />
      </div>
      <section className="card">
        <h2>By category</h2>
        {b.categories.length === 0 ? (
          <p className="muted small">No answers in this range.</p>
        ) : (
          <table data-testid="content-categories">
            <thead>
              <tr>
                <th>Category</th>
                <th>Answers</th>
                <th>Right</th>
                <th>Time to answer</th>
                <th>Reports</th>
              </tr>
            </thead>
            <tbody>
              {b.categories.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td>{n(c.answers)}</td>
                  <td>{pct(c.correct_rate)}</td>
                  <td>{one(c.avg_ms / 1000)} s</td>
                  <td>{n(c.reports)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>Most played questions</h2>
        {b.questions.length === 0 ? (
          <p className="muted small">No answers in this range.</p>
        ) : (
          <table data-testid="content-questions">
            <thead>
              <tr>
                <th>Question</th>
                <th>Plays</th>
                <th>Right</th>
                <th>Time</th>
                <th>Reports</th>
              </tr>
            </thead>
            <tbody>
              {b.questions.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link href={`/questions/${q.id}`}>{q.text}</Link>
                    <div className="muted small">
                      {q.category} · difficulty {q.difficulty}
                      {q.flag === 'too_easy' ? <span className="badge warn">too easy</span> : null}
                      {q.flag === 'too_hard' ? <span className="badge warn">too hard</span> : null}
                    </div>
                  </td>
                  <td>{n(q.plays)}</td>
                  <td>{pct(q.correct_rate)}</td>
                  <td>{one(q.avg_ms / 1000)} s</td>
                  <td>{n(q.reports)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Reports come from every platform.</p>
      </section>
    </>
  );
}

const ms = (value: number | null) => (value === null ? '—' : `${n(Math.round(value))} ms`);

function Tech({ b }: { b: TechBoard }) {
  const s = b.summary;
  return (
    <>
      <p className="muted small">
        Crash-free sessions and API latency come from Sentry once its API key is set; not on this page yet.
      </p>
      <div className="tiles six">
        <Tile
          title="Cold start"
          value={ms(s.cold_start_p50_ms)}
          note={`slowest tenth ${ms(s.cold_start_p90_ms)}`}
          testId="cold-start"
        />
        <Tile
          title="Sign-in codes"
          value={pct(s.otp_success)}
          note="verified of those sent"
          testId="otp-success"
        />
        <Tile title="Pushes opened" value={pct(s.push_opened)} note="of those sent" testId="push-opened" />
        <Tile
          title="Back online"
          value={pct(s.reconnected)}
          note="connections restored of those lost"
          testId="reconnected"
        />
        <Tile
          title="Web LCP"
          value={ms(s.web_lcp_p75_ms)}
          note={`INP ${ms(s.web_inp_p75_ms)} · 75th percentile`}
        />
        <Tile
          title="Web CLS"
          value={s.web_cls_p75 === null ? '—' : s.web_cls_p75.toFixed(2)}
          note="75th percentile"
        />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Cold start by phone memory</h2>
          <BarList
            rows={b.cold_start_by_ram.map((x) => ({
              label: `${x.ram} · ${ms(x.p50_ms)} middle`,
              value: x.opens,
            }))}
            empty="No cold starts reported in this range."
          />
          <h2>Pushes</h2>
          {b.push.length === 0 ? (
            <p className="muted small">No pushes in this range.</p>
          ) : (
            <table data-testid="tech-push">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {b.push.map((p) => (
                  <tr key={p.type}>
                    <td>{p.type}</td>
                    <td>{n(p.sent)}</td>
                    <td>{n(p.received)}</td>
                    <td>{n(p.opened)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>App versions</h2>
          <BarList
            rows={b.versions.map((v) => ({ label: `${v.platform} ${v.app_version}`, value: v.players }))}
            empty="No versions reported in this range."
          />
          <h2>Sign-in codes by provider</h2>
          <BarList
            rows={b.otp.map((o) => ({
              label: `${o.provider} · ${n(o.verified)} verified, ${n(o.failed)} failed`,
              value: o.sent,
            }))}
            empty="No codes sent in this range."
          />
          <h2>Connections lost</h2>
          <BarList
            rows={b.connection.map((c) => ({
              label: `${c.mode} · ${n(c.restored)} back, ${ms(c.gap_p50_ms)} gap`,
              value: c.lost,
            }))}
            empty="No connections lost in this range."
          />
        </section>
      </div>
    </>
  );
}

function Integrity({ b }: { b: IntegrityBoard }) {
  const last = b.days.at(-1)?.day;
  const s = b.summary;
  return (
    <>
      <p className="muted small">
        Flags from the nightly checks and moderators&apos; actions, from every platform.
      </p>
      <div className="tiles four">
        <Tile
          title="Flags raised"
          value={n(s.flags)}
          note={`${n(s.actioned)} acted on · ${n(s.dismissed)} dismissed`}
          testId="flags"
        />
        <Tile
          title="Open now"
          value={n(s.open_now)}
          note="waiting in the integrity queue"
          testId="open-now"
        />
        <Tile title="Moderator actions" value={n(s.actions)} testId="actions" />
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Flags a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.flags }))}
            label="Flags a day"
            lastLabel={last?.slice(5)}
          />
          <h2>Actions a day</h2>
          <DayBars
            rows={b.days.map((d) => ({ day: d.day, value: d.actions }))}
            label="Actions a day"
            lastLabel={last?.slice(5)}
          />
        </section>
        <section className="card">
          <h2>Flags by kind</h2>
          <BarList
            rows={b.kinds.map((k) => ({
              label: `${k.kind} · ${n(k.actioned)} acted on, ${n(k.dismissed)} dismissed`,
              value: k.flags,
            }))}
            testId="flag-kinds"
            empty="No flags in this range."
          />
          <h2>Actions</h2>
          <BarList
            rows={b.actions.map((a) => ({ label: a.action, value: a.count }))}
            empty="No actions in this range."
          />
        </section>
      </div>
    </>
  );
}

export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<{
    board?: string;
    from?: string;
    to?: string;
    platform?: string;
    funnel?: string;
    steps?: string;
    window?: string;
    version?: string;
    segment?: string;
  }>;
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
    // Step 2.7q: kept from board to board; only the boards in FILTERED_BOARDS use them.
    ...(asked.version?.trim() ? { version: asked.version.trim() } : {}),
    ...(asked.segment ? { segment: asked.segment } : {}),
  };
  const filtered = FILTERED_BOARDS.includes(board);
  const segments = me.permissions.includes('segments.manage')
    ? ((await adminApi<AdminSegmentsResponse>(routes.admin.segments).catch(() => null))?.segments ?? [])
    : [];
  const funnel =
    board === 'funnels'
      ? {
          ...(asked.funnel ? { funnel: asked.funnel } : {}),
          ...(asked.steps ? { steps: asked.steps } : {}),
          ...(asked.window ? { window: asked.window } : {}),
        }
      : {};
  const query = new URLSearchParams({ ...filters, ...funnel }).toString();

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
          {data.version ? ` · version ${data.version}` : ''}
          {data.segment
            ? ` · ${data.segment.name} (${data.segment.players.toLocaleString('en-NG')} players now)`
            : ''}
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
        {Object.entries(funnel).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
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
        {filtered ? (
          <>
            <label>
              App version
              <input
                name="version"
                defaultValue={asked.version ?? ''}
                placeholder="Any"
                size={8}
                pattern="[0-9A-Za-z.+\-]{1,32}"
                data-testid="filter-version"
              />
            </label>
            {segments.length > 0 ? (
              <label>
                Segment
                <select name="segment" defaultValue={asked.segment ?? ''} data-testid="filter-segment">
                  <option value="">Everyone</option>
                  {segments.map((sg) => (
                    <option key={sg.id} value={sg.id}>
                      {sg.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : asked.segment ? (
              <input type="hidden" name="segment" value={asked.segment} />
            ) : null}
          </>
        ) : (
          <>
            {asked.version ? <input type="hidden" name="version" value={asked.version} /> : null}
            {asked.segment ? <input type="hidden" name="segment" value={asked.segment} /> : null}
          </>
        )}
        <button type="submit">Show</button>
      </form>
      <form className="inline filters" method="get" action="/analytics/export" data-testid="export-board">
        <input type="hidden" name="board" value={board} />
        {Object.entries({ ...filters, ...funnel }).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label>
          Why export it?
          <input
            name="reason"
            required
            minLength={5}
            maxLength={200}
            size={28}
            placeholder="Weekly KPI pack"
          />
        </label>
        <button type="submit">Download CSV</button>
        <span className="muted small">With your name on it, and logged.</span>
      </form>
      {!filtered && (asked.version || asked.segment) ? (
        <p className="muted small">
          The app version and segment narrow Engagement, Growth, Retention, Funnels and Tech health; this
          dashboard shows everyone.
        </p>
      ) : null}
      {data.board === 'engagement' ? <Engagement b={data} /> : null}
      {data.board === 'growth' ? <Growth b={data} /> : null}
      {data.board === 'retention' ? <Retention b={data} /> : null}
      {data.board === 'gameplay' ? <Gameplay b={data} platform={platform} /> : null}
      {data.board === 'monetisation' ? <Monetisation b={data} /> : null}
      {data.board === 'economy' ? <Economy b={data} /> : null}
      {data.board === 'funnels' ? <Funnels b={data} filters={filters} /> : null}
      {data.board === 'content' ? <Content b={data} /> : null}
      {data.board === 'tech' ? <Tech b={data} /> : null}
      {data.board === 'integrity' ? <Integrity b={data} /> : null}
    </>
  );
}
