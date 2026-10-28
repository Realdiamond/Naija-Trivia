import Constants from 'expo-constants';
import { Platform as RNPlatform } from 'react-native';
import type { Platform } from '@whosabi/shared-types';

/**
 * Where the API and the event intake live. Set EXPO_PUBLIC_API_URL to an empty string when the
 * web app is served by the API itself (same origin); on a phone, use the computer's LAN address.
 */
const url = (value: string | undefined, fallback: string) => (value ?? fallback).replace(/\/+$/, '');

export const API_URL = url(process.env.EXPO_PUBLIC_API_URL, 'http://localhost:3000');
export const EVENTS_URL = url(process.env.EXPO_PUBLIC_EVENTS_URL, 'http://localhost:3001');
/** Google Identity Services client id for sign-in on the web; empty hides the button. */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
/** Cloudflare Turnstile site key for phone codes on the web; empty in development. */
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
export const PLATFORM: Platform =
  RNPlatform.OS === 'ios' ? 'ios' : RNPlatform.OS === 'web' ? 'web' : 'android';
