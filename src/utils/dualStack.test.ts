import { describe, it, expect } from 'vitest';
import {
  familyOfIp,
  classifyDualStack,
  describeReachability,
  FAMILY_ENDPOINTS,
} from './dualStack';
import type { AddressFamily, FamilyProbe } from '../types';

const probe = (
  family: AddressFamily,
  outcome: FamilyProbe['outcome'],
  host = `${family}.example.test`,
): FamilyProbe => ({
  family,
  host,
  url: `https://${host}/`,
  outcome,
  roundTripMs: outcome === 'answered' ? 30 : null,
  observedIp: null,
  error: null,
});

describe('familyOfIp', () => {
  it('recognises IPv4 literals', () => {
    expect(familyOfIp('1.1.1.1')).toBe('ipv4');
    expect(familyOfIp('203.0.113.255')).toBe('ipv4');
    expect(familyOfIp('  8.8.4.4\n')).toBe('ipv4');
  });

  it('recognises IPv6 literals', () => {
    expect(familyOfIp('2606:4700:4700::1111')).toBe('ipv6');
    expect(familyOfIp('::1')).toBe('ipv6');
  });

  it('treats an IPv4-mapped IPv6 address as IPv6', () => {
    // The connection that produced this was IPv6; the embedded v4 address does
    // not change which family carried it.
    expect(familyOfIp('::ffff:192.0.2.1')).toBe('ipv6');
  });

  it('returns null rather than guessing on anything malformed', () => {
    // A truncated or error-page body must not be counted as evidence that a
    // family works.
    expect(familyOfIp('')).toBeNull();
    expect(familyOfIp(null)).toBeNull();
    expect(familyOfIp(undefined)).toBeNull();
    expect(familyOfIp('not an address')).toBeNull();
    expect(familyOfIp('1.2.3')).toBeNull();
    expect(familyOfIp('1.2.3.4.5')).toBeNull();
    expect(familyOfIp('999.1.1.1')).toBeNull();
    expect(familyOfIp('<html>error</html>')).toBeNull();
  });
});

describe('classifyDualStack', () => {
  it('reports dual-stack when both families answer', () => {
    const r = classifyDualStack(
      [probe('ipv4', 'answered'), probe('ipv6', 'answered')],
      'ipv6',
    );
    expect(r.verdict).toBe('dual-stack');
    expect(r.ipv4Reachable).toBe(true);
    expect(r.ipv6Reachable).toBe(true);
    expect(r.explanation).toMatch(/IPv6/);
  });

  it('needs only one endpoint per family to answer', () => {
    // One provider being down must not become a verdict about the user.
    const r = classifyDualStack(
      [
        probe('ipv4', 'no-response', 'a.example.test'),
        probe('ipv4', 'answered', 'b.example.test'),
        probe('ipv6', 'answered'),
      ],
      null,
    );
    expect(r.verdict).toBe('dual-stack');
  });

  it('reports IPv4-only when no IPv6 host answers', () => {
    const r = classifyDualStack(
      [probe('ipv4', 'answered'), probe('ipv6', 'no-response')],
      'ipv4',
    );
    expect(r.verdict).toBe('ipv4-only');
    expect(r.ipv6Reachable).toBe(false);
  });

  it('reports IPv6-only when no IPv4 host answers', () => {
    const r = classifyDualStack(
      [probe('ipv4', 'no-response'), probe('ipv6', 'answered')],
      'ipv6',
    );
    expect(r.verdict).toBe('ipv6-only');
  });

  it('does not blame IPv6 when nothing answered at all', () => {
    const r = classifyDualStack(
      [probe('ipv4', 'no-response'), probe('ipv6', 'no-response')],
      null,
    );
    expect(r.verdict).toBe('neither-family-answered');
    expect(r.explanation).toMatch(/connection as a whole/);
  });

  it('returns null reachability for a family that was never probed', () => {
    // A check that did not run has not failed. This is the distinction the
    // whole tri-state exists for.
    const r = classifyDualStack([probe('ipv4', 'answered')], null);
    expect(r.ipv6Reachable).toBeNull();
    expect(r.verdict).toBeNull();
  });

  it('returns null for an entirely empty probe set', () => {
    const r = classifyDualStack([], null);
    expect(r.ipv4Reachable).toBeNull();
    expect(r.ipv6Reachable).toBeNull();
    expect(r.verdict).toBeNull();
  });

  it('omits the preference sentence when the family is unknown', () => {
    const r = classifyDualStack([probe('ipv4', 'answered'), probe('ipv6', 'answered')], null);
    expect(r.explanation).not.toMatch(/prefers/);
  });
});

describe('describeReachability', () => {
  it('distinguishes not-checked from no-response', () => {
    expect(describeReachability(null)).toBe('not checked');
    expect(describeReachability(false)).toBe('no response');
    expect(describeReachability(true)).toBe('answered');
  });
});

describe('FAMILY_ENDPOINTS', () => {
  it('probes at least two independent providers per family', () => {
    for (const family of ['ipv4', 'ipv6'] as const) {
      const hosts = new Set(
        FAMILY_ENDPOINTS.filter((e) => e.family === family).map((e) => e.host),
      );
      expect(hosts.size, `${family} providers`).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses https and a host name matching its declared family', () => {
    for (const e of FAMILY_ENDPOINTS) {
      expect(e.url.startsWith('https://')).toBe(true);
      expect(e.url).toContain(e.host);
      // The pinning is the whole mechanism: a v6 probe aimed at a dual-stack
      // host would answer over IPv4 and prove nothing.
      expect(e.host).toMatch(e.family === 'ipv4' ? /(^|\.)(ipv4|api4)/ : /(^|\.)(ipv6|api6)/);
    }
  });
});
