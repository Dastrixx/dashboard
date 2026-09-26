type SyncResponse = {
  status?: 'syncing' | 'failed' | 'ready';
  completedDays?: number;
  totalDays?: number;
  message?: string;
};

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchSyncedJson<T>(url: string, signal?: AbortSignal,
  onProgress?: (message: string) => void): Promise<T> {
  while (true) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
    const payload = (await response.json()) as T & SyncResponse;
    if (response.status === 202 && payload.status === 'syncing') {
      onProgress?.(`${payload.message || 'Загружаем данные из 1С...'} ${payload.completedDays ?? 0} / ${payload.totalDays ?? 0} дней`);
      await wait(3000, signal);
      continue;
    }
    if (!response.ok) throw new Error(payload.message || `Ошибка HTTP ${response.status}`);
    onProgress?.('');
    return payload;
  }
}
