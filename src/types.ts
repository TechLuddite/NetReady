export type ToolTab = 
  | 'dashboard'
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

export interface HistoryItem {
  id: string;
  type: 'speedtest' | 'ping' | 'dns' | 'webrtc' | 'httpprobe' | 'websocket' | 'cidr' | 'mac' | 'portscanner' | 'tracert' | 'geoip';
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
