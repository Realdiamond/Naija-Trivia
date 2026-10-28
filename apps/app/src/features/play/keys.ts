/** Keyboard play on the web (TRD FR-WEB-5): 1–4 or A–D answer, Enter continues, Esc leaves. */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

export { optionForKey } from './optionKeys';

/**
 * Calls `handler` for key presses on the web; returning true marks the key as handled. Typing
 * in a field, shortcuts with Ctrl/Cmd/Alt, and Enter on a focused button are left alone.
 */
export function useKeys(handler: (key: string) => boolean, enabled = true): void {
  const latest = useRef(handler);
  // Before paint, so a key pressed the moment a question shows already sees it.
  useLayoutEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const onButton = target?.tagName === 'BUTTON' || target?.getAttribute('role') === 'button';
      if (event.key === 'Enter' && onButton) return;
      if (latest.current(event.key)) event.preventDefault();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [enabled]);
}
