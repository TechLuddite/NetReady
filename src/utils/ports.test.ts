import { describe, expect, it } from 'vitest';
import { MAX_SCAN_PORTS, parsePortSelection } from './ports';

describe('parsePortSelection', () => {
  it('parses full ranges, deduplicates overlaps, and sorts the requested ports', () => {
    expect(parsePortSelection('443, 80, 3000 - 3002, 3001')).toEqual([80, 443, 3000, 3001, 3002]);
    expect(parsePortSelection('1-150')).toHaveLength(150);
  });

  it('accepts valid boundary ports and the full aggregate limit', () => {
    expect(parsePortSelection('1,65535')).toEqual([1, 65535]);
    expect(parsePortSelection(`1-${MAX_SCAN_PORTS},1-${MAX_SCAN_PORTS}`)).toHaveLength(MAX_SCAN_PORTS);
  });

  it.each(['', ' ', 'abc', '80garbage', '80.5', '0', '65536', '443-80', '80-90-100', '-80', '80,', ',80', '80,,443', '80,garbage', '1-9007199254740992'])('rejects malformed selection %j rather than scanning defaults or a subset', input => {
    expect(() => parsePortSelection(input)).toThrow();
  });

  it('rejects oversized ranges and aggregate selections before probing', () => {
    expect(() => parsePortSelection('1-65535')).toThrow('at most 1000');
    expect(() => parsePortSelection('1-600,1000-1600')).toThrow('at most 1000');
  });
});
