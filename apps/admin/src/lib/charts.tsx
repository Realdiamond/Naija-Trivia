/**
 * Small charts drawn as SVG on the server (the Overview, doc 18 §5): no chart library to load,
 * and they read the same without JavaScript.
 */
const W = 640;
const H = 220;
const PAD = { left: 36, right: 12, top: 12, bottom: 24 };

function niceMax(n: number): number {
  if (n <= 5) return 5;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}

/** Two lines over the 24 hours of a WAT day. */
export function HourLines({ rows }: { rows: Array<{ hour: number; today: number; last_week: number }> }) {
  const byHour = (key: 'today' | 'last_week') =>
    Array.from({ length: 24 }, (_, h) => rows.find((r) => r.hour === h)?.[key] ?? null);
  const today = byHour('today');
  const lastWeek = byHour('last_week');
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.today, r.last_week])));
  const x = (h: number) => PAD.left + (h / 23) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  // Today's line stops at the latest hour with players in it.
  const lastToday = today.reduce<number>((last, v, h) => (v ? h : last), -1);
  const path = (values: Array<number | null>, upTo = 23) =>
    values
      .slice(0, upTo + 1)
      .map((v, h) => `${h === 0 ? 'M' : 'L'}${x(h).toFixed(1)},${y(v ?? 0).toFixed(1)}`)
      .join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Players active by hour, today and last week"
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} className="gridline" />
          <text x={PAD.left - 6} y={y(max * f) + 4} textAnchor="end" className="axis">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={x(h)} y={H - 6} textAnchor="middle" className="axis">
          {String(h).padStart(2, '0')}
        </text>
      ))}
      <path d={path(lastWeek)} className="line last-week" />
      {lastToday >= 0 ? <path d={path(today, lastToday)} className="line today" /> : null}
    </svg>
  );
}

/** One bar per day, the last one darker (today's, unless `lastLabel` names another day). */
export function DayBars({
  rows,
  label,
  lastLabel = 'Today',
}: {
  rows: Array<{ day: string; value: number }>;
  label: string;
  lastLabel?: string;
}) {
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));
  const inner = W - PAD.left - PAD.right;
  const slot = inner / Math.max(rows.length, 1);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      <text x={PAD.left - 6} y={y(max) + 4} textAnchor="end" className="axis">
        {max}
      </text>
      <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="gridline" />
      {rows.map((r, i) => (
        <rect
          key={r.day}
          x={PAD.left + i * slot + slot * 0.15}
          width={slot * 0.7}
          y={y(r.value)}
          height={Math.max(0, y(0) - y(r.value))}
          className={i === rows.length - 1 ? 'bar today' : 'bar'}
        >
          <title>{`${r.day}: ${r.value.toLocaleString('en-NG')}`}</title>
        </rect>
      ))}
      {rows.length > 0 ? (
        <>
          <text x={PAD.left} y={H - 6} className="axis">
            {rows[0]!.day.slice(5)}
          </text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="axis">
            {lastLabel}
          </text>
        </>
      ) : null}
    </svg>
  );
}

/** A labelled bar per row, for top-N lists. */
export function BarList({
  rows,
  testId,
  empty = 'Nothing yet today.',
}: {
  rows: Array<{ label: string; value: number }>;
  testId?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="barlist" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <b>{r.value.toLocaleString('en-NG')}</b>
        </li>
      ))}
    </ul>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Players by weekday and WAT hour: the darker the cell, the busier the hour. */
export function HourHeatmap({ rows }: { rows: Array<{ weekday: number; hour: number; players: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.players));
  const at = (weekday: number, hour: number) =>
    rows.find((r) => r.weekday === weekday && r.hour === hour)?.players ?? 0;
  return (
    <table className="heatmap" aria-label="Players by weekday and hour (WAT)">
      <thead>
        <tr>
          <th />
          {Array.from({ length: 24 }, (_, h) => (
            <th key={h} scope="col">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {WEEKDAYS.map((name, weekday) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            {Array.from({ length: 24 }, (_, hour) => {
              const players = at(weekday, hour);
              return (
                <td
                  key={hour}
                  title={`${name} ${String(hour).padStart(2, '0')}:00 · ${players.toLocaleString('en-NG')} players`}
                  style={{ opacity: players === 0 ? 0.06 : 0.15 + 0.85 * (players / max) }}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A share (0–1) for each day since players first came: the retention curve. */
export function ShareCurve({
  rows,
  label,
}: {
  rows: Array<{ day: number; share: number | null }>;
  label: string;
}) {
  const known = rows.filter((r): r is { day: number; share: number } => r.share !== null);
  const last = Math.max(1, ...rows.map((r) => r.day));
  const x = (d: number) => PAD.left + (d / last) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const path = known
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.day).toFixed(1)},${y(r.share).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(f)} y2={y(f)} className="gridline" />
          <text x={PAD.left - 6} y={y(f) + 4} textAnchor="end" className="axis">
            {Math.round(f * 100)}%
          </text>
        </g>
      ))}
      {[0, 7, 14, 30]
        .filter((d) => d <= last)
        .map((d) => (
          <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="axis">
            D{d}
          </text>
        ))}
      {known.length > 0 ? <path d={path} className="line today" /> : null}
    </svg>
  );
}
