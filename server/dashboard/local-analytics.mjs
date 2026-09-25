import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describeDataFreshness, filterByPeriod, parseOnecDateTime } from "./utils.mjs";

// Only complete, successfully calculated reports are published. A failed
// refresh never overwrites the last usable snapshot.
export class LocalAnalytics {
  constructor({ databasePath, namespace, loaders, refreshMs = 300_000, now = Date.now }) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS analytics_snapshots (
      namespace TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL,
      query TEXT NOT NULL, payload TEXT, synced_at INTEGER,
      accessed_at INTEGER NOT NULL, attempted_at INTEGER, error TEXT,
      PRIMARY KEY (namespace, key)
    )`);
    this.namespace = namespace;
    this.loaders = loaders;
    this.refreshMs = refreshMs;
    this.now = now;
    this.queue = new Map();
    this.running = false;
    this.active = null;
  }

  key(kind, query) {
    return JSON.stringify([kind, Object.entries(query).sort(([a], [b]) => a.localeCompare(b))]);
  }

  read(kind, query) {
    const key = this.key(kind, query);
    // A smaller sales period can be calculated from downloaded documents.
    // Margin keeps exact period snapshots because fallback costs are valued
    // at the period end and cannot safely be added across arbitrary periods.
    const exactReady = this.db.prepare("SELECT 1 FROM analytics_snapshots WHERE namespace=? AND key=? AND payload IS NOT NULL")
      .get(this.namespace, key);
    if (!exactReady && kind === "reports" && query.from && query.references === "false") {
      const candidates = this.db.prepare(`SELECT key,query FROM analytics_snapshots
        WHERE namespace=? AND kind='reports' AND payload IS NOT NULL ORDER BY synced_at DESC`)
        .all(this.namespace);
      for (const candidate of candidates) {
        const sourceQuery = JSON.parse(candidate.query);
        if (candidate.key === key || !sourceQuery.from || sourceQuery.references === "only" ||
          sourceQuery.from > query.from || sourceQuery.to < query.to) continue;
        const sourcePayload = JSON.parse(this.db.prepare("SELECT payload FROM analytics_snapshots WHERE namespace=? AND key=?")
          .get(this.namespace, candidate.key).payload);
        if (sourcePayload.meta?.truncated) continue;
        const result = this.read(kind, sourceQuery);
        const items = filterByPeriod(result.payload.items || [], "Date",
          new Date(parseOnecDateTime(`${query.from}T00:00:00`)),
          new Date(parseOnecDateTime(`${query.to}T00:00:00`) + 86_400_000 - 1));
        const latestDate = items[0]?.Date || null;
        return { sync: result.sync, payload: {
          ...result.payload, items,
          references: { products: [], warehouses: [], categories: [] },
          meta: { ...result.payload.meta, from: query.from, to: query.to,
            loaded: items.length, uniqueDocuments: items.length, duplicatesRemoved: 0,
            latestDate, freshness: describeDataFreshness(latestDate), referencesLoaded: false,
            cache: "local-range", truncated: false },
        } };
      }
    }
    const now = this.now();
    this.db.prepare(`INSERT INTO analytics_snapshots(namespace,key,kind,query,accessed_at)
      VALUES(?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET accessed_at=excluded.accessed_at`)
      .run(this.namespace, key, kind, JSON.stringify(query), now);
    const row = this.db.prepare("SELECT * FROM analytics_snapshots WHERE namespace=? AND key=?")
      .get(this.namespace, key);
    const stale = !row.synced_at || now - row.synced_at >= this.refreshMs;
    // Back off after failures even when several browsers poll the same period.
    if (stale && (!row.error || now - row.attempted_at >= 60_000)) {
      this.enqueue(key, kind, query);
    }
    const sync = {
      source: "local", syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
      stale, refreshing: this.active === key || this.queue.has(key), error: row.error || null,
    };
    return { payload: row.payload ? JSON.parse(row.payload) : null, sync };
  }

  enqueue(key, kind, query) {
    if (this.active === key || this.queue.has(key)) return;
    this.queue.set(key, { kind, query });
    // Give the HTTP handler time to return the local result before doing I/O.
    if (!this.running) queueMicrotask(() => { void this.drain(); });
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.size) {
        const [key, { kind, query }] = this.queue.entries().next().value;
        this.queue.delete(key);
        this.active = key;
        try {
          const payload = await this.loaders[kind](query);
          if (query.from && payload.meta?.truncated) throw new Error("Источник вернул неполный отчёт");
          const now = this.now();
          this.db.prepare(`UPDATE analytics_snapshots SET payload=?,synced_at=?,attempted_at=?,error=NULL
            WHERE namespace=? AND key=?`).run(JSON.stringify(payload), now, now, this.namespace, key);
        } catch (error) {
          this.db.prepare(`UPDATE analytics_snapshots SET attempted_at=?,error=? WHERE namespace=? AND key=?`)
            .run(this.now(), error instanceof Error ? error.message : String(error), this.namespace, key);
        }
      }
    } finally {
      this.active = null;
      this.running = false;
    }
  }

  refreshRecent() {
    const now = this.now();
    const rows = this.db.prepare(`SELECT kind,query,synced_at,attempted_at,error FROM analytics_snapshots
      WHERE namespace=? AND accessed_at>=? ORDER BY accessed_at DESC LIMIT 64`)
      .all(this.namespace, now - 86_400_000);
    // Do not extend accessed_at here: unused periods stop refreshing after a day.
    for (const row of rows) {
      if (row.synced_at && now - row.synced_at < this.refreshMs) continue;
      if (row.error && row.attempted_at && now - row.attempted_at < 60_000) continue;
      const query = JSON.parse(row.query);
      const key = this.key(row.kind, query);
      this.enqueue(key, row.kind, query);
    }
    this.db.prepare("DELETE FROM analytics_snapshots WHERE namespace=? AND accessed_at<?")
      .run(this.namespace, now - 30 * 86_400_000);
  }

  status() {
    const rows = this.db.prepare(`SELECT kind,query,synced_at,error FROM analytics_snapshots
      WHERE namespace=? AND accessed_at>=? ORDER BY accessed_at DESC LIMIT 64`)
      .all(this.namespace, this.now() - 86_400_000);
    return {
      enabled: true, running: this.running, queued: this.queue.size,
      refreshSeconds: this.refreshMs / 1000,
      periods: rows.map((row) => ({
        kind: row.kind, query: JSON.parse(row.query),
        syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
        error: row.error,
      })),
    };
  }
}

export function normalizeAnalyticsQuery(kind, raw) {
  const query = {};
  if (raw.from || raw.to) {
    const from = String(raw.from || "");
    const to = String(raw.to || "");
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(from) || !validDate(to) || from > to ||
      Date.parse(to) - Date.parse(from) > 365 * 86_400_000) {
      throw new Error("Укажите корректный период не длиннее 366 дней");
    }
    Object.assign(query, { from, to });
  } else {
    query.days = kind === "reports"
      ? String(Math.min(Math.max(Number(raw.days) || 60, 1), 365))
      : String([1, 7, 30, 90].includes(Number(raw.days)) ? Number(raw.days) : 30);
  }
  if (kind === "reports") {
    query.references = raw.references === "false" ? "false" : raw.references === "only" ? "only" : "true";
    if (!query.from) query.top = String(Math.min(Math.max(Number(raw.top) || 1, 1), 10000));
  } else {
    const storeKey = String(raw.storeKey || "all");
    if (storeKey !== "all" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeKey)) {
      throw new Error("Некорректный магазин");
    }
    query.storeKey = storeKey;
    query.channel = ["online", "offline"].includes(raw.channel) ? raw.channel : "all";
    query.includePrevious = raw.includePrevious === "false" ? "false" : "true";
  }
  return query;
}
