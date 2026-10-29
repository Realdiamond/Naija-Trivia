/**
 * What a shared link shows (doc 09 §5): the title and picture WhatsApp, X and others show for a
 * page of the web app, and the Status pictures players share after a duel or a Daily.
 *
 * Only active accounts are named in pictures: guests have no name, and 13–17s have no public
 * one (doc 10 §3.3). Pictures are drawn only for duels, invites and Dailies that exist, so made-up
 * links cost nothing.
 */
import type { FastifyRequest } from 'fastify';
import { isFinished, watDate, type DuelState } from '@whosabi/game-rules';
import { ErrorCode } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { DailyService } from '../daily/service';
import { getAnswers, getDuel, getPlayers, getRounds, playerFor, sideOf, type PlayerRow } from '../duels/repo';
import { resultFor } from '../duels/view';
import { conflict, notFound } from '../errors';
import { dailyCard, duelCard, previewCard, type CardPlayer, type DuelCardData } from './cards';
import { renderPng, type Node } from './render';

export type ShareDeps = Pick<AppDeps, 'config' | 'pool' | 'redis' | 'clock' | 'events' | 'log'>;

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL of a 1200×630 PNG. */
  image: string;
  url: string;
}

export const PREVIEW = { width: 1200, height: 630 };
export const STATUS = { width: 1080, height: 1920 };

const DEFAULT_TITLE = 'Who Sabi? Naija trivia duels';
const DEFAULT_DESCRIPTION =
  'Challenge your people to Naija trivia: slang, Nollywood, music and food. Free to play.';

interface InviteRow {
  state: string;
  player_b: string | null;
  username: string | null;
  status: string;
}

/** The name a picture may show for a player, or null for "no public name". */
export function publicName(player: Pick<PlayerRow, 'username' | 'status'> | undefined): string | null {
  return player?.status === 'active' && player.username ? player.username : null;
}

export class ShareService {
  private readonly daily: DailyService;

  constructor(private readonly deps: ShareDeps) {
    this.daily = new DailyService(deps);
  }

  private get base(): string {
    return this.deps.config.publicWebUrl;
  }

