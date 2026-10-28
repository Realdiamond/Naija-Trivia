import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Libraries that only exist on Android/iOS. Shared app code reaches them through
// `*.native.ts` adapters so the web build never imports them (TRD FR-WEB-2, §5.6).
const NATIVE_ONLY_MODULES = [
  'expo-secure-store',
  'expo-haptics',
  'expo-contacts',
  'expo-notifications',
  'react-native-mmkv',
  'react-native-google-mobile-ads',
  'react-native-purchases',
  'react-native-view-shot',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.expo/**',
      'apps/app/web-build/**',
      'apps/app/expo-env.d.ts',
      'apps/app/android/**',
      'apps/app/ios/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/app/**/*.{ts,tsx}'],
    ignores: ['apps/app/**/*.native.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: NATIVE_ONLY_MODULES.map((name) => ({
            name,
            message: 'Native-only module: import it from a *.native.ts adapter (TRD FR-WEB-2).',
          })),
        },
      ],
    },
  },
);
