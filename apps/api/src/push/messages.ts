/**
 * What each push says (doc 05 §4), in English or Pidgin by the player's language (FR-NOT-3),
 * and where tapping it goes in the app. The queue keeps the facts (`params`); the words are
 * chosen when the push goes out, so they follow a change of language.
 */
export type PushType =
  | 'your_turn'
  | 'duel_expiring'
  | 'duel_result'
  | 'friend_joined'
  | 'daily_live'
  | 'league_recap'
  | 'party_invite'
  | 'content_correction'
  /** To staff phones (step 2.9b), not players. */
  | 'staff_alert';

export type PushParams =
  | {
      type: 'your_turn';
      duel_id: string;
      /** challenge: their first turn is done and the duel waits on you; tiebreak: one question decides it. */
      kind: 'challenge' | 'turn' | 'tiebreak';
      opponent: string | null;
    }
  | { type: 'duel_expiring'; duel_id: string; opponent: string | null; hours: number; cancelled: boolean }
  | {
      type: 'duel_result';
      duel_id: string;
      opponent: string | null;
      result: 'win' | 'loss' | 'draw';
      forfeit: boolean;
      you: number;
      them: number;
    }
  | { type: 'friend_joined'; kind: 'request' | 'accepted'; user_id: string; name: string | null }
  | { type: 'daily_live'; daily_id: number; streak: number };

/** Android notification channels: players can switch each one off in the phone's settings. */
export type PushChannel = 'duels' | 'friends' | 'daily' | 'staff';

export interface RenderedPush {
  type: PushType;
  title: string;
  body: string;
  /** The app path to open, e.g. /duel/d_123. */
  url: string;
  channel: PushChannel;
  /** Ids for the app, e.g. { duel_id }. */
  data: Record<string, string>;
}

/** Turn pushes are what a duel needs to go on; every other kind counts toward the daily cap. */
export const TURN_TYPES: ReadonlySet<PushType> = new Set(['your_turn', 'duel_expiring']);
/** FR-NOT-2: at most this many other pushes per player per WAT day. */
export const DAILY_CAP = 4;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderPush(p: PushParams, language: string): RenderedPush {
  const pcm = language === 'pcm';
  switch (p.type) {
    case 'your_turn': {
      const name = p.opponent ?? (pcm ? 'your person' : 'your opponent');
      const words = {
        challenge: pcm
          ? [`${cap(name)} don challenge you! 🔥`, 'Na your turn. Show say you sabi pass am.']
          : [`${cap(name)} challenged you`, 'Your turn: play your rounds and show who sabi pass.'],
        turn: pcm
          ? [`${cap(name)} don play, na your turn! 🔥`, 'Oya, come show am say you sabi.']
          : [`Your turn vs ${name}`, `${cap(name)} has played. Your move.`],
        tiebreak: pcm
          ? [`Una draw with ${name}! 😮`, 'One question go settle am. Answer now.']
          : [`It's a tie with ${name}!`, 'One question decides it. Answer now.'],
      }[p.kind];
      return duelPush(p.type, p.duel_id, words);
    }
    case 'duel_expiring': {
      const name = p.opponent ?? 'your opponent';
      const outcome = pcm
        ? p.cancelled
          ? 'the duel go cancel'
          : `${name} go win am`
        : p.cancelled
          ? 'the duel is cancelled'
          : `${name} wins the duel`;
      return duelPush(
        p.type,
        p.duel_id,
        pcm
          ? [
              `Oya o! ${p.hours} hours remain for your duel with ${name}`,
              `Play your turn before time finish, or ${outcome}.`,
            ]
          : [`${p.hours} hours left vs ${name}`, `Play your turn before time runs out, or ${outcome}.`],
      );
    }
    case 'duel_result': {
      const name = p.opponent ?? (pcm ? 'your person' : 'your opponent');
      const score = `${p.you.toLocaleString('en-NG')} to ${p.them.toLocaleString('en-NG')}`;
      let words: [string, string];
      if (p.result === 'draw') {
        words = pcm
          ? ['Una draw! 🤝', `Nobody sabi pass. Rematch ${name}?`]
          : [`Draw with ${name}`, `${score}. Rematch?`];
      } else if (p.result === 'win') {
        words = p.forfeit
          ? pcm
            ? [`${cap(name)} no play on time. You win am! 👑`, 'Start another duel?']
            : [`${cap(name)} ran out of time. You win!`, 'Start another duel?']
          : pcm
            ? ['Na you get am today 👑', `You beat ${name}, ${score}.`]
            : [`You beat ${name}! 👑`, `${score}. See how you did.`];
      } else {
        words = p.forfeit
          ? pcm
            ? [`Your time don finish for the duel with ${name}`, 'Start another one?']
            : [`Your time ran out vs ${name}`, 'The duel went to them. Start another one?']
          : pcm
            ? [`${cap(name)} win this one`, `No vex, next one na your own 💪 ${score}.`]
            : [`${cap(name)} won this one`, `${score}. Rematch?`];
      }
      return duelPush(p.type, p.duel_id, words);
    }
    case 'friend_joined': {
      const name = p.name ?? (pcm ? 'Somebody' : 'Someone');
      const [title, body] =
        p.kind === 'request'
          ? pcm
            ? [`${name} wan be your friend`, 'Accept am, then challenge am.']
            : [`${name} wants to be your friend`, 'Accept, then challenge them.']
          : pcm
            ? [`${name} don accept your friend request`, 'Oya, challenge am!']
            : [`${name} accepted your friend request`, 'Challenge them now.'];
      return { type: p.type, title, body, url: '/friends', channel: 'friends', data: { user_id: p.user_id } };
    }
    case 'daily_live': {
      const [title, body] = pcm
        ? [
            'Daily don land! Show say you sabi 🇳🇬',
            p.streak > 0 ? `Your ${p.streak}-day streak dey wait.` : '7 questions. How far you fit go?',
          ]
        : [
            `Daily #${p.daily_id} is live`,
            p.streak > 0 ? `Keep your ${p.streak}-day streak going.` : '7 questions. How far can you go?',
          ];
      return {
        type: p.type,
        title,
        body,
        url: '/daily/play',
        channel: 'daily',
        data: { daily_id: String(p.daily_id) },
      };
    }
  }
}

function duelPush(type: PushType, duelId: string, [title, body]: [string, string] | string[]): RenderedPush {
  return {
    type,
    title: title!,
    body: body!,
    url: `/duel/${duelId}`,
    channel: 'duels',
    data: { duel_id: duelId },
  };
}
