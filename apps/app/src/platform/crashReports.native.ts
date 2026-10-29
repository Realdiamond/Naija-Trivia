/**
 * Crash reports from the phone app to Sentry (TRD §2 "Crash / perf", build plan step 2.8e),
 * once the build has EXPO_PUBLIC_SENTRY_DSN: JavaScript errors and native crashes, plus the
 * sessions Sentry counts crash-free sessions from (doc 18's `crash_free_sessions`). No
 * personal data: no user, no IP address, no screenshots, and no breadcrumbs (they would carry
 * screen paths with usernames and ids).
 */
import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';
import { APP_VERSION } from '../config';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export function startCrashReports(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    release: `whosabi@${APP_VERSION}`,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    reportAccessibilityIdentifier: false,
    enableCaptureFailedRequests: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}

/** The root screen, inside Sentry's error boundary when reports are on. */
export function withCrashReports<P extends Record<string, unknown>>(
  root: ComponentType<P>,
): ComponentType<P> {
  return DSN ? Sentry.wrap(root) : root;
}
