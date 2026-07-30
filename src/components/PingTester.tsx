import React, { useState } from 'react';
import { Radio, Play, StopCircle, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { PingResult, PingPoint, HistoryItem } from '../types';
import { PING_TARGET_PRESETS, executePingBatch } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface PingTesterProps {
  onHistoryUpdate: () => void;
}

export const PingTester: React.FC<PingTesterProps> = ({ onHistoryUpdate }) => {
  const [selectedTarget, setSelectedTarget] = useState(PING_TARGET_PRESETS[0].url);
  const [customTarget, setCustomTarget] = useState('');
  const [packetCount, setPacketCount] = useState<number>(15);
  const [isPinging, setIsPinging] = useState(false);
  const [points, setPoints] = useState<PingPoint[]>([]);
  const [result, setResult] = useState<PingResult | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  const getActiveUrlAndLabel = () => {
    if (customTarget.trim()) {
      let url = customTarget.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      return { url, label: 'Custom Host (' + url + ')' };
    }
    const found = PING_TARGET_PRESETS.find((p) => p.url === selectedTarget);
    return {
      url: selectedTarget,
      label: found ? found.label : selectedTarget,
    };
  };

  const executePing = async () => {
    setIsPinging(true);
    setPoints([]);
    setResult(null);

    const { url, label } = getActiveUrlAndLabel();

    try {
      const res = await executePingBatch(
        url,
        label,
        packetCount,
        (pt, currentPoints) => {
          setPoints(currentPoints);
        }
      );

      setResult(res);

      // Save to LocalStorage
      const item: HistoryItem = {
        id: res.id,
        type: 'ping',
        timestamp: res.timestamp,
        title: `Ping ${res.label}: Avg ${res.avgPing} ms`,
        summary: `Min: ${res.minPing}ms | Max: ${res.maxPing}ms | Jitter: ${res.jitter}ms | Loss: ${res.packetLoss}%`,
        data: res,
      };

      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('Ping batch failed:', e);
    } finally {
      setIsPinging(false);
    }
  };

  const handleStartPing = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executePing();
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Radio className="w-5 h-5 text-blue-400" />
            <h1 className="text-xl font-bold text-slate-100">
              Ping Latency & Jitter Monitor
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Measures round-trip response time, latency jitter variance, and packet loss using microsecond-precision HTTP HEAD probes.
          </p>
        </div>

        <button
          onClick={handleStartPing}
          disabled={isPinging}
          className="flex items-center space-x-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
        >
          {isPinging ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Pinging ({points.length}/{packetCount})...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Start Ping Sequence</span>
            </>
          )}
        </button>
      </div>

      {/* Target Selector Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Select Target Endpoint
        </h2>

        {/* Preset Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {PING_TARGET_PRESETS.map((preset) => {
            const isSelected = selectedTarget === preset.url && !customTarget;
            return (
              <button
                key={preset.url}
                onClick={() => {
                  setSelectedTarget(preset.url);
                  setCustomTarget('');
                }}
                className={`p-3 rounded-xl text-xs font-medium text-left transition-all border ${
                  isSelected
                    ? 'bg-blue-500/15 text-blue-300 border-blue-500/40 shadow-sm'
                    : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                }`}
              >
                <div className="font-semibold">{preset.name}</div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{preset.url}</div>
              </button>
            );
          })}
        </div>

        {/* Custom Target & Packet Count */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">
              Or Custom Host / Endpoint URL:
            </label>
            <input
              type="text"
              placeholder="e.g. https://api.github.com or my-router.local"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Packet Sequence Count:
            </label>
            <select
              value={packetCount}
              onChange={(e) => setPacketCount(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value={10}>10 Packets</option>
              <option value={20}>20 Packets</option>
              <option value={50}>50 Packets</option>
            </select>
          </div>
        </div>
      </div>

      {/* Ping Metrics Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Min Ping</div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {result ? `${result.minPing} ms` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Avg Ping</div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            {result ? `${result.avgPing} ms` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Max Ping</div>
          <div className="text-2xl font-bold font-mono text-rose-400">
            {result ? `${result.maxPing} ms` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Jitter Variance</div>
          <div className="text-2xl font-bold font-mono text-purple-400">
            {result ? `${result.jitter} ms` : '--'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center col-span-2 lg:col-span-1">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Packet Loss</div>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {result ? `${result.packetLoss}%` : '--'}
          </div>
        </div>
      </div>

      {/* Live Ping Sequence Line Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-4">
          Ping Latency Curve (ms per packet)
        </h2>

        <div className="h-64 w-full">
          {points.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
              Click "Start Ping Sequence" to view sequence latency variations.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="sequence" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <Line
                  type="monotone"
                  dataKey="time"
                  name="Ping (ms)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Packet Logs Table */}
      {points.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl overflow-x-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-4">
            Packet Sequence Log ({points.length} Sent)
          </h2>

          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase font-mono">
                <th className="pb-3 px-3">#</th>
                <th className="pb-3 px-3">Status</th>
                <th className="pb-3 px-3">Response Time</th>
                <th className="pb-3 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {points.map((pt) => (
                <tr key={pt.sequence} className="hover:bg-slate-800/40">
                  <td className="py-2 px-3 text-slate-400">#{pt.sequence}</td>
                  <td className="py-2 px-3">
                    {pt.status === 'success' ? (
                      <span className="inline-flex items-center space-x-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>200 OK</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-rose-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{pt.status.toUpperCase()}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-semibold text-slate-200">
                    {pt.time > 0 ? `${pt.time} ms` : 'Timeout'}
                  </td>
                  <td className="py-2 px-3 text-slate-500">
                    {new Date(pt.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executePing();
        }}
      />
    </div>
  );
};
