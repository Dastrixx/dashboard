import { setTimeout } from 'node:timers/promises';

export async function waitForCoverage({ readStatus, waitMs = 900_000, intervalMs = 3_000, log = console.log, sleep = setTimeout }) {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('Некорректное время ожидания');
  const deadline = Date.now() + waitMs;
  let lastProgress = '';
  while (true) {
    const coverage = await readStatus();
    if (coverage.status === 'ready') return coverage;
    if (coverage.status === 'failed') {
      const details = coverage.failedRanges.map(({ from, error }) => `${from}: ${error || 'неизвестная ошибка'}`).join('; ');
      throw new Error(`Синхронизация завершилась ошибкой: ${details}`);
    }
    const progress = `${coverage.completedDays}/${coverage.totalDays}`;
    if (progress !== lastProgress) {
      log(`[VERIFY] Ждём worker: ${progress} дней`);
      lastProgress = progress;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Истекло время ожидания (${progress} дней). Проверьте отдельный терминал npm run sync:worker и таблицу sync_jobs.`);
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}
