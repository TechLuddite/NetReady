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

export interface SpeedTestResult {
  id: string;
  timestamp: number;
  downloadSpeed: number; // Mbps
  uploadSpeed: number; // Mbps
  ping: number; // ms
  jitter: number; // ms
  loadedPing?: number; // ms under load
  bufferbloatScore?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  serverName?: string;
  totalBytesDownloaded?: number; // MB
  totalBytesUploaded?: number; // MB
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
  minPing: number;
  maxPing: number;
  avgPing: number;
  jitter: number;
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
  isKnown: boolean;
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
  overallScore: number; // 0 - 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  gamingScore: number;
  streamingScore: number;
  voipScore: number;
  browsingScore: number;
  downloadScore: number;
  details: string[];
}
