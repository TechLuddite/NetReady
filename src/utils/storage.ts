import { HistoryItem } from '../types';

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

export const saveHistoryItem = (item: HistoryItem): HistoryItem[] => {
  try {
    const current = getHistory();
    // Prepend new item
    const updated = [item, ...current].slice(0, 200); // cap at 200
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to save history item:', e);
    return getHistory();
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
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: Partial<AppSettings>): AppSettings => {
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    return updated;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
};

export const getLocalStorageSizeBytes = (): number => {
  try {
    let total = 0;
    for (let x in localStorage) {
      if (localStorage.hasOwnProperty(x)) {
        total += (localStorage[x].length + x.length) * 2;
      }
    }
    return total;
  } catch (e) {
    return 0;
  }
};

export const exportHistoryAsJson = (): void => {
  const history = getHistory();
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `netready_report_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};

export const exportHistoryAsCsv = (): void => {
  const history = getHistory();
  if (history.length === 0) return;

  const headers = ['ID', 'Timestamp', 'Date', 'Type', 'Title', 'Summary'];
  const rows = history.map((item) => [
    item.id,
    item.timestamp,
    new Date(item.timestamp).toLocaleString(),
    item.type,
    `"${(item.title || '').replace(/"/g, '""')}"`,
    `"${(item.summary || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `netready_history_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
};
