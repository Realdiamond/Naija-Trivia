/**
 * app.json plus what depends on the build:
 * - Firebase for push notifications (google-services.json).
 * - The links the app opens itself (doc 09 §5): challenge, duel and Daily links on the web app's
 *   domain open the installed app instead of the browser. Android checks
 *   {LINK_HOST}/.well-known/assetlinks.json, iOS /.well-known/apple-app-site-association; the
 *   API serves both once ANDROID_CERT_SHA256 / APPLE_TEAM_ID are set.
 */
import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Firebase's Android config (Firebase console → Project settings → Your apps → Android app
 * ng.whosabi.app → google-services.json). It only identifies the app to Firebase, so it lives in
 * the repo as apps/app/google-services.json; GOOGLE_SERVICES_JSON points a build at another one.
 */
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (existsSync('./google-services.json') ? './google-services.json' : undefined);

/** The web app's domain; set LINK_HOST for a build that points somewhere else. */
const host = process.env.LINK_HOST ?? 'whosabi.ng';
const paths = ['/d/', '/duel/', '/daily/'];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: paths.map((pathPrefix) => ({ scheme: 'https', host, pathPrefix })),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  ios: {
    ...config.ios,
    associatedDomains: [`applinks:${host}`],
  },
});
