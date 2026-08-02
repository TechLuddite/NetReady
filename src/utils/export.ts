import JSZip from 'jszip';
import type {
  HistoryItem,
  SpeedTestResult,
  PingResult,
  PortScanResult,
  DnsQueryResult,
  GeoIpResult,
} from '../types';

export const TEST_TYPES = [
  { id: 'tracert', label: 'Traceroute (TRACERT)', filename: 'tracert_results.csv', icon: 'GitCommit' },
  { id: 'speedtest', label: 'Speed Test Results', filename: 'speedtest_results.csv', icon: 'Gauge' },
  { id: 'ping', label: 'Ping & Latency Tests', filename: 'ping_results.csv', icon: 'Radio' },
  { id: 'portscanner', label: 'Port Scanner Results', filename: 'portscanner_results.csv', icon: 'Radar' },
  { id: 'geoip', label: 'GeoIP Lookups', filename: 'geoip_results.csv', icon: 'Compass' },
  { id: 'dns', label: 'DNS Queries', filename: 'dns_results.csv', icon: 'Globe' },
  { id: 'webrtc', label: 'WebRTC & ICE Analysis', filename: 'webrtc_results.csv', icon: 'ShieldCheck' },
  { id: 'httpprobe', label: 'HTTP Probes', filename: 'httpprobe_results.csv', icon: 'Zap' },
  { id: 'websocket', label: 'WebSocket Latency', filename: 'websocket_results.csv', icon: 'Activity' },
  { id: 'cidr', label: 'CIDR Subnet Calculations', filename: 'cidr_results.csv', icon: 'Calculator' },
  { id: 'mac', label: 'MAC Vendor Lookups', filename: 'mac_results.csv', icon: 'Search' },
] as const;

export type TestTypeId = typeof TEST_TYPES[number]['id'];

/**
 * Escapes a value for CSV.
 *
 * Two jobs. The obvious one is quoting. The other is neutralising formula
 * injection: Excel, Sheets and LibreOffice execute any cell beginning with
 * `=`, `+`, `-`, `@`, tab or carriage return. NetReady's CSV fields include
 * hostnames the user typed and ISP/city strings returned by third-party APIs,
 * so a target named `=cmd|'/c calc'!A1` would otherwise become a live formula
 * in whoever opens the report. Prefixing with an apostrophe forces text.
 *
 * Note that an absent value produces an empty cell, never `0` — a blank in a
 * NetReady export means "not measured".
 */
export const escapeCsv = (val: unknown): string => {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
};

/**
 * Triggers a browser download for generated content.
 *
 * Uses a Blob rather than a `data:` URI — the JSON exporter used to build a
 * `data:` URL from the entire history, which silently fails once the history
 * exceeds the browser's URL length limit. The object URL is revoked on the next
 * frame rather than synchronously, because Safari and Firefox abort the
 * download if the URL disappears in the same tick as the click.
 */
