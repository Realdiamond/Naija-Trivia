/**
 * The service worker (public/sw.js) for every visitor, not only those with pushes on, so the
 * app's files stay on the phone (build plan step 2.8c). Not in development, where bundles have
 * no hashes in their names and change all the time. Once it runs, it is handed the files this
 * page loaded before it took over.
 */
export async function startServiceWorker(): Promise<void> {
  if (__DEV__ || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    const ready = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
    ready.active?.postMessage({ whosabi: 'cache', urls });
  } catch {
    // No worker (blocked, or a private window): the app works as before, from the network.
  }
}
