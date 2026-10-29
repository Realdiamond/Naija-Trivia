/** Which browser the web app is in, where that changes what it can offer. */

/** Safari on iPhone or iPad (iPadOS asks for desktop sites and says it is a Mac). */
export function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the Home Screen as an installed app, not in a browser tab. */
export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}
