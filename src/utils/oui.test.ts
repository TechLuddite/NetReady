import { describe, it, expect } from 'vitest';
import { parseAndLookupMac } from './oui';

describe('parseAndLookupMac', () => {
  it('rejects input shorter than an OUI', () => {
    const r = parseAndLookupMac('AA:BB');
    expect(r.isKnown).toBe(false);
    expect(r.vendor).toMatch(/Invalid/);
  });

  it('does not invent the device half of a partial address', () => {
    // A 6-digit input identifies a vendor prefix. Padding it to
    // `AA:BB:CC:00:00:00` presented an address the user never supplied.
    const r = parseAndLookupMac('001A2B');
    expect(r.isPartial).toBe(true);
    expect(r.mac).toBe('00:1A:2B');
    expect(r.cleanMac).toBe('001A2B');
    expect(r.mac).not.toMatch(/00:00:00$/);
  });

  it('marks a full address as complete', () => {
    const r = parseAndLookupMac('00:1A:2B:3C:4D:5E');
    expect(r.isPartial).toBe(false);
    expect(r.mac).toBe('00:1A:2B:3C:4D:5E');
  });

  it('accepts hyphen and dot separators', () => {
    expect(parseAndLookupMac('00-1A-2B-3C-4D-5E').cleanMac).toBe('001A2B3C4D5E');
    expect(parseAndLookupMac('001a.2b3c.4d5e').cleanMac).toBe('001A2B3C4D5E');
  });

  it('decodes the multicast bit', () => {
    expect(parseAndLookupMac('01:00:5E:00:00:01').addressType).toBe('Multicast');
    expect(parseAndLookupMac('00:1A:2B:3C:4D:5E').addressType).toBe('Unicast');
  });

  it('decodes the locally-administered bit', () => {
    expect(parseAndLookupMac('02:00:00:00:00:01').administration).toMatch(/Locally/);
    expect(parseAndLookupMac('00:1A:2B:3C:4D:5E').administration).toMatch(/Globally/);
  });

  it('does not claim a randomised MAC has a known vendor', () => {
    // `isKnown` was initialised true and only cleared on one branch, so a
    // locally-administered address reported a known vendor alongside a
    // placeholder string.
    const r = parseAndLookupMac('02:11:22:33:44:55');
    expect(r.isKnown).toBe(false);
    expect(r.vendor).toMatch(/no registered vendor/i);
  });

  it('reports an unregistered global OUI as unknown', () => {
    const r = parseAndLookupMac('FC:FC:FC:11:22:33');
    expect(r.isKnown).toBe(false);
  });
});
