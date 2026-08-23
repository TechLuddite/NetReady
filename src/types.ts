export type ToolTab =
  | 'dashboard'
  | 'walktest'
  | 'triage'
  | 'dualstack'
  | 'captive'
  | 'edgepath'
  | 'tracert'
  | 'portscanner'
  | 'geoip'
  | 'speedtest'
  | 'ping'
  | 'dns'
  | 'dnsbench'
  | 'webrtc'
  | 'cidr'
  | 'mac'
  | 'httpprobe'
  | 'websocket'
  | 'history'
  | 'export';

export interface NetworkConnectionInfo {
  downlink?: number; // Mbps
  effectiveType?: string; // '4g', '3g', '2g', 'slow-2g'
  rtt?: number; // ms
  saveData?: boolean;
  type?: string; // 'wifi', 'cellular', etc.
  isOnline: boolean;
  onlineSince?: string;
}

/**
 * Why a value is absent.
 *
 * NetReady reports `null` for anything it could not measure, never a plausible
 * substitute. Earlier versions filled failures in with invented numbers
 * (`navigator.connection.downlink || 25`, `uploadSpeed = downloadSpeed * 0.4`,
 * `ping = 18`), which meant an offline user received a complete, confident,
 * entirely fictional report — and exported it to CSV. A missing measurement is
 * information; a fabricated one is not.
 */
export type FailureReason =
  | 'cors-blocked'
  | 'timeout'
  | 'network-offline'
  | 'browser-restricted-port'
  | 'api-rate-limited'
  | 'api-unreachable'
  | 'unsupported-api'
  | 'insufficient-samples'
  | 'aborted'
  /** A page served over https: may not open a plaintext http: connection. Some
   *  checks — the classic captive-portal `generate_204` probe, anything aimed at
   *  a LAN device with no certificate — are therefore impossible from the
   *  deployed build and possible only from a local http: origin. That is a
   *  browser rule, not a network result, and is reported as its own reason so it
   *  is never confused with "the target did not answer". */
  | 'mixed-content-blocked'
  | 'not-attempted';

export interface MeasurementFailure {
  /** Which metric could not be produced, e.g. 'uploadSpeed'. */
  metric: string;
  reason: FailureReason;
  /** One sentence a non-expert can read. Shown in the UI verbatim. */
  detail: string;
}

export interface SpeedTestResult {
  id: string;
  timestamp: number;
  /** Mbps, or null when the transfer produced no measurable bytes. */
  downloadSpeed: number | null;
  uploadSpeed: number | null;
  /** ms, or null when every probe failed. */
  ping: number | null;
  /** ms; needs at least two samples, otherwise null. */
  jitter: number | null;
  loadedPing?: number | null;
  /** Only gradeable when both idle and loaded ping were measured. */
  bufferbloatScore?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | null;
  serverName?: string;
  totalBytesDownloaded?: number; // MB
  totalBytesUploaded?: number; // MB
  /** Everything this run could not determine, and why. */
  failures?: MeasurementFailure[];
}

export interface PingPoint {
  sequence: number;
  time: number; // ms or -1 if timeout
  status: 'success' | 'timeout' | 'error';
  timestamp: number;
}

export interface PingResult {
  id: string;
  timestamp: number;
  target: string;
  label: string;
  packetsSent: number;
  packetsReceived: number;
  packetLoss: number; // %
  /** null when no packet was answered — an unanswered target has no RTT. */
  minPing: number | null;
  maxPing: number | null;
  avgPing: number | null;
  /** Needs at least two answered packets. */
  jitter: number | null;
  points: PingPoint[];
}

export interface DnsRecord {
  name: string;
  type: number;
  typeName: string;
  TTL: number;
  data: string;
}

export interface DnsQueryResult {
  id: string;
  timestamp: number;
  domain: string;
  recordType: string;
  provider: 'cloudflare' | 'google';
  status: number; // 0 = NOERROR, 3 = NXDOMAIN, etc.
  statusText: string;
  responseTimeMs: number;
  records: DnsRecord[];
  rawJson: any;
}

export interface IceCandidateInfo {
  candidate: string;
  type: 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';
  protocol: 'udp' | 'tcp';
  ip?: string;
  port?: number;
  foundation?: string;
  priority?: number;
}

export interface WebRtcResult {
  id: string;
  timestamp: number;
  stunServer: string;
  candidates: IceCandidateInfo[];
  publicIps: string[];
  localIps: string[];
  gatheringTimeMs: number;
  natTypeInference: string;
}

