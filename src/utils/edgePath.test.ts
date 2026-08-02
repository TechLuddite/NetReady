import { describe, it, expect } from 'vitest';
import {
  rttToMaxDistanceKm,
  readPhases,
  parseCfTrace,
  popFromColo,
  assessProtocols,
  EDGE_TARGETS,
} from './edgePath';
import { lookupIata, IATA_LOCATIONS } from '../data/iata';
import type { EdgeProbeResult } from '../types';

/** Minimal PerformanceResourceTiming stand-in; only the fields we read matter. */
function entry(over: Partial<PerformanceResourceTiming>): PerformanceResourceTiming {
  return {
    name: 'https://example.test/x',
    entryType: 'resource',
    startTime: 0,
    duration: 100,
    fetchStart: 0,
    domainLookupStart: 0,
    domainLookupEnd: 0,
    connectStart: 0,
    connectEnd: 0,
    secureConnectionStart: 0,
    requestStart: 0,
    responseStart: 0,
    responseEnd: 0,
    nextHopProtocol: '',
    ...over,
  } as PerformanceResourceTiming;
}

describe('rttToMaxDistanceKm', () => {
  it('applies the speed of light in fibre to one-way distance', () => {
    // 20 ms round trip => 10 ms one way => 10 * 200 km.
    expect(rttToMaxDistanceKm(20)).toBe(2000);
    expect(rttToMaxDistanceKm(1)).toBe(100);
    expect(rttToMaxDistanceKm(0)).toBe(0);
  });

  it('grows monotonically with round-trip time', () => {
    expect(rttToMaxDistanceKm(50)).toBeGreaterThan(rttToMaxDistanceKm(10));
  });

  it('bounds a transatlantic hop plausibly', () => {
    // London to New York is ~5,570 km, so a 70 ms round trip must permit it.
    expect(rttToMaxDistanceKm(70)).toBeGreaterThan(5570);
    // ...but a 10 ms round trip cannot.
    expect(rttToMaxDistanceKm(10)).toBeLessThan(5570);
  });
});

describe('readPhases', () => {
  it('detects a missing Timing-Allow-Origin header', () => {
    // Cross-origin without TAO: the spec zeroes every phase timestamp. Those
    // zeros must never be rendered as "0 ms".
    const r = readPhases(entry({ duration: 120, responseStart: 0 }));
    expect(r.availability).toBe('timing-allow-origin-missing');
    expect(r.phases.dnsMs).toBeNull();
    expect(r.phases.tcpMs).toBeNull();
    expect(r.phases.tlsMs).toBeNull();
    expect(r.phases.ttfbMs).toBeNull();
    expect(r.protocol).toBeNull();
    // Wall-clock duration is still real.
    expect(r.phases.totalMs).toBe(120);
  });

  it('detects connection reuse', () => {
    // A reused connection collapses the handshake timestamps onto fetchStart.
    const r = readPhases(
      entry({
        duration: 30,
        fetchStart: 10,
        domainLookupStart: 10,
        domainLookupEnd: 10,
        connectStart: 10,
        connectEnd: 10,
        requestStart: 10,
        responseStart: 32,
        responseEnd: 40,
        nextHopProtocol: 'h2',
      }),
    );
    expect(r.availability).toBe('connection-reused');
    expect(r.phases.dnsMs).toBeNull();
    expect(r.phases.tcpMs).toBeNull();
    // TTFB is still observable on a reused connection.
    expect(r.phases.ttfbMs).toBe(22);
    expect(r.protocol).toBe('h2');
  });

  it('extracts a full handshake breakdown', () => {
    const r = readPhases(
      entry({
        duration: 200,
        fetchStart: 0,
        domainLookupStart: 5,
        domainLookupEnd: 20, // 15 ms DNS
        connectStart: 20,
        secureConnectionStart: 50,
        connectEnd: 90, // 70 ms connect, of which 40 ms is TLS
        requestStart: 90,
        responseStart: 140, // 50 ms TTFB
        responseEnd: 200, // 60 ms transfer
        nextHopProtocol: 'h3',
      }),
    );
    expect(r.availability).toBe('available');
    expect(r.phases.dnsMs).toBe(15);
    expect(r.phases.tlsMs).toBe(40);
    // TCP proper excludes the TLS portion of the connect window.
    expect(r.phases.tcpMs).toBe(30);
    expect(r.phases.ttfbMs).toBe(50);
    expect(r.phases.transferMs).toBe(60);
    expect(r.protocol).toBe('h3');
  });

  it('reports TLS as unavailable on a plaintext connection', () => {
    const r = readPhases(
      entry({
        duration: 50,
        domainLookupStart: 0,
        domainLookupEnd: 5,
        connectStart: 5,
        secureConnectionStart: 0, // no TLS
        connectEnd: 25,
        requestStart: 25,
        responseStart: 40,
        responseEnd: 50,
        nextHopProtocol: 'http/1.1',
      }),
    );
    expect(r.availability).toBe('available');
    expect(r.phases.tlsMs).toBeNull();
    // The whole connect window is TCP when there is no TLS.
    expect(r.phases.tcpMs).toBe(20);
  });

  it('never returns a negative phase', () => {
    const r = readPhases(
      entry({
        duration: 10,
        domainLookupStart: 0,
        domainLookupEnd: 2,
        connectStart: 2,
        secureConnectionStart: 1, // pathological ordering
        connectEnd: 6,
        requestStart: 6,
        responseStart: 8,
        responseEnd: 10,
        nextHopProtocol: 'h2',
      }),
    );
    expect(r.phases.tcpMs).toBeGreaterThanOrEqual(0);
  });
});

