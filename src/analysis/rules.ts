import type { Evidence, Rule, TriageSnapshot } from './types';

/**
 * The rule table.
 *
 * Each rule is a small, total function from the snapshot to either a finding or
 * null. There is no ordering dependency between rules and no shared state, so a
 * rule can be read, reasoned about and tested entirely on its own.
 *
 * Two conventions hold throughout and are enforced by tests:
 *
 *  - **A rule reads only what it declares in `consumes`.**
 *  - **A rule returns null when its inputs are absent.** Never a default, never
 *    a "typical" value, never a partial conclusion dressed up as a full one.
 *    An unmeasured input means the rule has nothing to say, and the missing
 *    measurement is surfaced separately as a `MeasurementFailure`.
 */

/**
 * Thresholds.
 *
 * Every number here is a judgement about human experience, not a measurement,
 * so each one is named and justified. They are the only constants in the answer
 * layer, and changing one changes what the tool tells people — which is why
 * they live together rather than inline.
 */
export const THRESHOLDS = {
  /** Latency added under load, in ms, at which queuing is doing real damage.
   *  Matches the boundary between bufferbloat grades B and C in `runSpeedTest`,
   *  so the two never disagree. Above this, calls break up while the raw
   *  bandwidth figure still looks fine. */
  bufferbloatDeltaMs: 50,
  /** Round-trip latency, in ms, past which interactive use is noticeably
   *  degraded regardless of bandwidth. */
  highLatencyMs: 150,
  /** Mean consecutive delta, in ms, at which voice and video start to stutter.
   *  Jitter this high on an otherwise quick link usually means Wi-Fi. */
  highJitterMs: 20,
  /** Packet loss percentage that is no longer attributable to sampling. */
  packetLossPercent: 5,
  /** Minimum packets before a loss percentage means anything at all. */
  minPacketsForLoss: 4,
  /** Download Mbps below which modern everyday use is constrained. */
  lowDownloadMbps: 10,
} as const;

const ev = (metric: string, observation: string): Evidence => ({ metric, observation });

/** Measured latency, preferring the dedicated ping run over the speed test's
 *  own idle samples. Null when neither was measured. */
function measuredLatency(s: TriageSnapshot): number | null {
  return s.ping?.avgPing ?? s.speed?.ping ?? null;
}

function measuredJitter(s: TriageSnapshot): number | null {
  return s.ping?.jitter ?? s.speed?.jitter ?? null;
}

