import { create } from 'zustand';
import { storage } from '../platform/storage';
import { en, pcm, type MessageKey } from './messages';

export type AppLanguage = 'en' | 'pcm';

const KEY = 'whosabi.lang';
const catalogues: Record<AppLanguage, Record<MessageKey, string>> = { en, pcm };

interface LanguageState {
  language: AppLanguage;
  /** True once the saved choice has been read, so the first screen shows the right words. */
  loaded: boolean;
  setLanguage(language: AppLanguage): void;
  load(): Promise<void>;
}

export const useLanguage = create<LanguageState>((set) => ({
  language: 'en',
  loaded: false,
  setLanguage(language) {
    set({ language });
    void storage.setItem(KEY, language);
  },
  async load() {
    const saved = await storage.getItem(KEY);
    set({ language: saved === 'pcm' ? 'pcm' : 'en', loaded: true });
  },
}));

export function translate(language: AppLanguage, key: MessageKey, values?: Record<string, string | number>) {
  const text = catalogues[language][key] ?? en[key];
  return values ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`)) : text;
}

/** `t('question.counter', { seq: 1, total: 3 })` in the current language. */
export function useT() {
  const language = useLanguage((s) => s.language);
  return (key: MessageKey, values?: Record<string, string | number>) => translate(language, key, values);
}

export type { MessageKey };
