/**
 * app.json plus the links the app opens itself (doc 09 §5): challenge, duel and Daily links on
 * the web app's domain open the installed app instead of the browser. Android checks
 * {LINK_HOST}/.well-known/assetlinks.json, iOS /.well-known/apple-app-site-association; the API
 * serves both once ANDROID_CERT_SHA256 / APPLE_TEAM_ID are set.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The web app's domain; set LINK_HOST for a build that points somewhere else. */
const host = process.env.LINK_HOST ?? 'whosabi.ng';
const paths = ['/d/', '/duel/', '/daily/'];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
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
