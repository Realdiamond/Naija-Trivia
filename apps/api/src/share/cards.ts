/**
 * The pictures (UX §3.3, mockup 14): link previews at 1200×630 and Status cards at 1080×1920,
 * in the game's colours with the pattern band from the mockups. Names come in already made safe
 * to show (13–17s and guests have no public name).
 */
import QRCode from 'qrcode';
import { h, img, type Node } from './render';

const C = {
  green: '#008751',
  greenInk: '#006B40',
  greenTint: '#E3F3EA',
  orange: '#FF7A00',
  gold: '#FFB547',
  cream: '#FFFDF7',
  ink: '#14231B',
  inkSoft: '#3F4A44',
  right: '#006B40',
  wrong: '#B3191C',
  goldTint: '#FFF1DC',
};

const display = { fontFamily: 'Baloo', fontWeight: 800 };
const body = (weight: 700 | 800 = 700) => ({ fontFamily: 'Nunito', fontWeight: weight });

/** The band of green and orange tiles along the top of the mockups. */
function band(width: number, tile: number): Node {
  const tiles = Math.ceil(width / tile);
  return h(
    'div',
    { display: 'flex', width, height: tile },
    ...Array.from({ length: tiles }, (_, i) =>
      i % 2 === 0
        ? h(
            'div',
            {
              display: 'flex',
              width: tile,
              height: tile,
              backgroundColor: C.greenInk,
              alignItems: 'center',
              justifyContent: 'center',
            },
            h('div', {
              width: tile * 0.4,
              height: tile * 0.4,
              borderRadius: tile,
              backgroundColor: C.orange,
            }),
          )
        : h(
            'div',
            {
              display: 'flex',
              width: tile,
              height: tile,
              backgroundColor: C.orange,
              alignItems: 'center',
              justifyContent: 'center',
            },
            h('div', {
              width: tile * 0.34,
              height: tile * 0.34,
              backgroundColor: '#FFFFFF',
              transform: 'rotate(45deg)',
            }),
          ),
    ),
  );
}

/** A round avatar with the name's first letter. */
function initial(name: string, size: number, color: string, ring: string): Node {
  return h(
    'div',
    {
      display: 'flex',
      width: size,
      height: size,
      borderRadius: size,
      backgroundColor: color,
      border: `${Math.round(size / 18)}px solid ${ring}`,
      alignItems: 'center',
      justifyContent: 'center',
      color: '#FFFFFF',
      fontSize: size * 0.45,
      ...body(800),
    },
    (name.trim()[0] ?? '?').toUpperCase(),
  );
}

async function qr(url: string, size: number): Promise<Node> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: C.ink, light: '#FFFFFF' },
  });
  return img(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, size, size);
}

const number = (n: number) => n.toLocaleString('en-NG');

// ----- Link previews, 1200×630 -----

export function previewCard(headline: string, subline: string, host: string): Node {
  return h(
    'div',
    { display: 'flex', flexDirection: 'column', width: 1200, height: 630, backgroundColor: C.green },
    band(1200, 60),
    h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        padding: '44px 72px 56px',
        justifyContent: 'space-between',
      },
      h('div', { display: 'flex', color: '#FFFFFF', fontSize: 56, ...display }, 'Who Sabi?'),
      h(
        'div',
        { display: 'flex', flexDirection: 'column', gap: 18 },
        h('div', { display: 'flex', color: '#FFFFFF', fontSize: 78, lineHeight: 1.05, ...display }, headline),
        h(
          'div',
          { display: 'flex', color: C.greenTint, fontSize: 34, lineHeight: 1.3, ...body(700) },
          subline,
        ),
      ),
      h(
        'div',
        { display: 'flex' },
        h(
          'div',
          {
            display: 'flex',
            padding: '10px 26px',
            borderRadius: 999,
            backgroundColor: C.orange,
            color: C.ink,
            fontSize: 30,
            ...body(800),
          },
          host,
        ),
      ),
    ),
  );
}

// ----- Status cards, 1080×1920 -----

function statusFrame(label: string, card: Node, footer: Node): Node {
  return h(
    'div',
    { display: 'flex', flexDirection: 'column', width: 1080, height: 1920, backgroundColor: C.green },
    band(1080, 108),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 70, gap: 8 },
      h('div', { display: 'flex', color: '#FFFFFF', fontSize: 110, lineHeight: 1, ...display }, 'Who Sabi?'),
      h('div', { display: 'flex', color: '#FFFFFF', fontSize: 40, letterSpacing: 4, ...body(800) }, label),
    ),
    // The card sits in the middle, clear of the bars WhatsApp draws over the top and bottom.
    h('div', { display: 'flex', flexGrow: 1, alignItems: 'center', margin: '0 64px' }, card),
    footer,
  );
}

async function statusFooter(line: string, url: string, host: string): Promise<Node> {
  return h(
    'div',
    { display: 'flex', alignItems: 'center', gap: 40, margin: '0 64px 80px' },
    h(
      'div',
      { display: 'flex', padding: 22, borderRadius: 28, backgroundColor: '#FFFFFF' },
      await qr(url, 190),
    ),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 1 },
      h('div', { display: 'flex', color: '#FFFFFF', fontSize: 48, lineHeight: 1.15, ...body(800) }, line),
      h('div', { display: 'flex', color: C.greenTint, fontSize: 38, ...body(700) }, `Play free at ${host}`),
    ),
  );
}

