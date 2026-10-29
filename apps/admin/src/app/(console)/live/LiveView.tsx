'use client';
/**
 * Live (doc 18 §6): who is online, the party rooms (moderators can remove a player or close a
 * room, with a reason for the audit log) and what just happened, looked at again every 5 seconds.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { STATE_NAMES, type HomeState, type LiveRoom } from '@whosabi/shared-types';
import { closeRoom, loadLive, removePlayer, type LiveData } from './actions';

const PLATFORMS = [
  { key: '', label: 'All' },
  { key: 'android', label: 'Android' },
  { key: 'ios', label: 'iOS' },
  { key: 'web', label: 'Web' },
];

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Africa/Lagos',
  });

export function LiveView({ initial, canManage }: { initial: LiveData; canManage: boolean }) {
  const [data, setData] = useState(initial);
  const [platform, setPlatform] = useState('');

  const reload = useCallback(async (p: string) => setData(await loadLive(p)), []);
  useEffect(() => {
    void reload(platform);
    const timer = setInterval(() => void reload(platform), 5000);
    return () => clearInterval(timer);
  }, [platform, reload]);

  return (
    <>
      <div className="row spread">
        <div>
          <h1>Live</h1>
          <p className="muted">
            Players seen in the last 5 minutes, party rooms and what just happened · every 5 s
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={platform === p.key}
              onClick={() => setPlatform(p.key)}
              data-testid={`live-platform-${p.key || 'all'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>
            Party rooms <span className="count">{data.rooms.length}</span>
          </h2>
          {data.rooms.length === 0 ? (
            <p className="muted small" data-testid="no-rooms">
              No party rooms open.
            </p>
          ) : (
            data.rooms.map((room) => (
              <Room
                key={room.code}
                room={room}
                canManage={canManage}
                onChange={() => void reload(platform)}
              />
            ))
          )}
        </section>
        <section className="card">
          <h2>Just now</h2>
          {data.feed.length === 0 ? (
            <p className="muted small">Nothing in the last hour.</p>
          ) : (
            <ul className="feed" data-testid="live-feed">
              {data.feed.map((item) => (
                <li key={item.id}>
                  <span className="muted small mono">{time(item.at)}</span> {item.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>
          Online now{' '}
          <span className="count" data-testid="live-online-total">
            {data.online.total}
          </span>
        </h2>
        {data.online.by_state.length > 0 ? (
          <p className="muted small">
            {data.online.by_state
              .slice(0, 8)
              .map((s) => `${STATE_NAMES[s.state as HomeState] ?? s.state} ${s.players}`)
              .join(' · ')}
          </p>
        ) : null}
        <table data-testid="live-online">
          <thead>
            <tr>
              <th>Player</th>
              <th>Platform</th>
              <th>Level</th>
              <th>State</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.online.players.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/players/${p.id}`}>{p.username ?? 'Guest'}</Link>
                </td>
                <td>{p.platform ?? '–'}</td>
                <td>{p.level}</td>
                <td>{p.home_state ? (STATE_NAMES[p.home_state as HomeState] ?? p.home_state) : '–'}</td>
                <td className="mono">{time(p.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Room({ room, canManage, onChange }: { room: LiveRoom; canManage: boolean; onChange: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (work: () => Promise<string | null>) =>
    start(async () => {
      const failed = await work();
      setError(failed);
      if (!failed) {
        setReason('');
        onChange();
      }
    });
  const ready = reason.trim().length >= 3 && !pending;
  return (
    <div className="room" data-testid={`room-${room.code}`}>
      <div className="row spread">
        <b className="mono">{room.code}</b>
        <span className="muted small">
          {room.host}'s room · {room.phase}
          {room.question ? ` · question ${room.question} of ${room.questions}` : ''} · {room.players.length}{' '}
          players
          {room.screens ? ` · ${room.screens} screens` : ''} · open {Math.round(room.age_s / 60)} min
          {room.locked ? ' · locked' : ''}
        </span>
      </div>
      <ul className="room-players">
        {room.players.map((p) => (
          <li key={p.id}>
            {p.name}{' '}
            <span className="muted small">
              {p.kind.replace('_', ' ')}
              {p.connected ? '' : ' · away'}
            </span>{' '}
            <span className="mono small">{p.score}</span>
            {canManage && p.name !== room.host ? (
              <button
                type="button"
                className="link danger"
                disabled={!ready}
                onClick={() => act(() => removePlayer(room.code, p.id, reason))}
                data-testid={`remove-${room.code}-${p.name}`}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="row">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (for the audit log)"
            aria-label={`Reason for acting on room ${room.code}`}
            data-testid={`reason-${room.code}`}
          />
          <button
            type="button"
            className="danger"
            disabled={!ready}
            onClick={() => act(() => closeRoom(room.code, reason))}
            data-testid={`close-${room.code}`}
          >
            Close room
          </button>
          {error ? <span className="error small">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
