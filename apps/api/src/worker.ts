/**
 * The worker (build plan steps 1.3, 2.1, 2.3, 2.5 and 2.6): a second process beside the API that
 * ends overdue duels, seats the Sabi Bot in random duels nobody took and plays its turns, sends
 * pushes and queues turn and Daily reminders, picks the Daily, saves final leaderboard ranks,
 * retires expired questions, moves question stats into Postgres and loads analytics events.
 *
 * Every job is safe with several workers running (locked rows, claimed reminder rows, a Redis
 * lock, a stream consumer group), so the worker scales by running more copies and needs no job
 * queue yet. A failed run is logged and tried again on the next tick.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pino } from 'pino';
import { raiseStaffAlert, sendStaffAlerts } from './admin/alerts';
import { systemClock } from './clock';
import { loadConfig } from './config';
import { DailyService } from './daily/service';
import { createPool } from './db';
import { DuelService } from './duels/service';
import { ServerEvents } from './events';
import { AnalyticsLoader } from './jobs/analyticsLoader';
import { calibrateQuestions } from './jobs/calibration';
import { checkIntegrity } from './jobs/integrity';
import { LiveOpsStore } from './liveops/store';
import { processCorrections } from './content/rescore';
import { retireExpiredQuestions } from './jobs/contentExpiry';
import { expireDueDuels } from './jobs/expiry';
import { checkLedger } from './jobs/ledgerCheck';
import { flushQuestionStats } from './jobs/questionStats';
import { queueDailyReminders } from './jobs/dailyReminder';
import { queueTurnReminders } from './jobs/reminders';
import { migrate } from './migrate';
import { flushReports, reportError, startMonitoring } from './monitoring';
import { prunePushes, sendDuePushes } from './push/dispatch';
import { FcmTransport, LogTransport, PushRouter } from './push/transport';
import { WebPushTransport } from './push/webpush';
import { createRedis } from './redis';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const config = loadConfig();
const log = pino({ level: config.logLevel, base: { service: 'worker' } });
startMonitoring(config, 'worker');
const pool = createPool(config.databaseUrl);
const redis = createRedis(config, { maxRetriesPerRequest: 2 });
// A blocking stream read holds its connection, so the loader gets one of its own.
const streamRedis = createRedis(config, { maxRetriesPerRequest: null });
const events = new ServerEvents(redis, config.analyticsKey, systemClock, log);
// The tuned game and economy values (step 2.7g), for duels the Sabi Bot finishes and re-scoring.
const liveops = new LiveOpsStore(pool, systemClock.now);
const deps = { config, pool, redis, clock: systemClock, events, log, liveops };
const duels = new DuelService(deps);
const daily = new DailyService(deps);
// Real pushes once each service is set up; until then they go to the log.
const transport = new PushRouter(
  {
    android: config.firebaseServiceAccount
      ? new FcmTransport(config.firebaseServiceAccount)
      : new LogTransport(log),
    web: config.webPush ? new WebPushTransport(config.webPush) : new LogTransport(log, 'VAPID_PRIVATE_KEY'),
  },
  new LogTransport(log, 'iOS build'),
);
const loader = new AnalyticsLoader({ ...deps, redis: streamRedis });

if (config.env !== 'production') await migrate(pool);
await loader.ensureGroup();

const stop = new AbortController();
const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => undefined);

/** A job that fails this many runs in a row raises a staff alert (step 2.9b). */
const FAILURES_TO_ALERT = 3;

/** Runs `job` every `intervalMs`, one run at a time, until shutdown. */
async function every(name: string, intervalMs: number, job: () => Promise<unknown>): Promise<void> {
  let failures = 0;
  while (!stop.signal.aborted) {
    try {
      const result = await job();
      failures = 0;
      if (result) log.info({ job: name, result }, 'job done');
    } catch (err) {
      log.error({ err, job: name }, 'job failed');
      // Reported once per run of failures, not every tick.
      if (++failures === 1) reportError(err, { job: name });
      if (failures === FAILURES_TO_ALERT) await jobFailing(name, err);
    }
    await pause(intervalMs);
  }
}

/** At most one alert per job every 6 hours, however many workers see it fail. */
async function jobFailing(name: string, err: unknown): Promise<void> {
  const now = systemClock.now();
  const message = err instanceof Error ? err.message : String(err);
  await raiseStaffAlert(pool, {
    kind: 'problem',
    title: 'A background job keeps failing',
    body: `“${name}” failed ${FAILURES_TO_ALERT} times in a row: ${message.slice(0, 120)}`,
    dedupeKey: `job_failing:${name}:${Math.floor(now / (6 * 3_600_000))}`,
    now,
  }).catch((alertErr: unknown) => log.error({ err: alertErr }, 'could not raise a staff alert'));
}

async function loadEvents(): Promise<void> {
  while (!stop.signal.aborted) {
    try {
      await loader.loadOnce(5 * SECOND);
    } catch (err) {
      if (stop.signal.aborted) return; // shutdown closed the connection mid-read; nothing was lost
      log.error({ err, job: 'analytics-loader' }, 'job failed');
      reportError(err, { job: 'analytics-loader' });
      await pause(5 * SECOND);
    }
  }
}

const jobs = [
  every('expire-duels', 30 * SECOND, () => expireDueDuels(duels)),
  every('sabi-bot-seats', 5 * SECOND, () => duels.seatBots()),
  every('sabi-bot-turns', 5 * SECOND, () => duels.playBotTurns()),
  every('push-send', 5 * SECOND, () => sendDuePushes(deps, transport)),
  every('staff-alerts', 5 * SECOND, () => sendStaffAlerts(deps, transport)),
  every('turn-reminders', MINUTE, () => queueTurnReminders(deps)),
  every('daily-reminder', 5 * MINUTE, () => queueDailyReminders(deps)),
  every('push-prune', 60 * MINUTE, () => prunePushes(deps)),
  every('daily-schedule', 5 * MINUTE, () => daily.schedule()),
  every('leaderboard-snapshot', 10 * MINUTE, () => daily.snapshot()),
  every('question-expiry', 60 * MINUTE, () => retireExpiredQuestions(deps)),
  every('question-stats', MINUTE, () => flushQuestionStats(deps)),
  every('question-calibration', 10 * MINUTE, () => calibrateQuestions(deps)),
  every('integrity-checks', 10 * MINUTE, () => checkIntegrity(deps)),
  every('rescore', MINUTE, () => processCorrections(deps)),
  every('ledger-check', 10 * MINUTE, () => checkLedger(deps)),
  every('analytics-upkeep', 60 * MINUTE, () => loader.maintain(config.analyticsRetentionDays)),
  loadEvents(),
];
log.info('worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  stop.abort();
  streamRedis.disconnect(); // ends a blocking read at once
  await Promise.allSettled(jobs);
  await Promise.allSettled([pool.end(), redis.quit(), flushReports()]);
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