export interface CidrResult {
  ip: string;
  prefix: number;
  netmask: string;
  wildcard: string;
  networkAddress: string;
  broadcastAddress: string;
  firstUsableIp: string;
  lastUsableIp: string;
  totalHosts: number;
  usableHosts: number;
  ipClass: string;
  isPrivate: boolean;
  binaryIp: string;
  binaryNetmask: string;
}

export interface MacLookupResult {
  mac: string;
  cleanMac: string;
  oui: string;
  vendor: string;
  addressType: 'Unicast' | 'Multicast';
  administration: 'Globally Unique (U/L = 0)' | 'Locally Administered (U/L = 1)';
  /** True only when the OUI is present in the offline IEEE database. */
  isKnown: boolean;
  /** True when fewer than 12 hex digits were supplied, so only the vendor
   *  prefix is known and the device half of the address is not. */
  isPartial?: boolean;
}

export interface HttpProbeResult {
  id: string;
  timestamp: number;
  url: string;
  status?: number;
  statusText?: string;
  responseTimeMs: number;
  corsAllowed: boolean;
  isOk: boolean;
  error?: string;
  headers?: Record<string, string>;
}

export interface WebSocketResult {
  id: string;
  timestamp: number;
  url: string;
  handshakeTimeMs: number;
  pings: number[];
  avgPingMs: number;
  status: 'connected' | 'error' | 'closed';
  messagesSent: number;
  messagesReceived: number;
}

export interface PortStatus {
  host: string;
  port: number;
  status: 'open' | 'closed' | 'filtered';
  latencyMs: number;
  service?: string;
  description?: string;
  isWeb?: boolean;
  protocol?: 'http' | 'https';
}

export interface PortScanResult {
  id: string;
  timestamp: number;
  targetHost: string;
  subnet?: string;
  scannedHosts: string[];
  scannedPorts: number[];
  openPortsCount: number;
  closedPortsCount: number;
  filteredPortsCount: number;
  discoveredHostsCount: number;
  ports: PortStatus[];
  scanDurationMs: number;
  scanEngine?: 'server' | 'browser';
}

export interface TracertHop {
  hop: number;
  ip: string;
  hostname: string;
  rtt1: number; // ms (-1 if timeout)
  rtt2: number;
  rtt3: number;
  avgRtt: number;
  status: 'success' | 'slow' | 'timeout';
  lat: number;
  lng: number;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  isp: string;
  asn: string;
  nodeType: 'client' | 'gateway' | 'isp_pop' | 'transit' | 'backbone' | 'datacenter' | 'destination';
}

export interface TracertResult {
  id: string;
  timestamp: number;
  targetHost: string;
  targetIp: string;
  protocol: 'ICMP' | 'UDP' | 'TCP';
  maxHops: number;
  totalHops: number;
  totalDistanceKm: number;
  avgLatencyMs: number;
  totalTimeMs: number;
  hops: TracertHop[];
}

export interface GeoIpResult {
  id: string;
  timestamp: number;
  ip: string;
  query: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  flag?: string;
  postal?: string;
  lat: number;
  lng: number;
  timezone?: string;
  isp: string;
  org?: string;
  asn?: string;
  callingCode?: string;
  currency?: string;
  isProxy?: boolean;
  isVpn?: boolean;
}

// ---------------------------------------------------------------------------
// Edge Path Explorer
//
// What a browser can genuinely observe about the path to a host: the phase
// breakdown of a connection, which CDN edge answered, what protocol was
// negotiated, and an upper bound on distance implied by round-trip time.
//
// What it cannot observe is any intermediate router, because there is no way to
// send an ICMP packet or set an IP TTL from a web page. Nothing here claims to.
// ---------------------------------------------------------------------------

/** Why a phase breakdown is unavailable for a given target. */
export type TimingAvailability =
  | 'available'
  /** Cross-origin responses zero out every phase field unless the server sends
   *  a `Timing-Allow-Origin` header. Those zeros are not "0 ms". */
  | 'timing-allow-origin-missing'
  /** DNS, TCP and TLS only happen on the first connection to an origin. A
   *  reused connection legitimately has no handshake to report. */
  | 'connection-reused'
  | 'request-failed';

/**
 * Connection phase breakdown from the Resource Timing API. Each field is
 * milliseconds spent in that phase, or null when it was not observable.
 */