/** A player on a card; `name` is null for a player with no public name (guests, 13–17s). */
export interface CardPlayer {
  name: string | null;
  score: number;
}

export interface DuelCardData {
  you: CardPlayer;
  opponent: CardPlayer;
  result: 'win' | 'loss' | 'draw';
  /** Won because the other player ran out of time. */
  forfeit: boolean;
  /** The round the winner took by the most, e.g. "Food round: 486 to 386". */
  highlight: string | null;
  /** Category of that round, for the caption. */
  category: string | null;
}

/** "Tolu don school Ada for Food", with stand-ins for players who have no public name. */
export function duelCaption(d: DuelCardData): string {
  const winner = d.result === 'loss' ? d.opponent : d.you;
  const loser = d.result === 'loss' ? d.you : d.opponent;
  if (d.result === 'draw') {
    return d.you.name && d.opponent.name
      ? `${d.you.name} and ${d.opponent.name} don draw. Nobody sabi pass!`
      : 'Na draw! Nobody sabi pass.';
  }
  const w = winner.name ?? 'Player';
  if (d.forfeit) return `${w} win am! ${loser.name ?? 'The other player'} no show.`;
  return `${w} don school ${loser.name ?? 'am'}${d.category ? ` for ${d.category}` : ''}`;
}

/** The duel result for WhatsApp Status (mockup 14), told from the winner's side. */
export async function duelCard(d: DuelCardData, url: string, host: string): Promise<Node> {
  const youWon = d.result === 'win';
  const winner = d.result === 'loss' ? d.opponent : d.you;
  const side = (p: CardPlayer, lead: boolean, color: string) => {
    const name = p.name ?? 'Player';
    return h(
      'div',
      { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: 340 },
      initial(name, 190, color, lead ? C.gold : '#E8E2D2'),
      h('div', { display: 'flex', color: C.ink, fontSize: name.length > 12 ? 32 : 40, ...body(800) }, name),
      h(
        'div',
        { display: 'flex', color: lead ? C.right : C.ink, fontSize: 104, lineHeight: 1, ...display },
        number(p.score),
      ),
    );
  };
  const challenge =
    d.result !== 'draw' && winner.name ? `Think you sabi pass ${winner.name}?` : 'Think you sabi pass dem?';
  const card = h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      padding: '64px 48px',
      borderRadius: 56,
      backgroundColor: C.cream,
      gap: 40,
    },
    h(
      'div',
      { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 },
      side(d.you, youWon || d.result === 'draw', C.green),
      h('div', { display: 'flex', color: '#5A6660', fontSize: 52, ...display }, 'vs'),
      side(d.opponent, d.result === 'loss' || d.result === 'draw', '#C0392B'),
    ),
    d.highlight
      ? h(
          'div',
          {
            display: 'flex',
            padding: '16px 36px',
            borderRadius: 999,
            backgroundColor: C.goldTint,
            color: C.ink,
            fontSize: 38,
            ...body(800),
          },
          d.highlight,
        )
      : null,
    h(
      'div',
      {
        display: 'flex',
        width: '100%',
        justifyContent: 'center',
        textAlign: 'center',
        color: C.ink,
        fontSize: 76,
        lineHeight: 1.1,
        ...display,
      },
      duelCaption(d),
    ),
  );
  return statusFrame('DUEL RESULT', card, await statusFooter(challenge, url, host));
}

export interface DailyCardData {
  number: number;
  correct: number;
  total: number;
  seconds: number;
  grid: string;
  labels: string[];
  streak: number;
  percentile: number | null;
}

/** A Daily result for WhatsApp Status: the squares and the score, never the answers. */
export async function dailyCard(d: DailyCardData, url: string, host: string): Promise<Node> {
  const squares = h(
    'div',
    { display: 'flex', gap: 14, justifyContent: 'center' },
    ...[...d.grid].map((cell, i) =>
      h(
        'div',
        { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
        h('div', {
          width: 112,
          height: 112,
          borderRadius: 22,
          backgroundColor: cell === 'G' ? C.right : C.wrong,
        }),
        h('div', { display: 'flex', color: '#5A6660', fontSize: 26, ...body(700) }, d.labels[i] ?? ''),
      ),
    ),
  );
  const card = h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      padding: '64px 40px',
      borderRadius: 56,
      backgroundColor: C.cream,
      gap: 36,
    },
    h(
      'div',
      { display: 'flex', color: C.ink, fontSize: 200, lineHeight: 1, ...display },
      `${d.correct}/${d.total}`,
    ),
    h('div', { display: 'flex', color: C.inkSoft, fontSize: 44, ...body(700) }, `in ${d.seconds} seconds`),
    squares,
    d.streak > 1
      ? h('div', { display: 'flex', color: C.orange, fontSize: 52, ...body(800) }, `${d.streak}-day streak`)
      : null,
    d.percentile !== null
      ? h(
          'div',
          {
            display: 'flex',
            padding: '16px 36px',
            borderRadius: 999,
            backgroundColor: C.greenTint,
            color: C.greenInk,
            fontSize: 40,
            ...body(800),
          },
          `Sabi pass ${d.percentile}% of Naija today`,
        )
      : null,
  );
  return statusFrame(`DAILY SABI #${d.number}`, card, await statusFooter("Play today's Daily", url, host));
}
