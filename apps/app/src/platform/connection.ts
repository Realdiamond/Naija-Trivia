/**
 * What the browser says about the connection (the Network Information API, in Chrome and
 * Android browsers): Save-Data, or a 2G or 3G connection, means data is tight (TRD FR-WEB-6).
 * Browsers that don't say count as fine. The app uses connection.native.ts instead.
 */
export interface ConnectionInfo {
  /** Data is tight: Save-Data, 2G or 3G. */
  slow: boolean;
  /** On Wi-Fi (or a cable), where data doesn't cost the player. */
  wifi: boolean;
}

interface NetworkInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

const SLOW = new Set(['slow-2g', '2g', '3g']);

function connection(): NetworkInformation | undefined {
  return (globalThis.navigator as { connection?: NetworkInformation } | undefined)?.connection;
}

function read(): ConnectionInfo {
  const c = connection();
  return {
    slow: c?.saveData === true || SLOW.has(c?.effectiveType ?? ''),
    wifi: c?.type === 'wifi' || c?.type === 'ethernet',
  };
}

/** Calls `onChange` now and whenever the connection changes; returns a function that stops it. */
export function watchConnection(onChange: (info: ConnectionInfo) => void): () => void {
  onChange(read());
  const c = connection();
  if (typeof c?.addEventListener !== 'function') return () => undefined;
  const listener = () => onChange(read());
  c.addEventListener('change', listener);
  return () => c.removeEventListener('change', listener);
}
