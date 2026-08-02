import { HistoryItem } from '../types';
import { escapeCsv, triggerDownload, exportDateStamp } from './export';

const STORAGE_KEY_HISTORY = 'netready_history_v1';
const STORAGE_KEY_SETTINGS = 'netready_settings_v1';

export interface AppSettings {
  autoSaveHistory: boolean;
  maxHistoryItems: number;
  dnsProvider: 'cloudflare' | 'google';
  pingPacketCount: number;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoSaveHistory: true,
  maxHistoryItems: 100,
  dnsProvider: 'cloudflare',
  pingPacketCount: 10,
  theme: 'dark',
};

export const getHistory = (): HistoryItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to load history from LocalStorage:', e);
    return [];
  }
};

/** Raised when the browser refuses a write because the origin quota is full.
 *  Callers must surface this: silently returning the previous history made a
 *  dropped record look like a successful save. */
export class StorageFullError extends Error {
  constructor(public readonly droppedItemId: string) {
    super(
      'Browser storage is full. The result was not saved. Export your history or ' +
        'delete older records to free space.',
    );
    this.name = 'StorageFullError';
  }
}

const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export const saveHistoryItem = (item: HistoryItem): HistoryItem[] => {
  const current = getHistory();
  const maxItems = getSettings().maxHistoryItems;
  const updated = [item, ...current].slice(0, maxItems);

  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.error('Failed to save history item:', e);
      return current;
    }

    // Quota exhausted. Evict oldest records and retry once before giving up —
    // a single large port scan can consume most of the origin budget.
    for (const keep of [Math.floor(maxItems / 2), 10, 1]) {
      try {
        const trimmed = updated.slice(0, keep);
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(trimmed));
        console.warn(
          `[NetReady] Storage quota reached; kept the ${keep} most recent records.`,
        );
        return trimmed;
      } catch {
        /* still too large — try a smaller slice */
      }
    }

    throw new StorageFullError(item.id);
  }
};

export const deleteHistoryItem = (id: string): HistoryItem[] => {
  try {
    const current = getHistory();
    const updated = current.filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to delete history item:', e);
    return getHistory();
  }
};

export const clearAllHistory = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY_HISTORY);
  } catch (e) {
    console.error('Failed to clear history:', e);
  }
};

export const getSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: Partial<AppSettings>): AppSettings => {
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    return updated;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/**
 * Approximate UTF-16 bytes used by NetReady's own keys.
 *
 * This used to iterate the whole origin, so on a shared origin the navbar's
 * "N KB saved" figure included other applications' data.
 */
export const getLocalStorageSizeBytes = (): number => {
  try {
    let total = 0;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('netready_')) continue;
      total += ((localStorage.getItem(key)?.length ?? 0) + key.length) * 2;
    }
    return total;
  } catch {
    return 0;
  }
};

export const exportHistoryAsJson = (): void => {
  // A Blob, not a `data:` URI. The old implementation URL-encoded the entire
  // history into an anchor href, which silently fails past the browser's URL
  // length limit — exactly when a history is worth exporting.
  triggerDownload(
    JSON.stringify(getHistory(), null, 2),
    `netready_report_${exportDateStamp()}.json`,
    'application/json;charset=utf-8;',
  );
};

export const exportHistoryAsCsv = (): void => {
  const history = getHistory();
  if (history.length === 0) return;

  // Uses the shared escaper, which also neutralises spreadsheet formula
  // injection. This function previously had its own quote-only escaping.
  const headers = ['ID', 'Timestamp', 'Date', 'Type', 'Title', 'Summary'];
  const rows = history.map((item) => [
    escapeCsv(item.id),
    escapeCsv(item.timestamp),
    escapeCsv(new Date(item.timestamp).toLocaleString()),
    escapeCsv(item.type),
    escapeCsv(item.title),
    escapeCsv(item.summary),
  ]);

  triggerDownload(
    [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'),
    `netready_history_${exportDateStamp()}.csv`,
    'text/csv;charset=utf-8;',
  );
};
