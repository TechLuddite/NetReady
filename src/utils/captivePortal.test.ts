import { describe, it, expect } from 'vitest';
import { canProbePlaintext, classifyInterception, classifyDnsIntegrity } from './captivePortal';
import type { DohComparison, IntegrityProbe } from '../types';

const probe = (outcome: IntegrityProbe['outcome'], label = 'endpoint'): IntegrityProbe => ({
  label,
  url: `https://${label}.example.test/`,
  expectation: 'its own content',
  outcome,
  roundTripMs: outcome === 'verified' ? 40 : null,
  note: null,
});

describe('canProbePlaintext', () => {
  it('permits the plaintext probe only from an http origin', () => {
    expect(canProbePlaintext('http:')).toBe(true);
    expect(canProbePlaintext('https:')).toBe(false);
    expect(canProbePlaintext('file:')).toBe(false);
  });
});

describe('classifyInterception', () => {
  it('passes when every endpoint returns its own content', () => {
    const r = classifyInterception([probe('verified', 'a'), probe('verified', 'b')], true);
    expect(r.verdict).toBe('no-interception-detected');
    // The claim must stay bounded to what was tested.
    expect(r.explanation).toMatch(/does not certify the whole network/);
  });

  it('flags substituted content ahead of everything else', () => {
    const r = classifyInterception(
      [probe('verified', 'a'), probe('content-mismatch', 'b'), probe('no-response', 'c')],
      true,
    );
    expect(r.verdict).toBe('content-substituted');
  });

  it('reads total HTTPS silence while online as a portal signature', () => {
    const r = classifyInterception([probe('no-response', 'a'), probe('no-response', 'b')], true);
    expect(r.verdict).toBe('https-blocked');
    expect(r.explanation).toMatch(/captive portal/);
  });

  it('refuses to call it interception when the browser is offline', () => {
    // Nothing answering because there is no connection is not evidence of a
    // portal. Conflating the two would be the diagnostic equivalent of an
    // invented measurement.
    const r = classifyInterception([probe('no-response', 'a'), probe('no-response', 'b')], false);
    expect(r.verdict).toBeNull();
    expect(r.explanation).toMatch(/no connection/);
  });

  it('reports a mixed result as mixed rather than as a fault', () => {
    const r = classifyInterception([probe('verified', 'a'), probe('no-response', 'b')], true);
    expect(r.verdict).toBe('mixed');
  });

  it('ignores probes that could not be attempted', () => {
    // The plaintext probe is unavailable on https:. It must not dilute the
    // verdict in either direction.
    const r = classifyInterception(
      [probe('not-attempted', 'plaintext'), probe('verified', 'a'), probe('verified', 'b')],
      true,
    );
    expect(r.verdict).toBe('no-interception-detected');
    expect(r.explanation).toMatch(/All 2 endpoints/);
  });

  it('returns null when nothing was attempted at all', () => {
    const r = classifyInterception([probe('not-attempted', 'plaintext')], true);
    expect(r.verdict).toBeNull();
  });
});

describe('classifyDnsIntegrity', () => {
  const agree: DohComparison = {
    name: 'one.one.one.one',
    cloudflare: ['1.0.0.1', '1.1.1.1'],
    google: ['1.0.0.1', '1.1.1.1'],
    agrees: true,
  };
  const disagree: DohComparison = {
    name: 'dns.google',
    cloudflare: ['8.8.8.8'],
    google: ['203.0.113.9'],
    agrees: false,
  };
  const unknown: DohComparison = {
    name: 'dns.google',
    cloudflare: null,
    google: ['8.8.8.8'],
    agrees: null,
  };

  it('identifies a failing resolver from the hostname/literal split', () => {
    const r = classifyDnsIntegrity(false, true, [agree]);
    expect(r.verdict).toBe('resolver-failing');
    expect(r.explanation).toMatch(/literal IP/);
  });

  it('ranks a failing resolver above provider disagreement', () => {
    const r = classifyDnsIntegrity(false, true, [disagree]);
    expect(r.verdict).toBe('resolver-failing');
  });

  it('reports divergence between providers', () => {
    const r = classifyDnsIntegrity(true, true, [agree, disagree]);
    expect(r.verdict).toBe('answers-diverge');
    expect(r.explanation).toContain('dns.google');
  });

  it('passes when names resolve and providers agree', () => {
    const r = classifyDnsIntegrity(true, true, [agree]);
    expect(r.verdict).toBe('resolver-working');
  });

  it('does not treat a missing answer as disagreement', () => {
    // One provider not answering is absent data. Calling it divergence would
    // manufacture a finding out of a gap.
    const r = classifyDnsIntegrity(true, true, [unknown]);
    expect(r.verdict).toBe('resolver-working');
  });

  it('blames nothing when neither path worked', () => {
    const r = classifyDnsIntegrity(false, false, []);
    expect(r.verdict).toBeNull();
    expect(r.explanation).toMatch(/says nothing about DNS/);
  });

  it('returns null when the check did not complete', () => {
    const r = classifyDnsIntegrity(null, null, []);
    expect(r.verdict).toBeNull();
  });
});
