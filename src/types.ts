export type ToolTab =
  | 'dashboard'
  | 'edgepath'
  | 'tracert'
  | 'portscanner'
  | 'geoip'
  | 'speedtest'
  | 'ping'
  | 'dns'
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
    | 'edgepath';
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