export const RULES: Rule[] = [
  {
    id: 'browser-offline',
    title: 'This machine has no network connection',
    layer: 'this-device',
    consumes: ['browserOnline'],
    evaluate: (s) => {
      if (s.browserOnline) return null;
      return {
        confidence: 'confirmed',
        severity: 'blocking',
        verdict:
          'The browser reports no network interface at all. Nothing beyond this machine was ' +
          'reached, so nothing beyond this machine can be blamed yet.',
        remediation: [
          'Check Wi-Fi is on and connected, or that the ethernet cable is seated.',
          'Turn off airplane mode, and disconnect any VPN that may have failed closed.',
          'Reconnect, then run the triage again — every other check needs a link to exist.',
        ],
        evidence: [ev('browserOnline', 'navigator.onLine reports false')],
      };
    },
  },

  {
    id: 'dns-resolver-failing',
    title: 'Name resolution is broken on this network',
    layer: 'local-network',
    consumes: ['dns.verdict', 'dns.hostnameReachable', 'dns.literalIpReachable'],
    evaluate: (s) => {
      if (s.dns?.verdict !== 'resolver-failing') return null;
      return {
        confidence: 'confirmed',
        severity: 'blocking',
        verdict:
          'One server was reached by its literal IP address but not by name. The path out works; ' +
          'the thing that turns names into addresses does not.',
        remediation: [
          'Set your DNS servers manually to 1.1.1.1 and 1.0.0.1, or 8.8.8.8 and 8.8.4.4.',
          'Restart the router — a resolver that has stopped answering is the most common cause.',
          'If you are on a guest or hotel network, look for a sign-in page; some hold DNS hostage until you accept the terms.',
          'Enable DNS-over-HTTPS in your browser settings to bypass the local resolver entirely.',
        ],
        evidence: [
          ev('dns.literalIpReachable', `${s.dns.literalProbed} answered`),
          ev('dns.hostnameReachable', `${s.dns.hostnameProbed} did not answer`),
        ],
      };
    },
  },

  {
    id: 'dns-answers-diverge',
    title: 'Two DNS providers disagree about a fixed address',
    layer: 'internet',
    consumes: ['dns.verdict', 'dns.comparisons'],
    evaluate: (s) => {
      if (s.dns?.verdict !== 'answers-diverge') return null;
      const disagreeing = s.dns.comparisons.filter((c) => c.agrees === false);
      if (disagreeing.length === 0) return null;
      return {
        confidence: 'possible',
        severity: 'informational',
        verdict:
          'Two independent DNS-over-HTTPS providers returned different addresses for a name that ' +
          'answers identically everywhere. That is worth a look, though a provider changing its ' +
          'own infrastructure explains it just as well as tampering does.',
        remediation: [
          'Re-run the check; a record changing mid-query produces exactly this.',
          'If it persists, compare the addresses below against the provider’s published ones.',
        ],
        evidence: disagreeing.map((c) =>
          ev(
            'dns.comparisons',
            `${c.name}: Cloudflare returned ${c.cloudflare?.join(', ') ?? 'nothing'}; ` +
              `Google returned ${c.google?.join(', ') ?? 'nothing'}`,
          ),
        ),
      };
    },
  },

  {
    id: 'https-content-substituted',
    title: 'Something is answering in place of known endpoints',
    layer: 'local-network',
    consumes: ['portal.verdict', 'portal.probes'],
    evaluate: (s) => {
      if (s.portal?.verdict !== 'content-substituted') return null;
      const wrong = s.portal.probes.filter((p) => p.outcome === 'content-mismatch');
      return {
        confidence: 'likely',
        severity: 'blocking',
        verdict:
          'Endpoints whose exact response is known returned something else. Over HTTPS that ' +
          'requires a certificate this machine trusts, which means traffic is being intercepted ' +
          'and read — by a corporate inspection proxy, a filtering appliance, or a captive portal.',
        remediation: [
          'If this is a managed device on a corporate network, this is expected and intentional — check with whoever manages it.',
          'If it is not, inspect the certificate on any HTTPS site: an unexpected issuer names the interceptor.',
          'Review any recently installed root certificate, browser extension, or "security" product.',
        ],
        evidence: wrong.map((p) => ev('portal.probes', `${p.label}: ${p.note ?? 'unexpected content'}`)),
      };
    },
  },

  {
    id: 'https-blocked',
    title: 'Online, but no secure connection completes',
    layer: 'local-network',
    consumes: ['portal.verdict', 'browserOnline'],
    evaluate: (s) => {
      if (s.portal?.verdict !== 'https-blocked') return null;
      if (!s.browserOnline) return null;
      return {
        confidence: 'likely',
        severity: 'blocking',
        verdict:
          'The browser has a link and believes it is online, yet not one HTTPS endpoint answered. ' +
          'A captive portal cannot forge an HTTPS response, so it blocks instead — this is what ' +
          'that looks like from inside the browser.',
        remediation: [
          'Open any plain http:// address; a portal will redirect it to its sign-in page.',
          'On a phone or laptop, disconnecting and reconnecting to the Wi-Fi usually re-triggers the sign-in prompt.',
          'If there is no portal, a firewall is blocking outbound 443 — check for a proxy requirement on this network.',
        ],
        evidence: [
          ev('browserOnline', 'navigator.onLine reports true'),
          ev('portal.probes', 'no HTTPS endpoint answered'),
        ],
      };
    },
  },

  {
    id: 'all-cdns-unreachable',
    title: 'No content network could be reached',
    layer: 'isp',
    consumes: ['edge.probes', 'browserOnline'],
    evaluate: (s) => {
      const probes = s.edge?.probes ?? [];
      if (probes.length === 0 || !s.browserOnline) return null;
      const failed = probes.filter((p) => p.availability === 'request-failed');
      if (failed.length !== probes.length) return null;
      return {
        confidence: 'confirmed',
        severity: 'blocking',
        verdict:
          `All ${probes.length} independent content networks failed to answer. When four ` +
          'unrelated providers go dark at once, the fault is on the path out, not with any of them.',
        remediation: [
          'Power-cycle the router and modem, then re-run this check.',
          'If another device on the same network also fails, the problem is the connection itself — contact the ISP.',
          'If only this device fails, suspect a VPN, proxy setting, or firewall on this machine.',
        ],
        evidence: probes.map((p) =>
          ev('edge.probes', `${p.target.label} (${p.target.origin}) did not answer`),
        ),
      };
    },
  },

  {
    id: 'one-cdn-unreachable',
    title: 'One provider is unreachable while the rest are fine',
    layer: 'destination',
    consumes: ['edge.probes'],
    evaluate: (s) => {
      const probes = s.edge?.probes ?? [];
      if (probes.length < 2) return null;
      const failed = probes.filter((p) => p.availability === 'request-failed');
      if (failed.length === 0 || failed.length === probes.length) return null;
      return {
        confidence: 'likely',
        severity: 'informational',
        verdict:
          `${failed.length} of ${probes.length} content networks did not answer while the others ` +
          'did. Your connection is carrying traffic; something specific to those providers is not.',
        remediation: [
          'Nothing to fix locally — a working connection that cannot reach one provider is that provider’s problem, or a block aimed at it.',
          'If a site you need is on that provider, check its status page before changing anything here.',
        ],
        evidence: [
          ...failed.map((p) => ev('edge.probes', `${p.target.label} did not answer`)),
          ...probes
            .filter((p) => p.availability !== 'request-failed')
            .map((p) => ev('edge.probes', `${p.target.label} answered`)),
        ],
      };
    },
  },

  {
    id: 'udp-443-blocked',
    title: 'HTTP/3 is being forced back to HTTP/2',
    layer: 'local-network',
    consumes: ['edge.protocolEvidence'],
    evaluate: (s) => {
      if (s.edge?.protocolEvidence.verdict !== 'http3-absent-udp-possibly-blocked') return null;
      const e = s.edge.protocolEvidence;
      return {
        confidence: 'likely',
        severity: 'degrading',
        verdict:
          'Every origin that advertises HTTP/3 was reached over HTTP/2 instead. The browser tried ' +
          'QUIC and fell back, which points at UDP port 443 being blocked upstream. Things still ' +
          'work; they just lose the faster, loss-resilient path.',
        remediation: [
          'Check the router or firewall for a rule blocking outbound UDP 443 — some "QUIC blocking" toggles are on by default.',
          'On a corporate network this is often deliberate, to keep traffic inspectable.',
          'The cost is mainly on lossy links such as mobile and congested Wi-Fi.',
        ],
        evidence: [
          ev('edge.protocolEvidence', `${e.h2Count} origin(s) negotiated h2, none negotiated h3`),
        ],
      };
    },
  },

  {
    id: 'legacy-http1',
    title: 'Every connection fell back to HTTP/1.1',
    layer: 'local-network',
    consumes: ['edge.protocolEvidence'],
    evaluate: (s) => {
      if (s.edge?.protocolEvidence.verdict !== 'legacy-http1') return null;
      return {
        confidence: 'likely',
        severity: 'degrading',
        verdict:
          'Nothing negotiated better than HTTP/1.1, though all of these origins support HTTP/2. ' +
          'A proxy or TLS-inspecting middlebox in the path is the usual reason, and it costs both ' +
          'throughput and latency.',
        remediation: [
          'Look for an explicit proxy configured in the OS or browser network settings.',
          'On a managed device, an inspection appliance is likely doing this deliberately.',
        ],
        evidence: [
          ev(
            'edge.protocolEvidence',
            `negotiated: ${s.edge.protocolEvidence.negotiated.join(', ')}`,
          ),
        ],
      };
    },
  },

  {
    id: 'bufferbloat',
    title: 'Latency collapses under load',
    layer: 'local-network',
    consumes: ['speed.ping', 'speed.loadedPing'],
    evaluate: (s) => {
      const idle = s.speed?.ping ?? null;
      const loaded = s.speed?.loadedPing ?? null;
      if (idle === null || loaded === null) return null;
      const delta = loaded - idle;
      if (delta < THRESHOLDS.bufferbloatDeltaMs) return null;
      return {
        confidence: 'confirmed',
        severity: 'degrading',
        verdict:
          `Round-trip time rose from ${idle} ms idle to ${loaded} ms while the link was busy, an ` +
          `increase of ${Math.round(delta)} ms. That is bufferbloat: oversized queues holding ` +
          'packets rather than dropping them. It is why a call falls apart the moment something ' +
          'starts downloading, and no amount of extra bandwidth fixes it.',
        remediation: [
          'Enable Smart Queue Management (SQM / fq_codel / cake) on the router — this is the actual fix.',
          'If the router has no SQM, setting its bandwidth limit to about 90% of the measured rate keeps the queue in the router where it can be managed.',
          'Replace an ISP-supplied router that offers no queue management; it is the single most common cause.',
        ],
        evidence: [
          ev('speed.ping', `${idle} ms idle`),
          ev('speed.loadedPing', `${loaded} ms under load`),
        ],
      };
    },
  },

  {
    id: 'packet-loss',
    title: 'Packets are being dropped',
    layer: 'isp',
    consumes: ['ping.packetLoss', 'ping.packetsSent'],
    evaluate: (s) => {
      const sent = s.ping?.packetsSent ?? null;
      const loss = s.ping?.packetLoss ?? null;
      if (sent === null || loss === null) return null;
      // A loss percentage over three packets is arithmetic, not evidence.
      if (sent < THRESHOLDS.minPacketsForLoss) return null;
      if (loss < THRESHOLDS.packetLossPercent) return null;
      return {
        confidence: 'confirmed',
        severity: 'degrading',
        verdict:
          `${loss}% of probes went unanswered (${s.ping?.packetsReceived} of ${sent} returned). ` +
          'Loss at this level hurts calls and video far more than it hurts a download, because ' +
          'every drop costs a retransmission round trip.',
        remediation: [
          'Test again on a wired connection — if the loss disappears, it is Wi-Fi, not the line.',
          'If it persists while wired, record several runs and take them to the ISP; loss is the one symptom they cannot attribute to your equipment.',
          'Check for a failing cable or connector before anything else; intermittent loss is very often physical.',
        ],
        evidence: [
          ev('ping.packetLoss', `${loss}% loss`),
          ev('ping.packetsSent', `${sent} probes sent`),
        ],
      };
    },
  },

  {
    id: 'high-latency',
    title: 'Baseline latency is high',
    layer: 'isp',
    consumes: ['ping.avgPing', 'speed.ping'],
    evaluate: (s) => {
      const latency = measuredLatency(s);
      if (latency === null || latency < THRESHOLDS.highLatencyMs) return null;
      return {
        confidence: 'confirmed',
        severity: 'degrading',
        verdict:
          `Round-trip time to a nearby edge is ${latency} ms even when the link is idle. This is ` +
          'a property of the path, not of its capacity, so more bandwidth will not change it.',
        remediation: [
          'Satellite and some mobile links are inherently this slow; if that is the connection, this is the ceiling.',
          'Otherwise check for a VPN or proxy routing traffic somewhere distant before it reaches the internet.',
          'Compare with the Edge Path Explorer: if the serving edge is far away, the distance is the explanation.',
        ],
        evidence: [ev('ping.avgPing', `${latency} ms mean round trip while idle`)],
      };
    },
  },

  {
    id: 'high-jitter',
    title: 'Latency is unstable',
    layer: 'local-network',
    consumes: ['ping.jitter', 'speed.jitter'],
    evaluate: (s) => {
      const jitter = measuredJitter(s);
      if (jitter === null || jitter < THRESHOLDS.highJitterMs) return null;
      return {
        confidence: 'confirmed',
        severity: 'degrading',
        verdict:
          `Consecutive probes differed by ${jitter} ms on average. Variable latency is what makes ` +
          'voices break up and video freeze, even when the average looks perfectly acceptable.',
        remediation: [
          'Move closer to the access point, or switch to 5 GHz — congested 2.4 GHz is the usual source.',
          'Test wired. Jitter that vanishes on a cable was never a line problem.',
          'Check whether something else on the network is saturating the link while you test.',
        ],
        evidence: [ev('ping.jitter', `${jitter} ms mean consecutive difference`)],
      };
    },
  },

  {
    id: 'low-download',
    title: 'Download bandwidth is low',
    layer: 'isp',
    consumes: ['speed.downloadSpeed'],
    evaluate: (s) => {
      const dl = s.speed?.downloadSpeed ?? null;
      if (dl === null || dl >= THRESHOLDS.lowDownloadMbps) return null;
      return {
        confidence: 'confirmed',
        severity: 'degrading',
        verdict:
          `Measured download throughput was ${dl} Mbps. That is enough for one video stream and ` +
          'not much else at the same time.',
        remediation: [
          'Compare against the rate the plan is sold at; a large gap is a support case with evidence attached.',
          'Test wired before calling — Wi-Fi is the bottleneck more often than the line is.',
          'Make sure nothing else was transferring during the test; the measurement includes whatever else the link was carrying.',
        ],
        evidence: [ev('speed.downloadSpeed', `${dl} Mbps measured`)],
      };
    },
  },

  {
    id: 'no-ipv6',
    title: 'No IPv6 path',
    layer: 'isp',
    consumes: ['dualStack.verdict'],
    evaluate: (s) => {
      if (s.dualStack?.verdict !== 'ipv4-only') return null;
      return {
        confidence: 'possible',
        severity: 'informational',
        verdict:
          'IPv4-only hosts answered and IPv6-only hosts did not. Either this network has no IPv6 ' +
          'or something is dropping it. This is common and rarely a problem — almost everything ' +
          'still publishes an IPv4 address.',
        remediation: [
          'Nothing needs fixing unless a service you use is IPv6-only.',
          'If IPv6 is expected here, check whether the router has it enabled and whether the ISP has provisioned a prefix.',
        ],
        evidence: [
          ev('dualStack.verdict', 'IPv4-only hosts answered; IPv6-only hosts did not'),
        ],
      };
    },
  },
];