export interface PhaseTimings {
  dnsMs: number | null;
  tcpMs: number | null;
  /** TLS handshake, contained within the TCP connect window. */
  tlsMs: number | null;
  /** Time to first byte: request sent → first byte of response. */
  ttfbMs: number | null;
  /** Content download: first byte → last byte. */
  transferMs: number | null;
  totalMs: number | null;
}

export interface EdgeTarget {
  label: string;
  /** Origin probed, e.g. `https://speed.cloudflare.com`. */
  origin: string;
  /** Small resource fetched to elicit the timings. */
  probeUrl: string;
  /** Whether this origin is expected to send Timing-Allow-Origin. Verified at
   *  runtime — this only drives target ordering, never the reported result. */
  expectsTao: boolean;
}

export interface EdgeProbeResult {
  target: EdgeTarget;
  availability: TimingAvailability;
  phases: PhaseTimings;
  /** Negotiated protocol: 'h3', 'h2', 'http/1.1'. Null when TAO is absent. */
  protocol: string | null;
  /** Wall-clock round trip, always measurable even without TAO. */
  roundTripMs: number | null;
  /** Upper bound on client→server distance implied by roundTripMs. */
  maxDistanceKm: number | null;
  error?: string;
}

/** The CDN edge that answered, resolved to a real location. */
export interface EdgePop {
  /** IATA code reported by the edge, e.g. 'SYD'. */
  colo: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  /** True when the colo code was not in the bundled IATA table. */
  unmappedCode: boolean;
  /** Protocol the edge reported for this connection. */
  httpProtocol: string | null;
}

