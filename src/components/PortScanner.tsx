import React, { useState } from 'react';
import {
  Radar,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Wifi,
  Server,
  Layers,
  Cpu,
  Search,
  Filter,
  AlertTriangle,
  ExternalLink,
  Globe,
  Activity,
} from 'lucide-react';
import { PortScanResult, PortStatus, HistoryItem } from '../types';
import { scanPortList, COMMON_PORTS, gatherWebRtcCandidates } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface PortScannerProps {
  onHistoryUpdate: () => void;
}

const PORT_PRESETS = [
  {
    name: 'Web & Development',
    ports: [80, 443, 3000, 5000, 8000, 8080, 8443],
  },
  {
    name: 'Top 15 Common Ports',
    ports: [21, 22, 23, 25, 53, 80, 110, 143, 443, 3000, 3306, 3389, 5432, 8080, 27017],
  },
  {
    name: 'Databases & In-Memory',
    ports: [1433, 1521, 3306, 5432, 6379, 9200, 27017],
  },
  {
    name: 'Remote Admin & Mail',
    ports: [21, 22, 23, 25, 110, 143, 465, 587, 993, 995, 3389, 5900],
  },
];

export const PortScanner: React.FC<PortScannerProps> = ({ onHistoryUpdate }) => {
  const [targetHost, setTargetHost] = useState('127.0.0.1');
  const [selectedPreset, setSelectedPreset] = useState<string>('Web & Development');
  const [customPortInput, setCustomPortInput] = useState('80, 443, 3000-3005, 8080');
  const [portSelectionMode, setPortSelectionMode] = useState<'preset' | 'custom'>('preset');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    scanned: number;
    total: number;
    currentPort?: number;
    currentHost?: string;
  }>({
    scanned: 0,
    total: 0,
  });
  const [activeResult, setActiveResult] = useState<PortScanResult | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'closed' | 'filtered'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [detectingSubnet, setDetectingSubnet] = useState(false);
  const [detectedSubnetInfo, setDetectedSubnetInfo] = useState<string | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  // Helper to parse comma separated ports or ranges e.g. "80, 443, 3000-3010"
  const parsePortsToScan = (): number[] => {
    if (portSelectionMode === 'preset') {
      const p = PORT_PRESETS.find((item) => item.name === selectedPreset);
      return p ? p.ports : [80, 443, 3000, 8080];
    }

    const portsSet = new Set<number>();
    const rawParts = customPortInput.split(',');

    for (const raw of rawParts) {
      const part = raw.trim();
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end) && start > 0 && end <= 65535 && start <= end) {
          const count = Math.min(100, end - start + 1);
          for (let i = 0; i < count; i++) {
            portsSet.add(start + i);
          }
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num > 0 && num <= 65535) {
          portsSet.add(num);
        }
      }
    }

    const list = Array.from(portsSet).sort((a, b) => a - b);
    return list.length > 0 ? list : [80, 443, 3000, 8080];
  };

  const handleAutoDetectSubnet = async () => {
    setDetectingSubnet(true);
    setDetectedSubnetInfo(null);
    try {
      const rtc = await gatherWebRtcCandidates();
      const localIp = rtc.localIps[0] || '192.168.1.50';
      const ipParts = localIp.split('.');
      if (ipParts.length === 4) {
        const subnet = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.0/24`;
        const gateway = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.1`;
        setTargetHost(subnet);
        setDetectedSubnetInfo(`Detected Interface: ${localIp} (Set Subnet Target: ${subnet}, Gateway: ${gateway})`);
      } else {
        setTargetHost('127.0.0.1');
        setDetectedSubnetInfo('Local interface fallback: 127.0.0.1 (Loopback)');
      }
    } catch (e) {
      setDetectedSubnetInfo('Local interface fallback: 127.0.0.1');
    } finally {
      setDetectingSubnet(false);
    }
  };

  const executeScan = async () => {
    const portsToScan = parsePortsToScan();
    if (!targetHost.trim() || portsToScan.length === 0) return;

    setIsScanning(true);
    setActiveResult(null);
    setScanProgress({ scanned: 0, total: 100 });

    try {
      const res = await scanPortList(targetHost, portsToScan, (scanned, total, last) => {
        setScanProgress({
          scanned,
          total,
          currentPort: last.port,
          currentHost: last.host,
        });
      });

      setActiveResult(res);

      // Save to LocalStorage
      const historyItem: HistoryItem = {
        id: res.id,
        type: 'portscanner',
        timestamp: res.timestamp,
        title: `Port Scan: ${res.targetHost}`,
        summary: `Hosts: ${res.scannedHosts.length} | Open Ports: ${res.openPortsCount} | Closed: ${res.closedPortsCount} | Filtered: ${res.filteredPortsCount} (${res.scanDurationMs}ms)`,
        data: res,
      };

      saveHistoryItem(historyItem);
      onHistoryUpdate();
    } catch (e) {
      console.error('Port scan error:', e);
    } finally {
      setIsScanning(false);
    }
  };

  const handleStartScan = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeScan();
  };

  const filteredPorts = activeResult
    ? activeResult.ports.filter((p) => {
        const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
        const matchesSearch =
          p.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.port.toString().includes(searchTerm) ||
          (p.service && p.service.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesStatus && matchesSearch;
      })
    : [];

  // Group active open hosts for Discovered Devices card
  const openDevicesMap: Record<string, PortStatus[]> = activeResult
    ? activeResult.ports
        .filter((p) => p.status === 'open')
        .reduce<Record<string, PortStatus[]>>((acc, curr) => {
          if (!acc[curr.host]) {
            acc[curr.host] = [];
          }
          acc[curr.host].push(curr);
          return acc;
        }, {})
    : {};

  const openDevicesList: [string, PortStatus[]][] = Object.entries(openDevicesMap);

  return (
    <div className="space-y-6">
      {/* Header Banner - Immersive Dark Theme */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center space-x-2.5 mb-1.5">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
              <Radar className="w-5 h-5 animate-pulse" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              TCP Socket & Subnet Port Scanner
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Client-Side Browser Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-xl leading-relaxed">
            Scan host IPs, local dev servers, or entire CIDR subnets (e.g. <code className="text-cyan-300 font-mono">192.168.1.0/24</code>) for open TCP/Web services directly within your browser, complete with host IP identification and direct HTTP/HTTPS hyperlinks.
          </p>
        </div>

        <button
          onClick={handleStartScan}
          disabled={isScanning}
          className="relative z-10 flex items-center space-x-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(8,145,178,0.3)] active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {isScanning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Scanning Subnet / Ports...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Launch Scan</span>
            </>
          )}
        </button>
      </div>

      {/* Target & Port Selection Form */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
        {/* Responsible Networking Notice Banner */}
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span>
              <strong className="text-amber-300">Responsible Networking Notice:</strong> Only scan hosts, local dev servers, and subnets for which you hold explicit authorization.
            </span>
          </div>
          <button
            onClick={() => setShowResponsibleModal(true)}
            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-lg text-[11px] font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
          >
            Review Authorization Policy
          </button>
        </div>

        {/* Target Host Section */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
              <Server className="w-4 h-4 text-cyan-400" />
              <span>Target Host, Subnet CIDR, or IP Range</span>
            </label>

            <button
              onClick={handleAutoDetectSubnet}
              disabled={detectingSubnet || isScanning}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 transition-colors w-fit cursor-pointer"
            >
              {detectingSubnet ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              <span>Auto-Detect Local Subnet / IP</span>
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="e.g. 192.168.1.0/24, 10.0.0.1-20, 127.0.0.1, or scanme.nmap.org"
              value={targetHost}
              onChange={(e) => setTargetHost(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 shadow-inner"
            />
          </div>

          {detectedSubnetInfo && (
            <div className="p-3 bg-cyan-950/30 border border-cyan-500/20 rounded-xl text-xs font-mono text-cyan-300">
              {detectedSubnetInfo}
            </div>
          )}

          {/* Quick Preset Host Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Presets:</span>
            {[
              { label: 'Localhost (127.0.0.1)', value: '127.0.0.1' },
              { label: 'Subnet (192.168.1.0/24)', value: '192.168.1.0/24' },
              { label: 'Range (192.168.1.1-20)', value: '192.168.1.1-20' },
              { label: 'Gateway (192.168.1.1)', value: '192.168.1.1' },
              { label: 'Public Test (scanme.nmap.org)', value: 'scanme.nmap.org' },
            ].map((p) => (
              <button
                key={p.value}
                onClick={() => setTargetHost(p.value)}
                className="px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-lg text-xs font-mono text-slate-300 transition-colors cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-white/5 pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Select Ports to Probe</span>
            </label>

            <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-xl border border-white/10 text-xs font-mono">
              <button
                onClick={() => setPortSelectionMode('preset')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  portSelectionMode === 'preset'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Category Presets
              </button>
              <button
                onClick={() => setPortSelectionMode('custom')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  portSelectionMode === 'custom'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom Ports / Ranges
              </button>
            </div>
          </div>

          {portSelectionMode === 'preset' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {PORT_PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.name;
                return (
                  <div
                    key={preset.name}
                    onClick={() => setSelectedPreset(preset.name)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500 text-white shadow-lg shadow-cyan-500/10'
                        : 'bg-slate-950 border-white/5 hover:border-white/20 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold mb-1">{preset.name}</div>
                    <div className="text-[11px] font-mono text-slate-400 break-all">
                      Ports ({preset.ports.length}): {preset.ports.join(', ')}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={customPortInput}
                onChange={(e) => setCustomPortInput(e.target.value)}
                placeholder="e.g. 80, 443, 3000-3010, 8080"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 font-mono">
                Enter comma-separated ports or range pairs (e.g., <code className="text-cyan-400">80, 443, 3000-3010</code>).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Live Scan Progress Bar */}
      {isScanning && (
        <div className="bg-white/[0.03] border border-cyan-500/30 rounded-2xl p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-cyan-300 font-bold flex items-center space-x-2">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              <span>Scanning target: {scanProgress.currentHost || targetHost}...</span>
            </span>
            <span className="text-slate-300">
              Probing port: <strong className="text-white">#{scanProgress.currentPort || '---'}</strong> (
              {scanProgress.scanned} / {scanProgress.total})
            </span>
          </div>

          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
              style={{
                width: `${scanProgress.total > 0 ? (scanProgress.scanned / scanProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Results View */}
      {activeResult && (
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
          {/* Summary Metric Header */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between border-b border-white/5 pb-6 gap-6">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">
                  Scan Execution Complete
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Client-Side Browser Engine
                </span>
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                Target: {activeResult.targetHost}
              </div>
              <div className="text-xs text-slate-400 font-mono mt-1">
                Scanned {activeResult.scannedHosts.length} host IP(s) across {activeResult.scannedPorts.length} port(s) in {activeResult.scanDurationMs} ms &bull; {new Date(activeResult.timestamp).toLocaleString()}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-center w-full lg:w-auto">
              <div className="bg-cyan-500/10 border border-cyan-500/30 px-4 py-3 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-cyan-400">Active Devices</div>
                <div className="text-2xl font-bold text-cyan-300">{activeResult.discoveredHostsCount}</div>
              </div>

              <div className="bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-emerald-400">Open Ports</div>
                <div className="text-2xl font-bold text-emerald-300">{activeResult.openPortsCount}</div>
              </div>

              <div className="bg-slate-800/60 border border-slate-700/60 px-4 py-3 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-slate-400">Closed Ports</div>
                <div className="text-2xl font-bold text-slate-300">{activeResult.closedPortsCount}</div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 px-4 py-3 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-amber-400">Filtered Ports</div>
                <div className="text-2xl font-bold text-amber-300">{activeResult.filteredPortsCount}</div>
              </div>
            </div>
          </div>

          {/* Discovered Subnet Devices Summary Card */}
          {openDevicesList.length > 0 && (
            <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>Discovered Devices on Network ({openDevicesList.length} active hosts found)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {openDevicesList.map(([hostIp, openPorts]) => (
                  <div key={hostIp} className="p-3 bg-slate-950 border border-white/10 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-white flex items-center space-x-1.5">
                        <Server className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{hostIp}</span>
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded">
                        {openPorts.length} Open Service(s)
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {openPorts.map((p) => {
                        const webUrl = `${p.protocol || (p.port === 443 || p.port === 8443 ? 'https' : 'http')}://${p.host}:${p.port}`;
                        if (p.isWeb) {
                          return (
                            <a
                              key={p.port}
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded text-[10px] font-mono transition-colors"
                              title={`Open ${webUrl} in new tab`}
                            >
                              <Globe className="w-3 h-3 text-cyan-400" />
                              <span>#{p.port} ({p.service})</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          );
                        }
                        return (
                          <span
                            key={p.port}
                            className="px-2 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded text-[10px] font-mono"
                          >
                            #{p.port} ({p.service})
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-white/10 text-xs font-mono w-full sm:w-auto">
              {(['all', 'open', 'closed', 'filtered'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1.5 rounded-lg uppercase transition-all font-semibold cursor-pointer ${
                    filterStatus === status
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status} ({status === 'all' ? activeResult.ports.length : activeResult.ports.filter((p) => p.status === status).length})
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search IP, port, or service..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Port Results Table */}
          <div className="overflow-x-auto border border-white/5 rounded-xl bg-slate-950">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-white/[0.02] border-b border-white/5 text-slate-400">
                <tr>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Target IP / Host</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Port</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Status</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Service Name</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Latency RTT</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Web Service Link</th>
                  <th className="py-3 px-4 uppercase text-[10px] tracking-wider font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {filteredPorts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No port scan records match the selected filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredPorts.map((p) => {
                    const webUrl = `${p.protocol || (p.port === 443 || p.port === 8443 ? 'https' : 'http')}://${p.host}:${p.port}`;
                    const showWebLink = p.isWeb && p.status === 'open';

                    return (
                      <tr key={`${p.host}-${p.port}`} className="hover:bg-white/[0.02] transition-colors">
                        {/* Target Host IP Column */}
                        <td className="py-3 px-4 font-mono font-bold text-cyan-400">
                          {showWebLink ? (
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1.5 text-cyan-400 hover:text-cyan-300 hover:underline"
                              title={`Launch ${webUrl}`}
                            >
                              <span>{p.host}</span>
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                            </a>
                          ) : (
                            <span>{p.host}</span>
                          )}
                        </td>

                        {/* Port Number Column */}
                        <td className="py-3 px-4 font-bold text-white">#{p.port}</td>

                        {/* Status Column */}
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${
                              p.status === 'open'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : p.status === 'closed'
                                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>

                        {/* Service Name Column */}
                        <td className="py-3 px-4 text-cyan-300 font-semibold">{p.service || 'Unknown'}</td>

                        {/* Latency RTT Column */}
                        <td className="py-3 px-4 text-slate-300">{p.latencyMs} ms</td>

                        {/* Hyperlink Column for HTTP/HTTPS scan results */}
                        <td className="py-3 px-4">
                          {p.isWeb ? (
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm ${
                                p.status === 'open'
                                  ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                                  : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border border-slate-700/60'
                              }`}
                            >
                              <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span>{p.protocol?.toUpperCase() || 'HTTP'} Link</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-slate-600 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Description Column */}
                        <td className="py-3 px-4 text-slate-400">{p.description}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Responsible Networking Pop-out Warning Modal */}
      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executeScan();
        }}
      />
    </div>
  );
};