export function triggerDownload(
  content: BlobPart,
  filename: string,
  mime = 'text/csv;charset=utf-8;',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `YYYY-MM-DD` stamp used in every export filename. */
export const exportDateStamp = (): string => new Date().toISOString().slice(0, 10);

// Generate Master Summary CSV
export function generateMasterSummaryCsv(items: HistoryItem[]): string {
  const headers = ['ID', 'Timestamp', 'Formatted Date', 'Test Type', 'Title', 'Summary Details'];
  const rows = items.map((item) => [
    escapeCsv(item.id),
    escapeCsv(item.timestamp),
    escapeCsv(new Date(item.timestamp).toLocaleString()),
    escapeCsv(item.type),
    escapeCsv(item.title),
    escapeCsv(item.summary),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Generate Tracert CSV
export function generateTracertCsv(items: HistoryItem[]): string {
  const tracertItems = items.filter((i) => i.type === 'tracert');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Target Host',
    'Resolved IP',
    'Protocol',
    'Total Hops',
    'Total Distance (km)',
    'Avg Route Latency (ms)',
    'Total Time (ms)',
    'Hop #',
    'Hop IP',
    'Hop Hostname',
    'Hop Avg RTT (ms)',
    'Hop Status',
    'Hop Location',
    'Hop ISP / ASN',
  ];

  const rows: string[][] = [];

  tracertItems.forEach((item) => {
    const d = item.data || {};
    const dateStr = new Date(item.timestamp).toLocaleString();

    if (Array.isArray(d.hops) && d.hops.length > 0) {
      d.hops.forEach((h: any) => {
        rows.push([
          escapeCsv(item.id),
          escapeCsv(item.timestamp),
          escapeCsv(dateStr),
          escapeCsv(d.targetHost || item.title),
          escapeCsv(d.targetIp || ''),
          escapeCsv(d.protocol || 'ICMP'),
          escapeCsv(d.totalHops || d.hops.length),
          escapeCsv(d.totalDistanceKm || 0),
          escapeCsv(d.avgLatencyMs || 0),
          escapeCsv(d.totalTimeMs || 0),
          escapeCsv(h.hop),
          escapeCsv(h.ip),
          escapeCsv(h.hostname || ''),
          escapeCsv(h.avgRtt > 0 ? h.avgRtt : 'Timeout'),
          escapeCsv(h.status || ''),
          escapeCsv(`${h.city || ''}, ${h.country || ''}`.trim()),
          escapeCsv(`${h.isp || ''} (${h.asn || ''})`.trim()),
        ]);
      });
    } else {
      rows.push([
        escapeCsv(item.id),
        escapeCsv(item.timestamp),
        escapeCsv(dateStr),
        escapeCsv(item.title),
        escapeCsv(''),
        escapeCsv('ICMP'),
        escapeCsv(0),
        escapeCsv(0),
        escapeCsv(0),
        escapeCsv(0),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
      ]);
    }
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Speed test CSV.
 *
 * The field names here were wrong in every column: this read `downloadMbps`,
 * `uploadMbps`, `pingMs`, `jitterMs` against a record that stores
 * `downloadSpeed`, `uploadSpeed`, `ping`, `jitter` — and `ip`/`isp`/`location`,
 * which `SpeedTestResult` has never had. Every value fell through to `''`, so
 * the export produced a structurally valid CSV with no data in it. The `data:
 * any` on `HistoryItem` is what let that compile.
 */
export function generateSpeedtestCsv(items: HistoryItem[]): string {
  const speedItems = items.filter((i) => i.type === 'speedtest');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Download Speed (Mbps)',
    'Upload Speed (Mbps)',
    'Idle Latency (ms)',
    'Jitter (ms)',
    'Loaded Latency (ms)',
    'Bufferbloat Grade',
    'Downloaded (MB)',
    'Uploaded (MB)',
    'Test Server',
    'Not Measured',
  ];

  const rows = speedItems.map((item) => {
    const d = (item.data ?? {}) as Partial<SpeedTestResult>;
    return [
      escapeCsv(item.id),
      escapeCsv(item.timestamp),
      escapeCsv(new Date(item.timestamp).toLocaleString()),
      escapeCsv(d.downloadSpeed ?? ''),
      escapeCsv(d.uploadSpeed ?? ''),
      escapeCsv(d.ping ?? ''),
      escapeCsv(d.jitter ?? ''),
      escapeCsv(d.loadedPing ?? ''),
      escapeCsv(d.bufferbloatScore ?? ''),
      escapeCsv(d.totalBytesDownloaded ?? ''),
      escapeCsv(d.totalBytesUploaded ?? ''),
      escapeCsv(d.serverName ?? ''),
      escapeCsv((d.failures ?? []).map((f) => `${f.metric}: ${f.detail}`).join(' | ')),
    ];
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Generate Ping CSV
export function generatePingCsv(items: HistoryItem[]): string {
  const pingItems = items.filter((i) => i.type === 'ping');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Target Host',
    'Packets Sent',
    'Packets Received',
    'Packet Loss (%)',
    'Min RTT (ms)',
    'Max RTT (ms)',
    'Avg RTT (ms)',
    'Jitter (ms)',
  ];

  // These read `sent`/`received`/`lossPercent`/`minRttMs`/`maxRttMs`/`avgRttMs`/
  // `jitterMs`; `PingResult` stores `packetsSent`/`packetsReceived`/`packetLoss`/
  // `minPing`/`maxPing`/`avgPing`/`jitter`. Every column exported blank.
  const rows = pingItems.map((item) => {
    const d = (item.data ?? {}) as Partial<PingResult>;
    return [
      escapeCsv(item.id),
      escapeCsv(item.timestamp),
      escapeCsv(new Date(item.timestamp).toLocaleString()),
      escapeCsv(d.target || item.title),
      escapeCsv(d.packetsSent ?? ''),
      escapeCsv(d.packetsReceived ?? ''),
      escapeCsv(d.packetLoss ?? ''),
      escapeCsv(d.minPing ?? ''),
      escapeCsv(d.maxPing ?? ''),
      escapeCsv(d.avgPing ?? ''),
      escapeCsv(d.jitter ?? ''),
    ];
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Generate Port Scanner CSV
export function generatePortScannerCsv(items: HistoryItem[]): string {
  const scannerItems = items.filter((i) => i.type === 'portscanner');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Scan Target',
    'Host',
    'Port Number',
    'Service Name',
    'Port Status',
    'Response Time (ms)',
  ];

  const rows: string[][] = [];

  scannerItems.forEach((item) => {
    // `d.target` does not exist on PortScanResult; the field is `targetHost`.
    const d = (item.data ?? {}) as Partial<PortScanResult>;
    const dateStr = new Date(item.timestamp).toLocaleString();

    if (Array.isArray(d.ports) && d.ports.length > 0) {
      d.ports.forEach((p) => {
        rows.push([
          escapeCsv(item.id),
          escapeCsv(item.timestamp),
          escapeCsv(dateStr),
          escapeCsv(d.targetHost || item.title),
          escapeCsv(p.host),
          escapeCsv(p.port),
          escapeCsv(p.service || ''),
          escapeCsv(p.status || ''),
          escapeCsv(p.latencyMs ?? ''),
        ]);
      });
    } else {
      rows.push([
        escapeCsv(item.id),
        escapeCsv(item.timestamp),
        escapeCsv(dateStr),
        escapeCsv(d.targetHost || item.title),
        escapeCsv(''),
        escapeCsv(''),
        escapeCsv(''),
        escapeCsv(''),
        escapeCsv(''),
      ]);
    }
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Generate DNS Query CSV
export function generateDnsCsv(items: HistoryItem[]): string {
  const dnsItems = items.filter((i) => i.type === 'dns');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Domain Query',
    'Record Type',
    'DoH Provider',
    'Query Time (ms)',
    'Resolved Data Record',
    'TTL (s)',
  ];

  const rows: string[][] = [];

  dnsItems.forEach((item) => {
    // `queryTimeMs` and `r.ttl` do not exist; the fields are `responseTimeMs`
    // and `TTL` (capitalised, as DoH JSON returns it).
    const d = (item.data ?? {}) as Partial<DnsQueryResult>;
    const dateStr = new Date(item.timestamp).toLocaleString();

    if (Array.isArray(d.records) && d.records.length > 0) {
      d.records.forEach((r) => {
        rows.push([
          escapeCsv(item.id),
          escapeCsv(item.timestamp),
          escapeCsv(dateStr),
          escapeCsv(d.domain || item.title),
          escapeCsv(d.recordType || 'A'),
          escapeCsv(d.provider || 'Cloudflare'),
          escapeCsv(d.responseTimeMs ?? ''),
          escapeCsv(r.data ?? ''),
          escapeCsv(r.TTL ?? ''),
        ]);
      });
    } else {
      rows.push([
        escapeCsv(item.id),
        escapeCsv(item.timestamp),
        escapeCsv(dateStr),
        escapeCsv(d.domain || item.title),
        escapeCsv(d.recordType || 'A'),
        escapeCsv(d.provider || 'Cloudflare'),
        escapeCsv(d.responseTimeMs ?? ''),
        escapeCsv('No records'),
        escapeCsv(''),
      ]);
    }
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * GeoIP CSV.
 *
 * GeoIP records have always been saved to history, but `geoip` was missing from
 * `TEST_TYPES`, so they could never be exported, never appeared in the ZIP, and
 * were absent from the manifest.
 */
export function generateGeoIpCsv(items: HistoryItem[]): string {
  const geoItems = items.filter((i) => i.type === 'geoip');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Query',
    'Resolved IP',
    'City',
    'Region',
    'Country',
    'Country Code',
    'Latitude',
    'Longitude',
    'Timezone',
    'ISP',
    'Organisation',
    'ASN',
    'Proxy Detected',
    'VPN Detected',
  ];

  const rows = geoItems.map((item) => {
    const d = (item.data ?? {}) as Partial<GeoIpResult>;
    return [
      escapeCsv(item.id),
      escapeCsv(item.timestamp),
      escapeCsv(new Date(item.timestamp).toLocaleString()),
      escapeCsv(d.query ?? ''),
      escapeCsv(d.ip ?? ''),
      escapeCsv(d.city ?? ''),
      escapeCsv(d.region ?? ''),
      escapeCsv(d.country ?? ''),
      escapeCsv(d.countryCode ?? ''),
      escapeCsv(d.lat ?? ''),
      escapeCsv(d.lng ?? ''),
      escapeCsv(d.timezone ?? ''),
      escapeCsv(d.isp ?? ''),
      escapeCsv(d.org ?? ''),
      escapeCsv(d.asn ?? ''),
      escapeCsv(d.isProxy ?? ''),
      escapeCsv(d.isVpn ?? ''),
    ];
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Generate Generic CSV for other test types
export function generateGenericCsv(items: HistoryItem[], type: string): string {
  const filtered = items.filter((i) => i.type === type);
  const headers = ['Test ID', 'Timestamp', 'Date', 'Type', 'Title', 'Summary', 'Raw JSON Data'];

  const rows = filtered.map((item) => [
    escapeCsv(item.id),
    escapeCsv(item.timestamp),
    escapeCsv(new Date(item.timestamp).toLocaleString()),
    escapeCsv(item.type),
    escapeCsv(item.title),
    escapeCsv(item.summary),
    escapeCsv(JSON.stringify(item.data || {})),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// Get CSV content for a specific test type
export function getCsvForType(items: HistoryItem[], type: string): string {
  switch (type) {
    case 'tracert':
      return generateTracertCsv(items);
    case 'speedtest':
      return generateSpeedtestCsv(items);
    case 'ping':
      return generatePingCsv(items);
    case 'portscanner':
      return generatePortScannerCsv(items);
    case 'dns':
      return generateDnsCsv(items);
    case 'geoip':
      return generateGeoIpCsv(items);
    default:
      return generateGenericCsv(items, type);
  }
}

// Export single test type CSV
export function exportSingleCsv(items: HistoryItem[], type: string, filename: string) {
  triggerDownload(getCsvForType(items, type), filename, 'text/csv;charset=utf-8;');
}

// Generate and trigger download for BUNDLED ZIP
export async function exportBundledZip(
  items: HistoryItem[],
  selectedTypes?: string[],
  customZipFilename?: string
): Promise<void> {
  const zip = new JSZip();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const zipName = customZipFilename || `netready_diagnostic_bundle_${dateStamp}.zip`;

  const activeItems = items.filter((item) => {
    if (!selectedTypes || selectedTypes.length === 0) return true;
    return selectedTypes.includes(item.type);
  });

  // 1. Create a folder for CSV Reports
  const csvFolder = zip.folder('csv_reports');

  // Add individual CSV files for each test type
  TEST_TYPES.forEach((testMeta) => {
    if (!selectedTypes || selectedTypes.includes(testMeta.id)) {
      const typeItems = activeItems.filter((i) => i.type === testMeta.id);
      if (typeItems.length > 0) {
        const csvText = getCsvForType(activeItems, testMeta.id);
        csvFolder?.file(testMeta.filename, csvText);
      }
    }
  });

  // 2. Add Master Summary CSV
  const masterCsv = generateMasterSummaryCsv(activeItems);
  zip.file(`netready_master_summary_${dateStamp}.csv`, masterCsv);

  // 3. Add Raw JSON Data
  zip.file(`netready_raw_history_${dateStamp}.json`, JSON.stringify(activeItems, null, 2));

  // 4. Add Manifest TXT File
  const manifestText = `=====================================================
NetReady Network Diagnostic Tool - Export Manifest
Export Date: ${new Date().toLocaleString()}
Total Exported Records: ${activeItems.length}
=====================================================

Included Test Types Breakdown:
${TEST_TYPES.map((t) => {
  const count = activeItems.filter((i) => i.type === t.id).length;
  return ` - ${t.label}: ${count} record(s) -> csv_reports/${t.filename}`;
}).join('\n')}

System Notes:
- CSV files can be imported into Microsoft Excel, Google Sheets, or Pandas.
- Raw JSON contains complete nested diagnostic metrics including WebRTC ICE candidates, DNS TTLs, and traceroute hop latencies.
=====================================================
Generated by NetReady Network Suite
`;

  zip.file('MANIFEST.txt', manifestText);

  // Generate ZIP blob and download
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, zipName, 'application/zip');
}
