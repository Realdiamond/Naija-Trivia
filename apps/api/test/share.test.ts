/**
 * Sharing (step 2.5a, doc 09 §5): link previews for pages of the web app, the pictures behind
 * them, Status pictures of a finished duel or Daily, and the app-link files.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateDuelResponse,
  DailyToday,
  DuelAnswerResponse,
  DuelView,
  ServedQuestion,
} from '@whosabi/shared-types';
import { duelCaption } from '../src/share/cards';
import { ShareService } from '../src/share/service';
import { ServerEvents } from '../src/events';
import { withPageMeta } from '../src/web';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

const CERT = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, '0')).join(':');

let t: Awaited<ReturnType<typeof createTestApp>>;
let share: ShareService;
beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'web-build-'));
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>Who Sabi?</title></head><body><div id="root"></div></body></html>',
  );
  t = await createTestApp({ WEB_APP_DIR: dir, ANDROID_CERT_SHA256: CERT, APPLE_TEAM_ID: 'AB12CD34EF' });
  share = new ShareService({
    config: t.config,
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  });
});
afterAll(() => t.close());

interface Player {
  id: string;
  access: string;
}

async function player(): Promise<Player> {
  const guest = await signInGuest(t.app);
  return { id: guest.user.id, access: guest.access };
}

/** Gives a player a public name, or a 13–17 account whose name stays private. */
async function named(p: Player, username: string, status: 'active' | 'restricted' = 'active') {
  await t.pool.query(`UPDATE users SET username = $2, status = $3::user_status WHERE id = $1`, [
    p.id,
    username,
    status,
  ]);
}

const get = (p: Player | null, url: string) =>
  t.app.inject({ method: 'GET', url, headers: p ? bearer(p.access) : {} });
const post = (p: Player, url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(p.access), ...(payload ? { payload } : {}) });

/** Width and height from a PNG's header. */
function pngSize(body: Buffer): { width: number; height: number } {
  expect(body.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

async function rightIndex(q: ServedQuestion): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [q.qid],
    )
  ).rows[0]!;
  return q.options.indexOf(row.options[row.correct_index]!);
}

/** Plays everything the player can do now, every answer right or every answer wrong. */
async function playTurn(p: Player, duelId: string, mode: 'right' | 'wrong'): Promise<void> {
  let next = ((await get(p, `/v1/duels/${duelId}`)).json() as DuelView).next;
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await post(p, `/v1/duels/${duelId}/rounds/${next.round}/category`, {
        category_id: next.offered[0],
      });
      next = (res.json() as DuelView).next;
      continue;
    }
    const base = `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}`;
    const served = (await post(p, `${base}/serve`)).json() as ServedQuestion;
    const right = await rightIndex(served);
    t.clock.advance(3000);
    const res = await post(p, `${base}/answer`, {
      display_index: mode === 'right' ? right : (right + 1) % served.options.length,
      client_elapsed_ms: 2800,
    });
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
  }
}

/** A duel `a` wins: every answer of a's right, every answer of b's wrong. */
async function wonDuel(a: Player, b: Player): Promise<string> {
  await befriend(t.pool, a.id, b.id);
  const created = (await post(a, '/v1/duels', { opponent: { user_id: b.id } })).json() as CreateDuelResponse;
  for (const [p, mode] of [
    [a, 'right'],
    [b, 'wrong'],
    [a, 'right'],
    [b, 'wrong'],
  ] as const) {
    await playTurn(p, created.duel.id, mode);
  }
  return created.duel.id;
}