  private get host(): string {
    return this.base.replace(/^https?:\/\//, '');
  }

  private async invite(token: string): Promise<InviteRow | null> {
    const result = await this.deps.pool.query<InviteRow>(
      `SELECT d.state, d.player_b, u.username, u.status
         FROM duels d JOIN users u ON u.id = d.player_a
        WHERE d.invite_token = $1`,
      [token],
    );
    return result.rows[0] ?? null;
  }

  /** A Daily that has been played already (today's or earlier), never tomorrow's. */
  private async dailyExists(n: number): Promise<boolean> {
    const result = await this.deps.pool.query(
      'SELECT 1 FROM daily_challenges WHERE id = $1 AND play_date <= $2',
      [n, watDate(this.deps.clock.now())],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** The link preview for a page of the web app; the game's own one for any page without its own. */
  async pageMeta(pathname: string): Promise<PageMeta> {
    const fallback: PageMeta = {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      image: `${this.base}/og/default.png`,
      url: `${this.base}${pathname === '/' ? '' : pathname}`,
    };
    const invite = /^\/d\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
    if (invite) {
      const row = await this.invite(invite[1]!);
      if (!row) return fallback;
      const name = publicName(row);
      return {
        ...fallback,
        title: `${name ?? 'Someone'} don challenge you on Who Sabi?`,
        description: 'Three rounds of Naija trivia. Accept the duel and show who sabi pass.',
        image: `${this.base}/og/invite/${invite[1]}.png`,
      };
    }
    const party = /^\/r\/([A-Za-z0-9]{5})\/?$/.exec(pathname);
    if (party) {
      return {
        ...fallback,
        title: `Join the party on Who Sabi? Room ${party[1]!.toUpperCase()}`,
        description: 'Naija trivia with the whole group, live. Play in your browser: no app, no sign-up.',
      };
    }
    // A friend code (step 2.12): whosabi.ng/u/{username}.
    const friend = /^\/u\/([A-Za-z0-9_]{3,20})\/?$/.exec(pathname);
    if (friend) {
      const found = await this.deps.pool.query<{ username: string }>(
        "SELECT username FROM users WHERE username = $1 AND status = 'active'",
        [friend[1]],
      );
      const name = found.rows[0]?.username;
      if (!name) return fallback;
      return {
        ...fallback,
        title: `Add ${name} on Who Sabi?`,
        description: 'Naija trivia with your own people. Add them as a friend and challenge them to a duel.',
      };
    }
    const daily = /^\/daily\/(\d{1,7})\/?$/.exec(pathname);
    if (daily && (await this.dailyExists(Number(daily[1])))) {
      return {
        ...fallback,
        title: `Daily Sabi #${daily[1]}`,
        description: "Seven questions, one try a day. See how far you go on today's Daily.",
        image: `${this.base}/og/daily/${daily[1]}.png`,
      };
    }
    return fallback;
  }

  // ----- Link preview pictures, 1200×630 -----

  defaultPreview(): Promise<Buffer> {
    return this.png('og:default', previewCard('Who sabi pass?', DEFAULT_DESCRIPTION, this.host), PREVIEW);
  }

  async invitePreview(token: string): Promise<Buffer> {
    const row = await this.invite(token);
    if (!row) throw notFound('This challenge link does not exist.');
    const name = publicName(row);
    const open = row.player_b === null && !isFinished(row.state as DuelState);
    const headline = `${name ?? 'Someone'} don challenge you!`;
    const subline = open
      ? 'Three rounds of Naija trivia. Accept the duel and show who sabi pass.'
      : 'This duel has started. Start your own and show who sabi pass.';
    return this.png(`og:invite:${token}:${name}:${open}`, previewCard(headline, subline, this.host), PREVIEW);
  }

  async dailyPreview(n: number): Promise<Buffer> {
    if (!(await this.dailyExists(n))) throw notFound('There is no Daily with this number.');
    const card = previewCard(
      `Daily Sabi #${n}`,
      'Seven questions, one try a day. How far you fit go?',
      this.host,
    );
    return this.png(`og:daily:${n}`, card, PREVIEW);
  }

  // ----- Status pictures, 1080×1920 -----

  /** A finished duel, for one of its two players to share (mockup 14). */
  async duelCard(duelId: string, viewer: string): Promise<Buffer> {
    const data = await this.duelCardData(duelId, viewer);
    const card = await duelCard(data, `${this.base}/`, this.host);
    const { you, opponent } = data;
    const key = ['duel', duelId, viewer, you.name, opponent.name, you.score, opponent.score].join(':');
    return this.png(key, card, STATUS);
  }

  /** What the duel picture says, worked out from the viewer's side. */
  async duelCardData(duelId: string, viewer: string): Promise<DuelCardData> {
    const { pool } = this.deps;
    const duel = await getDuel(pool, duelId);
    const side = duel ? sideOf(duel, viewer) : null;
    if (!duel || !side) throw notFound('This duel does not exist.');
    const result = resultFor(duel, side);
    if (!result) throw conflict(ErrorCode.conflict, 'This duel is not over', 'Share it once it ends.');
    const opponentId = playerFor(duel, side === 'a' ? 'b' : 'a');
    const [rounds, answers, players, names] = await Promise.all([
      getRounds(pool, [duel.id]),
      getAnswers(pool, [duel.id]),
      getPlayers(pool, [viewer, ...(opponentId ? [opponentId] : [])]),
      this.categoryNames(),
    ]);
    const pointsIn = (userId: string | null, round: number) =>
      answers
        .filter((a) => a.user_id === userId && a.round_no === round && a.received_at !== null)
        .reduce((sum, a) => sum + a.points, 0);
    const scored = rounds
      .filter((r) => r.round_no <= 3 && r.category_id !== null)
      .map((r) => ({
        category: r.category_id!,
        you: pointsIn(viewer, r.round_no),
        them: pointsIn(opponentId, r.round_no),
      }));
    const you: CardPlayer = {
      name: publicName(players.get(viewer)),
      score: scored.reduce((s, r) => s + r.you, 0),
    };
    const opponent: CardPlayer = {
      name: opponentId ? publicName(players.get(opponentId)) : null,
      score: scored.reduce((s, r) => s + r.them, 0),
    };
    // The round the winner took by the most: "Food round: 486 to 386".
    const sign = result === 'win' ? 1 : result === 'loss' ? -1 : 0;
    const margin = (r: (typeof scored)[number]) => sign * (r.you - r.them);
    const won = scored.reduce<(typeof scored)[number] | undefined>(
      (best, r) => (margin(r) > 0 && (!best || margin(r) > margin(best)) ? r : best),
      undefined,
    );
    const category = won ? (names.get(won.category) ?? null) : null;
    const highlight =
      won && category
        ? `${category} round: ${Math.max(won.you, won.them)} to ${Math.min(won.you, won.them)}`
        : null;
    return { you, opponent, result, forfeit: duel.state === 'forfeit', highlight, category };
  }

  /** A finished Daily, for the player who played it: squares and score, never the answers. */
  async dailyCard(dailyId: number, viewer: string, request: FastifyRequest): Promise<Buffer> {
    const [result, names] = await Promise.all([
      this.daily.result(dailyId, viewer, request),
      this.categoryNames(),
    ]);
    const data = {
      number: result.id,
      correct: result.correct_count,
      total: result.total,
      seconds: Math.round(result.total_ms / 1000),
      grid: result.grid,
      labels: result.categories.map((c) => names.get(c) ?? ''),
      streak: result.streak.current,
      percentile: result.percentile,
    };
    const card = await dailyCard(data, result.share_url, this.host);
    const key = [
      'daily',
      data.number,
      viewer,
      data.correct,
      data.seconds,
      data.grid,
      data.streak,
      data.percentile,
    ].join(':');
    return this.png(key, card, STATUS);
  }

  private async categoryNames(): Promise<Map<string, string>> {
    const rows = await this.deps.pool.query<{ id: string; name_en: string }>(
      'SELECT id, name_en FROM categories',
    );
    return new Map(rows.rows.map((r) => [r.id, r.name_en]));
  }

  private png(key: string, node: Node, size: { width: number; height: number }): Promise<Buffer> {
    return renderPng(key, node, size.width, size.height);
  }
}
