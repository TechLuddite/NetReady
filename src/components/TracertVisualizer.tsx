import React, { useState } from 'react';
import {
  GitCommit,
  Play,
  RefreshCw,
  Copy,
  Check,
  Globe,
  Radio,
  Zap,
  ShieldCheck,
  AlertCircle,
  Terminal,
  Activity,
  MapPin,
  ListFilter,
  BarChart2,
  Share2,
  AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { TracertHop, TracertResult, HistoryItem } from '../types';
import { TRACERT_PRESETS, executeTraceroute } from '../utils/tracert';
import { TracertMap } from './TracertMap';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface TracertVisualizerProps {
  onHistoryUpdate: () => void;
}

export const TracertVisualizer: React.FC<TracertVisualizerProps> = ({ onHistoryUpdate }) => {
  const [selectedPreset, setSelectedPreset] = useState<string>(TRACERT_PRESETS[0].target);
  const [customTarget, setCustomTarget] = useState<string>('');
  const [protocol, setProtocol] = useState<'ICMP' | 'UDP' | 'TCP'>('ICMP');
  const [maxHops, setMaxHops] = useState<number>(20);

  const [isTracing, setIsTracing] = useState(false);
  const [hops, setHops] = useState<TracertHop[]>([]);
  const [activeHopNum, setActiveHopNum] = useState<number | null>(null);
  const [result, setResult] = useState<TracertResult | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  const [copiedTerminal, setCopiedTerminal] = useState(false);

  const getActiveTarget = () => {
    if (customTarget.trim()) return customTarget.trim();
    return selectedPreset;
  };

  const executeTrace = async () => {
    const target = getActiveTarget();
    if (!target) return;

    setIsTracing(true);
    setHops([]);
    setActiveHopNum(null);
    setResult(null);

    try {
      const res = await executeTraceroute(
        target,
        protocol,
        maxHops,
        (discoveredHop, currentHops) => {
          setHops(currentHops);
          setActiveHopNum(discoveredHop.hop);
        }
      );

      setResult(res);

      // Save result to LocalStorage history
      const historyItem: HistoryItem = {
        id: res.id,
        type: 'tracert',
        timestamp: res.timestamp,
        title: `Traceroute: ${res.targetHost} (${res.totalHops} hops)`,
        summary: `Target IP: ${res.targetIp} | Dist: ${res.totalDistanceKm} km | Avg RTT: ${res.avgLatencyMs} ms`,
        data: res,
      };

      saveHistoryItem(historyItem);
      onHistoryUpdate();
    } catch (err) {
      console.error('Traceroute error:', err);
    } finally {
      setIsTracing(false);
    }
  };

  const handleStartTrace = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeTrace();
  };

  // Build standard CLI traceroute text format for copy/export
  const getCliText = () => {
    const target = getActiveTarget();
    let text = `Tracing route to ${target} [${result?.targetIp || '...'}] over a maximum of ${maxHops} hops:\n\n`;

    hops.forEach((h) => {
      if (h.status === 'timeout') {
        text += `  ${h.hop.toString().padStart(2, ' ')}     *        *        *     Request timed out.\n`;
      } else {
        const r1 = `${h.rtt1} ms`.padStart(7, ' ');
        const r2 = `${h.rtt2} ms`.padStart(7, ' ');
        const r3 = `${h.rtt3} ms`.padStart(7, ' ');
        text += `  ${h.hop.toString().padStart(2, ' ')}  ${r1}  ${r2}  ${r3}  ${h.hostname || h.ip} [${h.ip}] (${h.city}, ${h.country})\n`;
      }
    });

    if (result) {
      text += `\nTrace complete. Total hops: ${result.totalHops}, Total distance: ${result.totalDistanceKm} km.\n`;
    }

    return text;
  };

  const handleCopyTerminal = () => {
    navigator.clipboard.writeText(getCliText());
    setCopiedTerminal(true);
    setTimeout(() => setCopiedTerminal(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <GitCommit className="w-5 h-5 text-cyan-400 rotate-90" />
            <h1 className="text-xl font-bold text-slate-100">
              Traceroute (TRACERT) Route Inspector
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full uppercase">
              Interactive Hop Map
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Trace packet network routes across intermediate routers and Autonomous Systems. Follow every hop step-by-step on a live map with microsecond latency analysis.
          </p>
        </div>

        <button
          onClick={handleStartTrace}
          disabled={isTracing}
          className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {isTracing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              <span>Tracing Hop {hops.length}...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Run Route Traceroute</span>
            </>
          )}
        </button>
      </div>

      {/* Target & Protocol Controls Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Target Endpoint & Preset Selection
        </h2>

        {/* Preset Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRACERT_PRESETS.map((p) => {
            const isSelected = selectedPreset === p.target && !customTarget;
            return (
              <button
                key={p.target}
                onClick={() => {
                  setSelectedPreset(p.target);
                  setCustomTarget('');
                }}
                className={`p-3 rounded-xl text-xs font-medium text-left transition-all border ${
                  isSelected
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 shadow-sm'
                    : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                }`}
              >
                <div className="flex items-center space-x-1.5 font-semibold">
                  <span>{p.flag}</span>
                  <span className="truncate">{p.name}</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.region}</div>
              </button>
            );
          })}
        </div>

        {/* Custom Input & Protocol Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-2 border-t border-white/5">
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-1 font-mono">
              Or Custom Hostname / Target IP:
            </label>
            <input
              type="text"
              placeholder="e.g. google.com or 8.8.8.8 or aws.amazon.com"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1 font-mono">Protocol:</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="ICMP">ICMP Echo Request</option>
              <option value="UDP">UDP Probe (Port 33434)</option>
              <option value="TCP">TCP SYN Probe (Port 80/443)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1 font-mono">Max Hop Limit:</label>
            <select
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value={15}>15 Hops</option>
              <option value={20}>20 Hops</option>
              <option value={30}>30 Hops</option>
            </select>
          </div>
        </div>
      </div>

      {/* Primary Map Visualizer Section ("Map section that follows each hop") */}
      <TracertMap
        hops={hops}
        activeHopNumber={activeHopNum}
        onSelectHop={(hopNum) => setActiveHopNum(hopNum)}
        isTracing={isTracing}
      />

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Target Host</div>
          <div className="text-sm font-bold font-mono text-cyan-400 truncate">
            {getActiveTarget()}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Total Hops</div>
          <div className="text-2xl font-bold font-mono text-white">
            {hops.length > 0 ? hops.length : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Total Distance</div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {result ? `${result.totalDistanceKm} km` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Avg Route RTT</div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            {result ? `${result.avgLatencyMs} ms` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center col-span-2 lg:col-span-1">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">End-to-End Latency</div>
          <div className="text-2xl font-bold font-mono text-purple-400">
            {hops.length > 0 && hops[hops.length - 1].avgRtt > 0
              ? `${hops[hops.length - 1].avgRtt} ms`
              : '--'}
          </div>
        </div>
      </div>

      {/* Latency Progression Elevation Area Chart */}
      {hops.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-4 flex items-center space-x-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>Route Latency Progression (ms per hop)</span>
          </h2>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hops}>
                <defs>
                  <linearGradient id="colorRtt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hop" stroke="#64748b" tick={{ fontSize: 11 }} label={{ value: 'Hop #', position: 'insideBottomRight', offset: -5 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} label={{ value: 'RTT (ms)', angle: -90, position: 'insideLeft' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px', color: '#38bdf8' }}
                />
                <Area
                  type="monotone"
                  dataKey="avgRtt"
                  name="Avg Latency (ms)"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRtt)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Terminal View & Hop Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hop Logs Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
              <ListFilter className="w-4 h-4 text-cyan-400" />
              <span>Hop Trace Sequence ({hops.length} Discovered)</span>
            </h2>

            <span className="text-xs text-slate-500 font-mono">
              Click any row to focus on map
            </span>
          </div>

          {hops.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs font-mono">
              No hops recorded yet. Click "Run Route Traceroute" to begin packet tracing!
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase font-mono">
                  <th className="pb-3 px-3">Hop</th>
                  <th className="pb-3 px-3">Node / Hostname</th>
                  <th className="pb-3 px-3">IP Address</th>
                  <th className="pb-3 px-3">RTT Avg</th>
                  <th className="pb-3 px-3">Location</th>
                  <th className="pb-3 px-3">ISP / ASN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                {hops.map((h) => {
                  const isSelected = h.hop === activeHopNum;
                  return (
                    <tr
                      key={h.hop}
                      onClick={() => setActiveHopNum(h.hop)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-cyan-500/15 text-cyan-200 border-l-4 border-l-cyan-400 font-semibold'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <span className="w-6 h-6 rounded-full bg-slate-800 text-cyan-400 border border-slate-700 flex items-center justify-center font-bold text-[10px]">
                          {h.hop}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 max-w-[180px] truncate">
                        <div className="font-bold text-slate-200 truncate">{h.hostname || h.ip}</div>
                        <div className="text-[10px] text-slate-500 uppercase">{h.nodeType}</div>
                      </td>

                      <td className="py-2.5 px-3 text-slate-300">{h.ip}</td>

                      <td className="py-2.5 px-3">
                        {h.status === 'timeout' ? (
                          <span className="text-rose-400 font-bold">* * *</span>
                        ) : (
                          <span className={h.avgRtt > 120 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                            {h.avgRtt} ms
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-slate-400 text-[11px] truncate max-w-[140px]">
                        📍 {h.city}, {h.countryCode}
                      </td>

                      <td className="py-2.5 px-3 text-slate-400 text-[11px] truncate max-w-[140px]">
                        {h.isp} ({h.asn})
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Terminal Output Stream */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  CLI Terminal Stream
                </h2>
              </div>

              <button
                onClick={handleCopyTerminal}
                disabled={hops.length === 0}
                className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-mono transition-colors disabled:opacity-40"
              >
                {copiedTerminal ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-[380px] leading-relaxed shadow-inner">
              <pre>{getCliText()}</pre>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex items-center justify-between">
            <span>NetReady TRACERT Engine</span>
            <span className="text-cyan-400">Ready</span>
          </div>
        </div>
      </div>

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executeTrace();
        }}
      />
    </div>
  );
};
