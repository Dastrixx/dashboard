// A cold local period is being loaded by the server's single background queue.
// Polling checks SQLite only; it does not start another 1C request.
export async function fetchLocalAnalytics(url: string, options: RequestInit = {}): Promise<Response> {
  while (true) {
    const response = await fetch(url, options);
    if (response.status !== 503) return response;
    const body = await response.clone().json().catch(() => null);
    if (body?.code !== "ANALYTICS_SYNC_PENDING" || body?.meta?.localSync?.error) return response;
    await new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 10_000);
      function abort() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
