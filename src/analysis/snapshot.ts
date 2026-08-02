import type { TriageSnapshot } from './types';

/**
 * Builds a snapshot in which nothing has been measured.
 *
 * Every evidence field starts as null, and null means "not measured" all the
 * way through the engine. Constructing snapshots through this function rather
 * than by hand means a field added to {@link TriageSnapshot} later cannot
 * silently arrive as `undefined` at a rule that expects a tri-state.
 */
export function createSnapshot(overrides: Partial<TriageSnapshot> = {}): TriageSnapshot {
  return {
    startedAt: 0,
    browserOnline: true,
    pageProtocol: 'https:',
    dns: null,
    portal: null,
    dualStack: null,
    edge: null,
    speed: null,
    ping: null,
    ...overrides,
  };
}