describe('link previews', () => {
  it('gives a challenge link its challenger, and other pages the game itself', async () => {
    const a = await player();
    await named(a, 'tolu_share');
    const { invite_url } = (
      await post(a, '/v1/duels', { opponent: { link: true } })
    ).json() as CreateDuelResponse;
    const token = invite_url!.split('/d/')[1]!;

    const page = await get(null, `/d/${token}`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.body).toContain(
      '<meta property="og:title" content="tolu_share don challenge you on Who Sabi?">',
    );
    expect(page.body).toContain(
      `<meta property="og:image" content="https://whosabi.ng/og/invite/${token}.png">`,
    );
    expect(page.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page.body).toContain('<div id="root">');

    // A party link says what it is, even before anyone looks the room up.
    const party = await get(null, '/r/k7qxm');
    expect(party.body).toContain(
      '<meta property="og:title" content="Join the party on Who Sabi? Room K7QXM">',
    );

    for (const url of ['/', '/home', `/d/${'x'.repeat(22)}`]) {
      const other = await get(null, url);
      expect(other.statusCode, url).toBe(200);
      expect(other.body, url).toContain(
        '<meta property="og:image" content="https://whosabi.ng/og/default.png">',
      );
    }
  });

  it('gives a friend code its player, and the player their link and QR code (step 2.12)', async () => {
    const a = await player();
    await named(a, 'ada_code');
    const page = await get(null, '/u/ada_code');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<meta property="og:title" content="Add ada_code on Who Sabi?">');
    // Someone we don't know gets the game's own preview.
    expect((await get(null, '/u/nobody_here')).body).toContain(
      '<meta property="og:image" content="https://whosabi.ng/og/default.png">',
    );

    const code = await get(a, '/v1/me/friend-code');
    expect(code.statusCode, code.body).toBe(200);
    expect(code.json().url).toBe('https://whosabi.ng/u/ada_code');
    expect(code.json().svg).toMatch(/^<svg/);
    // A guest has no username to share yet.
    expect((await get(await player(), '/v1/me/friend-code')).statusCode).toBe(403);
  });

  it('never names a 13–17 challenger', async () => {
    const a = await player();
    await named(a, 'young_share', 'restricted');
    const { invite_url } = (
      await post(a, '/v1/duels', { opponent: { link: true } })
    ).json() as CreateDuelResponse;
    const page = await get(null, new URL(invite_url!).pathname);
    expect(page.body).toContain('content="Someone don challenge you on Who Sabi?"');
    expect(page.body).not.toContain('young_share');
  });

  it('previews a Daily that has been played, and no other', async () => {
    const p = await player();
    const { id } = (await get(p, '/v1/daily/today')).json() as DailyToday;
    expect((await get(null, `/daily/${id}`)).body).toContain(`content="Daily Sabi #${id}"`);
    expect((await get(null, `/daily/${id + 5}`)).body).toContain('/og/default.png');
  });

  it('escapes what goes into the page', () => {
    const html = withPageMeta('<head></head>', {
      title: 'A "quote" & <b>tag</b>',
      description: "It's $& $1",
      image: 'https://whosabi.ng/og/default.png',
      url: 'https://whosabi.ng/',
    });
    expect(html).toContain('content="A &quot;quote&quot; &amp; &lt;b&gt;tag&lt;/b&gt;"');
    expect(html).toContain('content="It&#39;s $&amp; $1"');
  });
});

