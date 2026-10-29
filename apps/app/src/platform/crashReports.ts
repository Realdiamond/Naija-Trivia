/**
 * Crash reports are on the phone app for now (crashReports.native.ts): Sentry's browser code
 * would add about 70 KB to the web app's first load, a fifth of its budget (TRD §6).
 */
import type { ComponentType } from 'react';

export function startCrashReports(): void {}

export function withCrashReports<P extends Record<string, unknown>>(
  root: ComponentType<P>,
): ComponentType<P> {
  return root;
}