/** Client identity as the edge sees it. Distinct from the edge's own location. */
export interface EdgeClientView {
  ip: string | null;
  asn: number | null;
  asOrganization: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Evidence about HTTP/3 support. A network that blocks UDP/443 forces a fallback
 * to HTTP/2 even against origins that advertise h3, which is directly
 * observable and worth surfacing.
 */
export interface ProtocolEvidence {
  /** Protocols negotiated across all probed origins, deduplicated. */
  negotiated: string[];
  h3Count: number;
  h2Count: number;
  http1Count: number;
  /** Null when no origin produced a readable protocol. */
  verdict:
    | 'http3-working'
    | 'http3-absent-udp-possibly-blocked'
    | 'http2-only'
    | 'legacy-http1'
    | null;
  explanation: string;
}

export interface EdgePathResult {
  id: string;
  timestamp: number;
  /** Host the user asked about, if any. */
  targetHost: string | null;
  /** Edge that served the target host, when it is behind a readable CDN. */
  targetPop: EdgePop | null;
  /** Edge that served NetReady's own reference probe. */
  referencePop: EdgePop | null;
  client: EdgeClientView | null;
  probes: EdgeProbeResult[];
  protocolEvidence: ProtocolEvidence;
  /** Great-circle distance client→edge, when both locations are known. */
  clientToPopKm: number | null;
  totalTimeMs: number;
  failures: MeasurementFailure[];
}

// ---------------------------------------------------------------------------
// Dual-stack reachability
//
// A browser cannot enumerate the interfaces it has, or ask which address family
// a connection used. What it can do is connect to hostnames that publish only an
// A record or only an AAAA record, and see which ones answer. That is a direct
// observation of whether traffic in each family leaves this machine and comes
// back — nothing is inferred from `navigator.connection` or from the shape of an
// address the page never received.
// ---------------------------------------------------------------------------

export type AddressFamily = 'ipv4' | 'ipv6';

/** One family-pinned endpoint and what happened when the browser called it. */
export interface FamilyProbe {
  family: AddressFamily;
  /** Hostname published with only A records (ipv4) or only AAAA records (ipv6). */
  host: string;
  url: string;
  /**
   * `answered` means a response came back, which proves the family works
   * end-to-end. `no-response` means it did not, which is *not* the same as
   * proving the family is unavailable — the probe host could itself be down.
   * The distinction is preserved all the way to the UI copy.
   */
  outcome: 'answered' | 'no-response';
  /** Round-trip in ms; null when nothing came back. */
  roundTripMs: number | null;
  /** Address the endpoint reported seeing, when it is readable cross-origin. */
  observedIp: string | null;
  error: string | null;
}

export interface DualStackResult {
  id: string;
  timestamp: number;
  probes: FamilyProbe[];
  /** True when at least one endpoint in that family answered, false when every
   *  one of them was tried and none did, null when none was tried at all. A
   *  family that was never probed is not a family that failed. */
  ipv4Reachable: boolean | null;
  ipv6Reachable: boolean | null;
  /**
   * Which family the browser actually chose for a dual-stack host, read from
   * the address that host reported seeing. Null when no dual-stack host
   * answered, or when its answer was not readable.
   */
  preferredFamily: AddressFamily | null;
  preferredFamilySource: string | null;
  verdict:
    | 'dual-stack'
    | 'ipv4-only'
    | 'ipv6-only'
    | 'neither-family-answered'
    | null;
  explanation: string;
  totalTimeMs: number;
  failures: MeasurementFailure[];
}

// ---------------------------------------------------------------------------
// Captive portal and DNS integrity
//
// From an https: page a captive portal cannot rewrite a response without
// breaking TLS, so its signature is not a redirect the page can read — it is
// that secure connections stop completing while the browser still believes it is
// online. These checks look for exactly that, and for the one form of DNS
// tampering a browser genuinely can observe: a hostname failing while the same
// server's literal IP still answers.
// ---------------------------------------------------------------------------

/** A request whose correct response is known in advance, so a wrong one is
 *  evidence of interception rather than of a slow network. */
export interface IntegrityProbe {
  label: string;
  url: string;
  /** What a correct response looks like, in one phrase, for the UI. */
  expectation: string;
  outcome:
    /** Reached the endpoint and the response was exactly as expected. */
    | 'verified'
    /** Reached something, but it did not return what this endpoint returns. */
    | 'content-mismatch'
    /** Nothing came back at all. */
    | 'no-response'
    /** Could not be attempted from this origin — see `note`. */
    | 'not-attempted';
  roundTripMs: number | null;
  note: string | null;
}

export interface CaptivePortalResult {
  id: string;
  timestamp: number;
  /** `location.protocol` at the time of the run. The plaintext generate_204
   *  probe is only available from an http: origin. */
  pageProtocol: string;
  probes: IntegrityProbe[];
  verdict:
    /** Every endpoint returned exactly its own content. */
    | 'no-interception-detected'
    /** Something answered in place of a known endpoint. */
    | 'content-substituted'
    /** Browser says online, yet no HTTPS endpoint completed. */
    | 'https-blocked'
    /** Some answered and some did not — not a clean signature either way. */
    | 'mixed'
    | null;
  explanation: string;
  totalTimeMs: number;
  failures: MeasurementFailure[];
}

/** One name resolved through two independent DNS-over-HTTPS providers. */
export interface DohComparison {
  name: string;
  /** Sorted record data from each provider, or null when the query failed. */
  cloudflare: string[] | null;
  google: string[] | null;
  /** Null when either side is missing — absence is not disagreement. */
  agrees: boolean | null;
}

export interface DnsIntegrityResult {
  id: string;
  timestamp: number;
  /**
   * Reaching a host by name exercises the system resolver. Reaching the same
   * server by literal IP does not. Comparing the two outcomes is the only way a
   * web page can test the resolver it is not allowed to read.
   */
  hostnameReachable: boolean | null;
  literalIpReachable: boolean | null;
  hostnameProbed: string;
  literalProbed: string;
  comparisons: DohComparison[];
  verdict:
    | 'resolver-working'
    /** Names fail while the same server answers on its literal IP. */
    | 'resolver-failing'
    /** Providers returned different addresses for a name that is the same
     *  everywhere. */
    | 'answers-diverge'
    | null;
  explanation: string;
  totalTimeMs: number;
  failures: MeasurementFailure[];
}

// ---------------------------------------------------------------------------
// DNS resolver benchmark
//
// Inspired by Steve Gibson's GRC DNS Benchmark, which measures DNS over UDP
// against a nameserver's IP address, separating cached, uncached and "dotcom"
// lookups. A browser cannot do that: no raw sockets, no way to learn the system
// resolver's address, and no way to read the phase breakdown of a cross-origin
// request. What it *can* do is time RFC 8484 DNS-over-HTTPS queries to public
// resolvers that permit cross-origin reads.
//
// Every millisecond in these types is therefore a full HTTPS round trip — TLS,
// HTTP framing and the operator's front-end included. It is not "DNS lookup
// time", and nothing in this file or its UI calls it that. The system/ISP
// resolver, the one most users actually want measured, cannot be benchmarked
// from a web page at all; that is stated in the UI rather than approximated.
// ---------------------------------------------------------------------------

/** The three lookup kinds GRC's benchmark separates, and why each is distinct:
 *  a resolver can be fast from cache and slow to reach the wider internet. */
export type DnsProbeKind = 'cached' | 'uncached' | 'dotcom';

export interface DnsMetricSummary {
  /** Queries that produced a readable DNS response. Deliberately not called
   *  "reliability": over HTTPS a failed request may be the resolver, the
   *  network, an extension or TLS, and a browser cannot tell them apart. */
  answered: number;
  attempted: number;
  medianMs: number | null;
  /** Null below ten samples — see `summariseSamples` in network.ts. */
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  stdDevMs: number | null;
}

/** What a resolver did when asked for a name that provably does not exist.
 *  `answers-with-an-address` is deliberately neutral: the observation is that
 *  an address came back, not why. */
export type NxdomainHonesty = 'honest' | 'answers-with-an-address' | 'inconclusive';

export type DnssecValidation = 'validates' | 'does-not-validate' | 'inconclusive';

export type ResolverOutcome =
  | 'measured'
  | 'partially-measured'
  | 'no-readable-answer'
  | 'blocked-by-browser'
  | 'not-attempted';

export interface ResolverBenchmark {
  resolverId: string;
  label: string;
  operator: string;
  endpoint: string;
  /** The operator's published filtering policy, quoted for context. Not
   *  measured, and no verdict is derived from it. */
  policyNote: string;
  cached: DnsMetricSummary;
  uncached: DnsMetricSummary;
  dotcom: DnsMetricSummary;
  /**
   * Uncached median minus cached median, for this resolver only.
   *
   * Both halves went to the same endpoint over the same connection, so the
   * constant HTTPS transport cost largely cancels and what remains is closer to
   * the resolver's own cost of leaving its cache. It is a difference of two
   * medians, not the median of paired differences, so it cancels the *typical*
   * transport cost rather than any single query's.
   *
   * Null when either median is null. May be negative — a "cached" name whose
   * TTL had expired at that anycast node produces exactly that — and the
   * negative is reported. Clamping it to zero would be substituting a value for
   * a measurement.
   */
  uncachedCostMs: number | null;
  nxdomainHonesty: NxdomainHonesty;
  nxdomainDetail: string;
  /** Null when DNSSEC checking was switched off for the run, which is not the
   *  same as having checked and been unable to tell. */
  dnssec: DnssecValidation | null;
  dnssecDetail: string;
  outcome: ResolverOutcome;
  note: string;
}

export interface DnsBenchmarkResult {
  id: string;
  timestamp: number;
  resolvers: ResolverBenchmark[];
  samplesPerMetric: number;
  /** The popular names used for the cached measurement, so a reader can see
   *  what was actually asked for. */
  namesQueried: string[];
  dnssecRequested: boolean;
  /**
   * Whether the browser could read the DNS/TCP/TLS phase breakdown of these
   * requests. Observed from the Resource Timing entries rather than asserted:
   * no DoH endpoint currently sends `Timing-Allow-Origin`, but that is a fact
   * about today's deployments, not a law, so it is re-checked each run. Null
   * when no timing entry was readable at all.
   */
  phaseTimingsAvailable: boolean | null;
  fastestCachedResolverId: string | null;
  /** True when the fastest resolver's observed range overlaps the runner-up's,
   *  i.e. this run does not separate them. Null when there is no runner-up. */
  fastestIsWithinNoise: boolean | null;
  verdict: 'measured' | 'partial' | 'nothing-measured' | null;
  explanation: string;
  /** Plain-English findings, in the spirit of GRC's "Conclusions" tab. Empty
   *  when nothing was measured — silence is not a clean bill of health. */
  conclusions: string[];
  totalTimeMs: number;
  failures: MeasurementFailure[];
}

// ---------------------------------------------------------------------------
// Walk & Test
//
// Repeated reachability probes to a fixed set of well-known destinations, tagged
// with the spot the phone was standing in when they were taken. After Richard
// Astbury's Azure Speed Test, which times a fixed list of regions over and over
// and lets the table settle — except that here you are expected to move between
// readings, so the deliverable is a comparison between spots rather than one
// figure for "the network".
//
// Every millisecond below is a full HTTPS request round trip to the
// destination's nearest edge, measured with `no-cors`. That means the response
// is opaque by construction: a completed request proves the edge answered and
// how long it took, and says nothing whatsoever about what it answered. There is
// no ICMP ping available to a web page and nothing here pretends otherwise.
// ---------------------------------------------------------------------------

export type WalkCategory = 'consumer' | 'business';

export interface WalkTarget {
  id: string;
  label: string;
  category: WalkCategory;
  host: string;
  /** Small, unauthenticated resource fetched to elicit the round trip. */
  url: string;
  /** What this endpoint actually is, shown on screen so a reader can judge the
   *  number rather than take the brand name for the whole service. */
  note: string;
}

/** `no-response` covers a timeout, a refused connection, a failed name lookup
 *  and being out of range. A browser cannot separate them, so neither does this
 *  — and it is deliberately not called packet loss, which would imply an ICMP
 *  measurement that never happened. */
export type WalkProbeOutcome = 'answered' | 'no-response';

export interface WalkSample {
  targetId: string;
  waypointId: string;
  /** 1-based round number. Every destination is probed once per round. */
  round: number;
  timestamp: number;
  /** null when nothing came back — never 0, which would read as instant. */
  roundTripMs: number | null;
  outcome: WalkProbeOutcome;
  /**
   * True for the first probe against this destination in this run, which pays
   * for DNS, TCP and TLS on top of the round trip. It is kept and counted, and
   * excluded from the timing statistics, the same way the DNS benchmark
   * discards its warm-up query.
   */
  connectionSetup: boolean;
}

/** A place you stood still for a while. */
export interface WalkWaypoint {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  /**
   * What `navigator.connection` claimed at the moment the spot was created.
   * Reported by the browser, not measured by NetReady — it is coarse, it is
   * optional, and Safari and Firefox do not implement it at all. Recorded as
   * context for a reader, never used to fill in a missing measurement.
   */
  reportedConnectionType: string | null;
  reportedEffectiveType: string | null;
}

/** Timing statistics over a set of samples. Same shape as the DNS benchmark's
 *  summary, and for the same reason: the counts have to travel with the
 *  statistics or a median from two answers looks like a median from two
 *  hundred. */
export interface WalkTimingSummary {
  answered: number;
  attempted: number;
  /** Null below the minimum sample count — see `summariseSamples`. */
  medianMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  stdDevMs: number | null;
}

export interface WalkTargetStats {
  targetId: string;
  label: string;
  category: WalkCategory;
  summary: WalkTimingSummary;
  /** Mean absolute change between consecutive answered probes. Null below two. */
  jitterMs: number | null;
  lastRoundTripMs: number | null;
  lastOutcome: WalkProbeOutcome | null;
}

export interface WalkWaypointStats {
  waypointId: string;
  label: string;
  attempted: number;
  answered: number;
  rounds: number;
  perTarget: WalkTargetStats[];
  /**
   * Median of the per-destination medians, rather than a median over every
   * sample pooled together. Pooling would make this figure move whenever a
   * destination stopped answering, because the mix of destinations changed and
   * not the network.
   */
  medianOfTargetMediansMs: number | null;
  /** The destinations that contributed a median. Two spots are only comparable
   *  over the destinations that produced one at both, so the pool travels with
   *  the number. */
  pooledTargetIds: string[];
}

export interface WalkTestResult {
  id: string;
  timestamp: number;
  targets: WalkTarget[];
  waypoints: WalkWaypoint[];
  /** Most recent raw samples, capped for storage. Statistics are computed over
   *  every sample before truncation; `samplesDropped` says how many are absent
   *  from this record. */
  samples: WalkSample[];
  samplesDropped: number;
  rounds: number;
  perTarget: WalkTargetStats[];
  perWaypoint: WalkWaypointStats[];
  /** Plain-English findings. Empty when nothing was measured — silence is not a
   *  clean bill of health. */
  conclusions: string[];
  intervalMs: number;
  durationMs: number;
  failures: MeasurementFailure[];
}

export interface HistoryItem {
  id: string;
  type:
    | 'speedtest'
    | 'ping'
    | 'dns'
    | 'webrtc'
    | 'httpprobe'
    | 'websocket'
    | 'cidr'
    | 'mac'
    | 'portscanner'
    | 'tracert'
    | 'geoip'
    | 'edgepath'
    | 'triage'
    | 'dualstack'
    | 'captive'
    | 'dnsbench'
    | 'walktest';
  timestamp: number;
  title: string;
  summary: string;
  data: any;
}

export interface NetReadyScore {
  overallScore: number; // 0 - 100, averaged over the categories that were scorable
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** null when the measurements this category depends on are missing. */
  gamingScore: number | null;
  streamingScore: number | null;
  voipScore: number | null;
  browsingScore: number | null;
  downloadScore: number | null;
  details: string[];
  /** Inputs the score had to do without. A score computed from partial data
   *  says so rather than quietly filling the gaps with typical values. */
  missingInputs: string[];
}
