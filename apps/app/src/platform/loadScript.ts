const loading = new Map<string, Promise<void>>();

/** Adds a third-party script to the page once (web only); later calls share the first load. */
export function loadScript(src: string): Promise<void> {
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading.delete(src);
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(script);
    });
    loading.set(src, promise);
  }
  return promise;
}
