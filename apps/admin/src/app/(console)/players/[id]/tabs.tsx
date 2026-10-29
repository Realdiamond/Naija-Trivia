/**
 * User 360's other tabs (doc 18 §7.2, build plan step 2.7b): sessions and time, matches, money,
 * devices and consent, and support (notes and actions). Each one is read when it is opened, and
 * each look is in the audit log.
 */
import {
  routes,
  type AdminSafetyResponse,
  type AdminDevicesResponse,
  type AdminMatchesResponse,
  type AdminMoneyResponse,
  type AdminNotesResponse,
  type AdminSessionsResponse,
  type AdminUserSummary,
} from '@whosabi/shared-types';
import { adminApi } from '../../../../lib/api';
import { BarList, DayBars } from '../../../../lib/charts';
import { watDateTime } from '../../../../lib/format';
import { StartDsar } from '../../compliance/Forms';
import { ModerationActions } from './ModerationActions';
import { NoteForm, SupportActions } from './SupportActions';

const words = (s: string) => s.replaceAll('_', ' ');
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-NG')}`;

function Empty({ children, testId }: { children: string; testId?: string }) {
  return (
    <p className="muted small" data-testid={testId}>
      {children}
    </p>
  );
}

export async function SessionsTab({ userId }: { userId: string }) {
  const s = await adminApi<AdminSessionsResponse>(routes.admin.userSessions(userId));
  const last7 = s.minutes_by_day.slice(-7).reduce((sum, d) => sum + d.minutes, 0);
  const [busiest, ...next] = s.by_hour
    .map((n, hour) => ({ hour, n }))
    .filter((h) => h.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((h) => `${String(h.hour).padStart(2, '0')}:00`);
  return (
    <div className="stack" data-testid="sessions-tab">
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Last 7 days</span>
          <b>{Math.round(last7)} min</b>
        </div>
        <div className="tile">
          <span className="muted small">Average session</span>
          <b>{s.average_session_minutes} min</b>
        </div>
        <div className="tile">
          <span className="muted small">Busiest hour (WAT)</span>
          <b>{busiest ?? '–'}</b>
          {next.length ? <span className="muted small">then {next.join(' and ')}</span> : null}
        </div>
      </div>
      <div className="grid2 charts">
        <section className="card">
          <h2>Minutes in front each day, last 90 days</h2>
          <DayBars
            rows={s.minutes_by_day.map((d) => ({ day: d.day, value: d.minutes }))}
            label="Minutes in front of the app each day, last 90 days"
          />
        </section>
        <section className="card">
          <h2>By area of the app</h2>
          <BarList
            rows={s.minutes_by_area.map((a) => ({ label: a.area, value: Math.round(a.minutes) }))}
            empty="No screen times yet (they need the player's consent to behaviour analytics)."
          />
          <h2>By platform</h2>
          <BarList
            rows={s.minutes_by_platform.map((p) => ({ label: p.platform, value: Math.round(p.minutes) }))}
            empty="No time recorded yet."
          />
        </section>
      </div>
      <section className="card">
        <h2>Sessions</h2>
        {s.sessions.length === 0 ? (
          <Empty testId="sessions-empty">No sessions recorded yet.</Empty>
        ) : (
          <table data-testid="sessions">
            <thead>
              <tr>
                <th>Started (WAT)</th>
                <th>Ended</th>
                <th>In front</th>
                <th>Platform</th>
                <th>Version</th>
                <th>Network</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {s.sessions.map((row) => (
                <tr key={row.id}>
                  <td title={row.started_at}>{watDateTime(row.started_at)}</td>
                  <td title={row.ended_at}>{watDateTime(row.ended_at)}</td>
                  <td>{row.foreground_minutes === null ? '–' : `${row.foreground_minutes} min`}</td>
                  <td>{row.platform}</td>
                  <td>{row.app_version || '–'}</td>
                  <td>{row.network || '–'}</td>
                  <td>{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export async function MatchesTab({ userId }: { userId: string }) {
  const m = await adminApi<AdminMatchesResponse>(routes.admin.userMatches(userId));
  return (
    <div className="stack" data-testid="matches-tab">
      <section className="card">
        <h2>Duels</h2>
        {m.duels.length === 0 ? (
          <Empty>No duels yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started (WAT)</th>
                <th>Against</th>
                <th>How</th>
                <th>State</th>
                <th>Result</th>
                <th>Score</th>
                <th>Coins</th>
              </tr>
            </thead>
            <tbody>
              {m.duels.map((d) => (
                <tr key={d.id}>
                  <td title={d.created_at}>{watDateTime(d.created_at)}</td>
                  <td>{d.opponent ?? 'Waiting for a player'}</td>
                  <td>{d.source}</td>
                  <td>{words(d.state)}</td>
                  <td>{d.result ?? '–'}</td>
                  <td>
                    {d.score.you.toLocaleString('en-NG')} – {d.score.opponent.toLocaleString('en-NG')}
                  </td>
                  <td>{d.coins ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="grid2">
        <section className="card">
          <h2>Dailies</h2>
          {m.dailies.length === 0 ? (
            <Empty>No Dailies yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Daily</th>
                  <th>Grid</th>
                  <th>Score</th>
                  <th>Streak</th>
                  <th>Coins</th>
                </tr>
              </thead>
              <tbody>
                {m.dailies.map((d) => (
                  <tr key={d.id}>
                    <td>
                      #{d.id} · {d.date}
                    </td>
                    <td className="mono">{[...d.grid].map((c) => (c === 'G' ? '🟩' : '🟥')).join('')}</td>
                    <td>
                      {d.score.toLocaleString('en-NG')} ({d.correct}/7)
                    </td>
                    <td>{d.streak}</td>
                    <td>{d.coins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Party games</h2>
          {m.party_games.length === 0 ? (
            <Empty>No party games yet.</Empty>
          ) : (
            <table>
              <tbody>
                {m.party_games.map((g) => (
                  <tr key={g.id}>
                    <td>{watDateTime(g.ended_at)}</td>
                    <td className="mono">{g.room_code}</td>
                    <td>
                      #{g.rank} of {g.players} · {g.score.toLocaleString('en-NG')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

export async function MoneyTab({ userId }: { userId: string }) {
  const m = await adminApi<AdminMoneyResponse>(routes.admin.userMoney(userId));
  return (
    <div className="stack" data-testid="money-tab">
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Coins</span>
          <b data-testid="money-coins">{m.coins.toLocaleString('en-NG')}</b>
        </div>
        <div className="tile">
          <span className="muted small">Gems</span>
          <b>{m.gems.toLocaleString('en-NG')}</b>
        </div>
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Every coin and gem, newest first</h2>
          {m.ledger.length === 0 ? (
            <Empty>Nothing earned or spent yet.</Empty>
          ) : (
            <table data-testid="ledger">
              <thead>
                <tr>
                  <th>When (WAT)</th>
                  <th>Why</th>
                  <th>For</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {m.ledger.map((e) => (
                  <tr key={e.id}>
                    <td title={e.created_at}>{watDateTime(e.created_at)}</td>
                    <td>{words(e.reason)}</td>
                    <td className="mono small">{e.ref_type ? `${e.ref_type} ${e.ref_id ?? ''}` : ''}</td>
                    <td className={e.amount > 0 ? 'up' : undefined}>
                      {signed(e.amount)} {e.currency === 'gems' ? 'gems' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div className="stack">
          <section className="card">
            <h2>Purchases</h2>
            {m.purchases.length === 0 ? (
              <Empty>No purchases.</Empty>
            ) : (
              <table>
                <tbody>
                  {m.purchases.map((p) => (
                    <tr key={p.id}>
                      <td>{watDateTime(p.created_at)}</td>
                      <td>
                        {p.product_id} · {p.price ?? '–'}
                        <div className="muted small">
                          {p.store} · {p.status}
                          {p.environment === 'sandbox' ? ' · test purchase' : ''}
                          {p.refunded_at ? ` · refunded ${watDateTime(p.refunded_at)}` : ''}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card">
            <h2>Ad rewards</h2>
            {m.ad_rewards.length === 0 ? (
              <Empty>No rewarded ads watched.</Empty>
            ) : (
              <table>
                <tbody>
                  {m.ad_rewards.map((a) => (
                    <tr key={`${a.received_at}-${a.ad_unit}`}>
                      <td>{watDateTime(a.received_at)}</td>
                      <td>
                        +{a.amount} · {a.source === 'admob_ssv' ? 'AdMob' : 'web'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export async function DevicesTab({ user }: { user: AdminUserSummary }) {
  const d = await adminApi<AdminDevicesResponse>(routes.admin.userDevices(user.id));
  return (
    <div className="grid2" data-testid="devices-tab">
      <div className="stack">
        <section className="card">
          <h2>Devices</h2>
          {d.devices.length === 0 ? (
            <Empty>No devices registered (one appears when the app asks for notifications).</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>App</th>
                  <th>Notifications</th>
                  <th>Last seen (WAT)</th>
                </tr>
              </thead>
              <tbody>
                {d.devices.map((device, i) => (
                  <tr key={i}>
                    <td>
                      {device.model ?? device.browser ?? 'Unknown'} · {device.platform}
                    </td>
                    <td>{device.app_version ?? '–'}</td>
                    <td>{device.push ? 'On' : 'Off'}</td>
                    <td>{watDateTime(device.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Sign-in methods</h2>
          <table>
            <tbody>
              {user.sign_in_methods.map((m) => (
                <tr key={`${m.provider}-${m.created_at}`}>
                  <th scope="row">{words(m.provider)}</th>
                  <td className="mono">{m.masked}</td>
                  <td>{watDateTime(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card">
        <h2>Consents</h2>
        {user.consents.length === 0 ? (
          <Empty>No choices recorded yet.</Empty>
        ) : (
          <table>
            <tbody>
              {user.consents.map((c) => (
                <tr key={c.purpose}>
                  <th scope="row">{c.purpose}</th>
                  <td>
                    {c.granted ? 'Allowed' : 'Refused'}
                    <div className="muted small">
                      {watDateTime(c.created_at)} · {c.source} · policy {c.policy_version}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export async function SupportTab({
  userId,
  canAct,
  canLogDsar,
}: {
  userId: string;
  canAct: boolean;
  canLogDsar: boolean;
}) {
  const n = await adminApi<AdminNotesResponse>(routes.admin.userNotes(userId));
  return (
    <div className="grid2" data-testid="support-tab">
      <section className="card">
        <h2>Staff notes</h2>
        <p className="muted small">Never shown to the player.</p>
        <NoteForm userId={userId} />
        {n.notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="notes" data-testid="notes">
            {n.notes.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <span className="muted small">
                  {note.author} · {watDateTime(note.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Actions</h2>
        {canAct ? (
          <SupportActions userId={userId} />
        ) : (
          <Empty>Coin grants, streak restores and sign-outs are for support, admins and owners.</Empty>
        )}
        {canLogDsar ? (
          <>
            <h2>A data request</h2>
            <p className="muted small">
              When the player asks by email or the help centre for their data or their account deleted.
            </p>
            <StartDsar userId={userId} />
          </>
        ) : null}
      </section>
    </div>
  );
}

const ACTION_WORDS: Record<string, string> = {
  warn: 'Warned',
  rename: 'Username taken away',
  shadow_restrict: 'Hidden from the boards',
  unrestrict: 'Back on the boards',
  ban: 'Banned',
  unban: 'Ban lifted',
  mute: 'Muted',
};

export async function SafetyTab({ user, canModerate }: { user: AdminUserSummary; canModerate: boolean }) {
  const s = await adminApi<AdminSafetyResponse>(routes.admin.userSafety(user.id));
  return (
    <div className="grid2" data-testid="safety-tab">
      <div className="stack">
        <section className="card">
          <h2>Moderation history</h2>
          {s.moderation.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <table data-testid="moderation-history">
              <thead>
                <tr>
                  <th>When (WAT)</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {s.moderation.map((m) => (
                  <tr key={m.id}>
                    <td title={m.created_at}>{watDateTime(m.created_at)}</td>
                    <td>
                      {ACTION_WORDS[m.action] ?? words(m.action)}
                      {m.action === 'ban' ? (
                        <div className="muted small">
                          {m.ends_at ? `until ${watDateTime(m.ends_at)}` : 'for good'}
                        </div>
                      ) : null}
                      {m.message ? <div className="muted small">“{m.message}”</div> : null}
                      {m.details && typeof m.details.old_username === 'string' ? (
                        <div className="muted small">was {m.details.old_username}</div>
                      ) : null}
                      {m.action === 'warn' || m.action === 'rename' ? (
                        <div className="muted small">
                          {m.seen_at ? `seen ${watDateTime(m.seen_at)}` : 'not seen yet'}
                        </div>
                      ) : null}
                    </td>
                    <td>{m.actor}</td>
                    <td>{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Integrity flags</h2>
          {s.flags.length === 0 ? (
            <Empty>No flags.</Empty>
          ) : (
            <table>
              <tbody>
                {s.flags.map((f) => (
                  <tr key={f.id}>
                    <td>{watDateTime(f.created_at)}</td>
                    <td>
                      {words(f.kind)} · risk {Math.round(f.score * 100)}%
                      <div className="mono small muted">{JSON.stringify(f.evidence)}</div>
                    </td>
                    <td>
                      {f.status}
                      {f.review_note ? <div className="muted small">{f.review_note}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <section className="card">
        <h2>Actions</h2>
        {canModerate ? (
          <ModerationActions user={user} />
        ) : (
          <Empty>
            Warnings, renames, hiding from the boards and bans are for moderators, admins and owners.
          </Empty>
        )}
      </section>
    </div>
  );
}
