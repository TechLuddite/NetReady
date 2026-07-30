import JSZip from 'jszip';
import { HistoryItem } from '../types';

export const TEST_TYPES = [
  { id: 'tracert', label: 'Traceroute (TRACERT)', filename: 'tracert_results.csv', icon: 'GitCommit' },
  { id: 'speedtest', label: 'Speed Test Results', filename: 'speedtest_results.csv', icon: 'Gauge' },
  { id: 'ping', label: 'Ping & Latency Tests', filename: 'ping_results.csv', icon: 'Radio' },
  { id: 'portscanner', label: 'Port Scanner Results', filename: 'portscanner_results.csv', icon: 'Radar' },
  { id: 'dns', label: 'DNS Queries', filename: 'dns_results.csv', icon: 'Globe' },
  { id: 'webrtc', label: 'WebRTC & ICE Analysis', filename: 'webrtc_results.csv', icon: 'ShieldCheck' },
  { id: 'httpprobe', label: 'HTTP Probes', filename: 'httpprobe_results.csv', icon: 'Zap' },
  { id: 'websocket', label: 'WebSocket Latency', filename: 'websocket_results.csv', icon: 'Activity' },
  { id: 'cidr', label: 'CIDR Subnet Calculations', filename: 'cidr_results.csv', icon: 'Calculator' },
  { id: 'mac', label: 'MAC Vendor Lookups', filename: 'mac_results.csv', icon: 'Search' },
] as const;

export type TestTypeId = typeof TEST_TYPES[number]['id'];

// Helper to escape CSV strings
const escapeCsv = (val: any): string => {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
};

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

// Generate SpeedTest CSV
export function generateSpeedtestCsv(items: HistoryItem[]): string {
  const speedItems = items.filter((i) => i.type === 'speedtest');
  const headers = [
    'Test ID',
    'Timestamp',
    'Date',
    'Download Speed (Mbps)',
    'Upload Speed (Mbps)',
    'Ping Latency (ms)',
    'Jitter (ms)',
    'Client IP',
    'ISP Provider',
    'Location',
    'Test Server',
  ];

  const rows = speedItems.map((item) => {
    const d = item.data || {};
    return [
      escapeCsv(item.id),
      escapeCsv(item.timestamp),
      escapeCsv(new Date(item.timestamp).toLocaleString()),
      escapeCsv(d.downloadMbps ?? ''),
      escapeCsv(d.uploadMbps ?? ''),
      escapeCsv(d.pingMs ?? ''),
      escapeCsv(d.jitterMs ?? ''),
      escapeCsv(d.ip ?? ''),
      escapeCsv(d.isp ?? ''),
      escapeCsv(d.location ?? ''),
      escapeCsv(d.serverName ?? ''),
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

  const rows = pingItems.map((item) => {
    const d = item.data || {};
    return [
      escapeCsv(item.id),
      escapeCsv(item.timestamp),
      escapeCsv(new Date(item.timestamp).toLocaleString()),
      escapeCsv(d.target || item.title),
      escapeCsv(d.sent ?? ''),
      escapeCsv(d.received ?? ''),
      escapeCsv(d.lossPercent ?? ''),
      escapeCsv(d.minRttMs ?? ''),
      escapeCsv(d.maxRttMs ?? ''),
      escapeCsv(d.avgRttMs ?? ''),
      escapeCsv(d.jitterMs ?? ''),
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
    'Target IP / Host',
    'Port Number',
    'Service Name',
    'Port Status',
    'Response Time (ms)',
  ];

  const rows: string[][] = [];

  scannerItems.forEach((item) => {
    const d = item.data || {};
    const dateStr = new Date(item.timestamp).toLocaleString();

    if (Array.isArray(d.ports) && d.ports.length > 0) {
      d.ports.forEach((p: any) => {
        rows.push([
          escapeCsv(item.id),
          escapeCsv(item.timestamp),
          escapeCsv(dateStr),
          escapeCsv(d.target || item.title),
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
        escapeCsv(d.target || item.title),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
        escapeCsv('-'),
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
    const d = item.data || {};
    const dateStr = new Date(item.timestamp).toLocaleString();

    if (Array.isArray(d.records) && d.records.length > 0) {
      d.records.forEach((r: any) => {
        rows.push([
          escapeCsv(item.id),
          escapeCsv(item.timestamp),
          escapeCsv(dateStr),
          escapeCsv(d.domain || item.title),
          escapeCsv(d.recordType || 'A'),
          escapeCsv(d.provider || 'Cloudflare'),
          escapeCsv(d.queryTimeMs ?? ''),
          escapeCsv(r.data || r),
          escapeCsv(r.ttl ?? ''),
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
        escapeCsv(d.queryTimeMs ?? ''),
        escapeCsv('No records'),
        escapeCsv('-'),
      ]);
    }
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
    default:
      return generateGenericCsv(items, type);
  }
}

// Trigger browser download for single file
export function triggerDownload(content: string | Blob, filename: string, mimeType: string = 'text/csv;charset=utf-8;') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Export single test type CSV
export function exportSingleCsv(items: HistoryItem[], type: string, filename: string) {
  const csvContent = getCsvForType(items, type);
  triggerDownload(csvContent, filename);
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
