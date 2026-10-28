import type { AppDeps } from '../app';

/** What the background jobs use; the worker builds these without the web server. */
export type JobDeps = Pick<AppDeps, 'pool' | 'redis' | 'clock' | 'events' | 'log'>;
