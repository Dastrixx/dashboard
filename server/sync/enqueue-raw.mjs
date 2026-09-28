import { enqueueDays } from './repository.mjs';
import { CATALOG_SOURCES, DATED_SOURCES, SNAPSHOT_SOURCES, datedType } from './sources.mjs';

export async function enqueueRawRange(from, to, { refresh = false, retryNow = false } = {}) {
  for (const { entity } of DATED_SOURCES) {
    await enqueueDays(from, to, { dataType: datedType(entity), refresh, retryNow });
  }
  for (const source of SNAPSHOT_SOURCES) {
    await enqueueDays(from, to, { dataType: datedType(source), refresh, retryNow });
  }
  for (const source of CATALOG_SOURCES) {
    await enqueueDays(to, to, { dataType: datedType(source), refresh, retryNow });
  }
}
