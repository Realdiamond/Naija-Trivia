/** The browser and system, for a message to support (step 2.7p), e.g. "chrome on android". */
export function deviceLabel(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  const os = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'a computer';
  const name = /Edg\//.test(ua)
    ? 'edge'
    : /Firefox\//.test(ua)
      ? 'firefox'
      : /SamsungBrowser\//.test(ua)
        ? 'samsung internet'
        : /OPR\//.test(ua)
          ? 'opera'
          : /Chrome\//.test(ua)
            ? 'chrome'
            : /Safari\//.test(ua)
              ? 'safari'
              : 'a browser';
  return `${name} on ${os}`;
}
