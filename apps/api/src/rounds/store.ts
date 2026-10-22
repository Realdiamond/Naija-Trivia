/**
 * Solo round state in Redis (doc 08 §3). Nothing here is mutated in place:
 *   round:{id}                      the round definition
 *   served:{round}:{qid}:{user}     first serve time (SET NX: refreshing never resets the timer)
 *   answer:{round}:{seq}            the scored answer (SET NX: double taps and retries are idempotent)
 * Running score and streak are derived from the stored answers, so there are no counters to race on.
 */
import type { Redis } from 'ioredis';
import type { RoundMode } from '@whosabi/shared-types';

export const ROUND_TTL_SECONDS = 3600;

export interface RoundDef {
  id: string;
  userId: string;
  mode: RoundMode;
  questionIds: string[];
  categories: string[];
  timeLimitMs: number;
  createdAt: number;
}

export interface StoredAnswer {
  seq: number;
  qid: string;
  correct: boolean;
  timedOut: boolean;
  points: number;
  breakdown: { base: number; speed: number; streak: number };
  streakAfter: number;
  acceptedMs: number;
  serverElapsedMs: number;
  clientElapsedMs: number | null;
  rttEstMs: number;
  displayIndex: number | null;
  canonicalIndex: number | null;
  correctDisplayIndex: number;
  tabHiddenMs: number | null;
  answeredAt: number;
}

export class RoundStore {
  constructor(private readonly redis: Redis) {}

  async create(round: RoundDef): Promise<void> {
    await this.redis.set(`round:${round.id}`, JSON.stringify(round), 'EX', ROUND_TTL_SECONDS);
  }

  async get(roundId: string): Promise<RoundDef | null> {
    const raw = await this.redis.get(`round:${roundId}`);
    return raw ? (JSON.parse(raw) as RoundDef) : null;
  }

  /** Record the first serve; later serves return the original time. */
  async markServed(roundId: string, qid: string, userId: string, atMs: number) {
    const key = `served:${roundId}:${qid}:${userId}`;
    const set = await this.redis.set(key, String(atMs), 'EX', ROUND_TTL_SECONDS, 'NX');
    if (set === 'OK') return { servedAtMs: atMs, first: true };
    return { servedAtMs: Number(await this.redis.get(key)), first: false };
  }

  async servedAt(roundId: string, qid: string, userId: string): Promise<number | null> {
    const raw = await this.redis.get(`served:${roundId}:${qid}:${userId}`);
    return raw === null ? null : Number(raw);
  }

  /** Keep the first answer; a second attempt gets the stored one back. */
  async saveAnswer(roundId: string, answer: StoredAnswer) {
    const key = `answer:${roundId}:${answer.seq}`;
    const set = await this.redis.set(key, JSON.stringify(answer), 'EX', ROUND_TTL_SECONDS, 'NX');
    if (set === 'OK') return { answer, first: true };
    return { answer: JSON.parse((await this.redis.get(key))!) as StoredAnswer, first: false };
  }

  async answers(roundId: string, total: number): Promise<Array<StoredAnswer | null>> {
    const keys = Array.from({ length: total }, (_, i) => `answer:${roundId}:${i + 1}`);
    const raw = await this.redis.mget(...keys);
    return raw.map((r) => (r ? (JSON.parse(r) as StoredAnswer) : null));
  }
}
