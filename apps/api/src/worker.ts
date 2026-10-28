/**
 * The worker (build plan steps 1.3, 2.1 and 2.6): a second process beside the API that ends
 * overdue duels, sends turn reminders, picks the Daily, saves final leaderboard ranks, retires
 * expired questions, moves question stats into Postgres and loads analytics events.
 *
 * Every job is safe with several workers running (locked rows, claimed reminder rows, a Redis
 * lock, a stream consumer group), so the worker scales by running more copies and needs no job
 * queue yet. A failed run is logged and tried again on the next tick.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pino } from 'pino';
import { systemClock } from './clock';
import { loadConfig } from './config';
import { DailyService } from './daily/service';
import { createPool } from './db';
import { DuelService } from './duels/service';
import { ServerEvents } from './events';
import { AnalyticsLoader } from './jobs/analyticsLoader';
import { retireExpiredQuestions } from './jobs/contentExpiry';
import { expireDueDuels } from './jobs/expiry';
import { flushQuestionStats } from './jobs/questionStats';
import { sendTurnReminders } from './jobs/reminders';
import { migrate } from './migrate';
import { LogNotifier } from './notify';
import { createRedis } from './redis';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const config = loadConfig();
const log = pino({ level: config.logLevel, base: { service: 'worker' } });
const pool = createPool(config.databaseUrl);
const redis = createRedis(config, { maxRetriesPerRequest: 2 });
// A blocking stream read holds its connection, so the loader gets one of its own.
const streamRedis = createRedis(config, { maxRetriesPerRequest: null });
const events = new ServerEvents(redis, config.analyticsKey, systemClock, log);
const deps = { config, pool, redis, clock: systemClock, events, log };
const duels = new DuelService(deps);
const daily = new DailyService(deps);
const notifier = new LogNotifier(log);
const loader = new AnalyticsLoader({ ...deps, redis: streamRedis });

if (config.env !== 'production') await migrate(pool);
await loader.ensureGroup();

const stop = new AbortController();
const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => undefined);

/** Runs `job` every `intervalMs`, one run at a time, until shutdown. */
async function every(name: string, intervalMs: number, job: () => Promise<unknown>): Promise<void> {
  while (!stop.signal.aborted) {
    try {
      const result = await job();
      if (result) log.info({ job: name, result }, 'job done');
    } catch (err) {
      log.error({ err, job: name }, 'job failed');
    }
    await pause(intervalMs);
  }
}

async function loadEvents(): Promise<void> {
  while (!stop.signal.aborted) {
    try {
      await loader.loadOnce(5 * SECOND);
    } catch (err) {
      if (stop.signal.aborted) return; // shutdown closed the connection mid-read; nothing was lost
      log.error({ err, job: 'analytics-loader' }, 'job failed');
      await pause(5 * SECOND);
    }
  }
}

const jobs = [
  every('expire-duels', 30 * SECOND, () => expireDueDuels(duels)),
  every('turn-reminders', MINUTE, () => sendTurnReminders(deps, notifier)),
  every('daily-schedule', 5 * MINUTE, () => daily.schedule()),
  every('leaderboard-snapshot', 10 * MINUTE, () => daily.snapshot()),
  every('question-expiry', 60 * MINUTE, () => retireExpiredQuestions(deps)),
  every('question-stats', MINUTE, () => flushQuestionStats(deps)),
  every('analytics-upkeep', 60 * MINUTE, () => loader.maintain(config.analyticsRetentionDays)),
  loadEvents(),
];
log.info('worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  stop.abort();
  streamRedis.disconnect(); // ends a blocking read at once
  await Promise.allSettled(jobs);
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