describe('preview pictures', () => {
  it('draws the pictures at 1200×630, for links that exist', async () => {
    const a = await player();
    const { invite_url } = (
      await post(a, '/v1/duels', { opponent: { link: true } })
    ).json() as CreateDuelResponse;
    const token = invite_url!.split('/d/')[1]!;
    const { id } = (await get(a, '/v1/daily/today')).json() as DailyToday;

    for (const url of ['/og/default.png', `/og/invite/${token}.png`, `/og/daily/${id}.png`]) {
      const res = await get(null, url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/);
      expect(pngSize(res.rawPayload)).toEqual({ width: 1200, height: 630 });
      // WhatsApp shows no preview for pictures over 300 KB.
      expect(res.rawPayload.length).toBeLessThan(300_000);
    }
    for (const url of [
      `/og/invite/${'x'.repeat(22)}.png`,
      `/og/daily/${id + 1}.png`,
      '/og/daily/abc',
      '/og/other',
    ]) {
      const res = await get(null, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});

describe('Status pictures', () => {
  it('draws a finished duel for its two players only', async () => {
    const [a, b, stranger] = await Promise.all([player(), player(), player()]);
    const duelId = await wonDuel(a, b);
    for (const p of [a, b]) {
      const res = await get(p, `/v1/share/duels/${duelId}/card.png`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
      expect(pngSize(res.rawPayload)).toEqual({ width: 1080, height: 1920 });
    }
    expect((await get(stranger, `/v1/share/duels/${duelId}/card.png`)).statusCode).toBe(404);
    expect((await get(null, `/v1/share/duels/${duelId}/card.png`)).statusCode).toBe(401);
  });

  it('waits for the duel to end', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    await befriend(t.pool, a.id, b.id);
    const { duel } = (
      await post(a, '/v1/duels', { opponent: { user_id: b.id } })
    ).json() as CreateDuelResponse;
    expect((await get(a, `/v1/share/duels/${duel.id}/card.png`)).statusCode).toBe(409);
  });

  it('names players who have a public name and nobody else', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const duelId = await wonDuel(a, b);
    await named(a, 'winner_share');

    // b is a guest: no name, so the caption says "am".
    const fromA = await share.duelCardData(duelId, a.id);
    expect(fromA).toMatchObject({ result: 'win', you: { name: 'winner_share' }, opponent: { name: null } });
    expect(fromA.you.score).toBeGreaterThan(0);
    expect(fromA.opponent.score).toBe(0);
    expect(fromA.highlight).toMatch(/^.+ round: \d+ to 0$/);
    expect(duelCaption(fromA)).toBe(`winner_share don school am for ${fromA.category}`);

    // b turns 13–17: still no name.
    await named(b, 'loser_share', 'restricted');
    const fromB = await share.duelCardData(duelId, b.id);
    expect(fromB).toMatchObject({ result: 'loss', you: { name: null }, opponent: { name: 'winner_share' } });

    await named(b, 'loser_share');
    expect(duelCaption(await share.duelCardData(duelId, b.id))).toBe(
      `winner_share don school loser_share for ${fromA.category}`,
    );
  });

  it('draws a Daily for the player once they have finished it', async () => {
    const p = await player();
    const { id } = (await get(p, '/v1/daily/today')).json() as DailyToday;
    expect((await get(p, `/v1/share/daily/${id}/card.png`)).statusCode).toBe(409);
    for (let seq = 1; seq <= 7; seq++) {
      const served = (await post(p, `/v1/daily/${id}/questions/${seq}/serve`)).json() as ServedQuestion;
      const res = await post(p, `/v1/daily/${id}/questions/${seq}/answer`, {
        display_index: await rightIndex(served),
        client_elapsed_ms: 3000,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    const res = await get(p, `/v1/share/daily/${id}/card.png`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(pngSize(res.rawPayload)).toEqual({ width: 1080, height: 1920 });
  });
});

describe('duel captions', () => {
  const base = { forfeit: false, highlight: null, category: 'Food' } as const;
  it('reads right for every outcome', () => {
    const tolu = { name: 'tolu', score: 900 };
    const ada = { name: 'ada', score: 700 };
    expect(duelCaption({ ...base, you: tolu, opponent: ada, result: 'win' })).toBe(
      'tolu don school ada for Food',
    );
    expect(duelCaption({ ...base, you: ada, opponent: tolu, result: 'loss' })).toBe(
      'tolu don school ada for Food',
    );
    expect(duelCaption({ ...base, you: { name: null, score: 900 }, opponent: ada, result: 'win' })).toBe(
      'Player don school ada for Food',
    );
    expect(duelCaption({ ...base, you: tolu, opponent: ada, result: 'draw' })).toBe(
      'tolu and ada don draw. Nobody sabi pass!',
    );
    expect(duelCaption({ ...base, you: tolu, opponent: { name: null, score: 0 }, result: 'draw' })).toBe(
      'Na draw! Nobody sabi pass.',
    );
    expect(duelCaption({ ...base, forfeit: true, you: tolu, opponent: ada, result: 'win' })).toBe(
      'tolu win am! ada no show.',
    );
  });
});

describe('app links', () => {
  it('lets the Android app open whosabi.ng links', async () => {
    const res = await get(null, '/.well-known/assetlinks.json');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'ng.whosabi.app',
          sha256_cert_fingerprints: [CERT.toUpperCase()],
        },
      },
    ]);
  });

  it('lets the iOS app open challenge, duel and Daily links', async () => {
    const res = await get(null, '/.well-known/apple-app-site-association');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['AB12CD34EF.ng.whosabi.app'],
            components: [{ '/': '/d/*' }, { '/': '/daily/*' }, { '/': '/duel/*' }, { '/': '/u/*' }],
          },
        ],
      },
    });
  });

  it('claims nothing until the app is signed', async () => {
    const plain = await createTestApp();
    try {
      expect((await plain.app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })).json()).toEqual(
        [],
      );
      expect(
        (await plain.app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' }))
          .statusCode,
      ).toBe(404);
    } finally {
      await plain.close();
    }
  });
});