describe('parseCfTrace', () => {
  it('parses the key=value body', () => {
    const t = parseCfTrace('fl=123abc\nh=example.com\nip=1.2.3.4\ncolo=SYD\nhttp=http/3\ntls=TLSv1.3');
    expect(t.colo).toBe('SYD');
    expect(t.http).toBe('http/3');
    expect(t.ip).toBe('1.2.3.4');
  });

  it('tolerates blank lines and values containing "="', () => {
    const t = parseCfTrace('colo=LHR\n\nuag=Mozilla/5.0 (x=y)\n');
    expect(t.colo).toBe('LHR');
    expect(t.uag).toBe('Mozilla/5.0 (x=y)');
  });

  it('returns an empty object for junk', () => {
    expect(parseCfTrace('')).toEqual({});
    expect(parseCfTrace('no-equals-here')).toEqual({});
  });
});

describe('popFromColo', () => {
  it('resolves a known code to real coordinates', () => {
    const pop = popFromColo('syd', 'HTTP/3');
    expect(pop!.colo).toBe('SYD');
    expect(pop!.city).toBe('Sydney');
    expect(pop!.unmappedCode).toBe(false);
    expect(pop!.lat).toBeLessThan(0); // southern hemisphere
    expect(pop!.httpProtocol).toBe('HTTP/3');
  });

  it('flags an unknown code instead of inventing a location', () => {
    const pop = popFromColo('ZZZ', null);
    expect(pop!.colo).toBe('ZZZ');
    expect(pop!.lat).toBeNull();
    expect(pop!.lng).toBeNull();
    expect(pop!.unmappedCode).toBe(true);
  });

  it('returns null when there is no code at all', () => {
    expect(popFromColo(null, null)).toBeNull();
    expect(popFromColo('', null)).toBeNull();
  });
});

describe('IATA table', () => {
  it('holds plausible coordinates for every entry', () => {
    for (const [code, loc] of Object.entries(IATA_LOCATIONS)) {
      expect(code, `${code} should be a 3-letter code`).toMatch(/^[A-Z]{3}$/);
      expect(loc.lat, `${code} latitude`).toBeGreaterThanOrEqual(-90);
      expect(loc.lat, `${code} latitude`).toBeLessThanOrEqual(90);
      expect(loc.lng, `${code} longitude`).toBeGreaterThanOrEqual(-180);
      expect(loc.lng, `${code} longitude`).toBeLessThanOrEqual(180);
      expect(loc.city.length, `${code} city`).toBeGreaterThan(0);
      // 0,0 is in the Atlantic and is the classic "missing data" coordinate.
      expect(loc.lat === 0 && loc.lng === 0, `${code} is null island`).toBe(false);
    }
  });

  it('places a few known cities in the right hemisphere', () => {
    expect(lookupIata('LHR')!.lng).toBeLessThan(0); // west of Greenwich
    expect(lookupIata('NRT')!.lng).toBeGreaterThan(100); // east Asia
    expect(lookupIata('JNB')!.lat).toBeLessThan(0); // southern
    expect(lookupIata('IAD')!.lng).toBeLessThan(-70); // US east coast
  });

  it('is case-insensitive and safe on unknown input', () => {
    expect(lookupIata('lhr')).toEqual(lookupIata('LHR'));
    expect(lookupIata('nope')).toBeNull();
    expect(lookupIata(null)).toBeNull();
  });
});

describe('assessProtocols', () => {
  const probe = (protocol: string | null): EdgeProbeResult =>
    ({
      target: EDGE_TARGETS[0],
      availability: 'available',
      phases: { dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: null, transferMs: null, totalMs: null },
      protocol,
      roundTripMs: 10,
      maxDistanceKm: 1000,
    }) as EdgeProbeResult;

  it('reports unavailable rather than negative when nothing is readable', () => {
    // No readable protocol is missing evidence, not evidence of absence.
    const r = assessProtocols([probe(null), probe(null)]);
    expect(r.verdict).toBeNull();
    expect(r.explanation).toMatch(/Timing-Allow-Origin/);
  });

  it('recognises working HTTP/3', () => {
    const r = assessProtocols([probe('h3'), probe('h2')]);
    expect(r.verdict).toBe('http3-working');
    expect(r.h3Count).toBe(1);
  });

  it('infers blocked UDP when every h3-capable origin falls back to h2', () => {
    const r = assessProtocols([probe('h2'), probe('h2'), probe('h2')]);
    expect(r.verdict).toBe('http3-absent-udp-possibly-blocked');
    expect(r.explanation).toMatch(/UDP\/443/);
  });

  it('flags a total fallback to HTTP/1.1', () => {
    const r = assessProtocols([probe('http/1.1'), probe('http/1.1')]);
    expect(r.verdict).toBe('legacy-http1');
  });

  it('deduplicates the negotiated list', () => {
    const r = assessProtocols([probe('h2'), probe('h2'), probe('h3')]);
    expect(r.negotiated.sort()).toEqual(['h2', 'h3']);
  });
});

describe('EDGE_TARGETS', () => {
  it('probes several independent origins over https', () => {
    expect(EDGE_TARGETS.length).toBeGreaterThanOrEqual(3);
    const origins = new Set(EDGE_TARGETS.map((t) => t.origin));
    expect(origins.size).toBe(EDGE_TARGETS.length);
    for (const t of EDGE_TARGETS) {
      expect(t.probeUrl.startsWith('https://')).toBe(true);
      expect(t.probeUrl.startsWith(t.origin)).toBe(true);
    }
  });
});
