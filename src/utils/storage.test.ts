import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteHistoryItem, getHistory, saveHistoryItem } from './storage';
import type { HistoryItem } from '../types';

const measured: HistoryItem = { id: 'measured', type: 'dns', timestamp: 2, title: 'DNS lookup', summary: 'Measured result', data: {} };
const legacy = { id: 'legacy', type: 'tracert', timestamp: 1, title: 'Simulated route', summary: 'Generated hops', data: { hops: [] } };

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('legacy simulated history', () => {
  it('excludes simulations from diagnostic history and export sources', () => {
    localStorage.setItem('netready_history_v1', JSON.stringify([legacy, measured]));
    expect(getHistory()).toEqual([measured]);
  });
  it('preserves old stored records when new measurements are saved or deleted', () => {
    localStorage.setItem('netready_history_v1', JSON.stringify([legacy]));
    saveHistoryItem(measured);
    expect(getHistory()).toEqual([measured]);
    expect(JSON.parse(localStorage.getItem('netready_history_v1')!)).toContainEqual(legacy);
    deleteHistoryItem(measured.id);
    expect(getHistory()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('netready_history_v1')!)).toEqual([legacy]);
  });
});
