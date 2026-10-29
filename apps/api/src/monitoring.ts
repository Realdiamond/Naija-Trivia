/**
 * Reports of unexpected errors to Sentry (TRD §2 "Crash / perf", build plan step 2.8e), once
 * SENTRY_DSN is set: an API request that ends in a 500 and a worker job that fails, never the
 * errors players are meant to see (a wrong code, a full room). Nothing personal leaves: no
 * request bodies, headers, cookies or IP addresses, and the player is their pseudonymous
 * analytics id (doc 18 §15), the same one the event pipeline uses.
 */
import * as Sentry from '@sentry/node';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { Config } from './config';

export interface ErrorContext {
  /** The request's id, also in its problem+json reply and the logs. */
  requestId?: string;
  /** The route's pattern, e.g. `/v1/duels/:id`, not the path with its ids. */
  route?: string;
  method?: string;
  userId?: string;
  job?: string;
}

let analyticsKey: string | null = null;

/** Starts reporting for the API or the worker; does nothing without a DSN. */
export function startMonitoring(
  config: Pick<Config, 'sentryDsn' | 'release' | 'env' | 'analyticsKey'>,
  service: 'api' | 'worker',
  transport?: Sentry.NodeOptions['transport'],
): boolean {
  if (!config.sentryDsn) return false;
  Sentry.initWithoutDefaultIntegrations({
    dsn: config.sentryDsn,
    environment: config.env,
    release: config.release,
    // Collect nothing about the request or who made it; the user id below is set by hand.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    enableRuntimeChannelInjection: false,
    integrations: [
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.nodeContextIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration({ mode: 'warn' }),
    ],
    initialScope: { tags: { service } },
    // Whatever an integration may have added about the request or the machine's user stays here.
    beforeSend: (event) => {
      delete event.request;
      delete event.server_name;
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      return event;
    },
    ...(transport ? { transport } : {}),
  });
  analyticsKey = config.analyticsKey;
  return true;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!analyticsKey) return;
  const key = analyticsKey;
  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag('request_id', context.requestId);
    if (context.route) scope.setTag('route', context.route);
    if (context.method) scope.setTag('method', context.method);
    if (context.job) scope.setTag('job', context.job);
    if (context.userId) scope.setUser({ id: pseudonymousId(context.userId, key) });
    Sentry.captureException(error);
  });
}

/** Before the process exits, so the last reports go out. */
export async function flushReports(): Promise<void> {
  if (analyticsKey) await Sentry.flush(2_000);
}
