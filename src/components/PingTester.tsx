import React, { useState, useRef, useEffect } from 'react';
import { Radio, Play, StopCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { PingResult, PingPoint, HistoryItem } from '../types';
import { PING_TARGET_PRESETS, executePingBatch, meanConsecutiveDelta } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';
import { MetricValue, displayMetric } from './MetricValue';

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
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
    };
  }, []);

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
    stopRequestedRef.current = false;
    setIsPinging(true);
    setPoints([]);
    setResult(null);

    const { url, label } = getActiveUrlAndLabel();

    try {
      const res = await executePingBatch(
        url,
        label,
        packetCount,
        (_pt, currentPoints) => {
          setPoints(currentPoints);

          // Live metrics so the cards update mid-run. Same null semantics as the
          // engine: an unanswered target has no RTT, so these stay null rather
          // than reading 0 ms.
          const valid = currentPoints.filter((p) => p.status === 'success' && p.time > 0);
          const sent = currentPoints.length;
          const received = valid.length;
          const packetLoss = sent > 0 ? Math.round(((sent - received) / sent) * 100) : 0;
          let minPing: number | null = null;
          let maxPing: number | null = null;
          let avgPing: number | null = null;
          let jitter: number | null = null;

          if (valid.length > 0) {
            const times = valid.map((p) => p.time);
            minPing = Math.min(...times);
            maxPing = Math.max(...times);
            avgPing = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
            jitter = meanConsecutiveDelta(times);
          }

          setResult({
            id: 'ping_live',
            timestamp: Date.now(),
            target: url,
            label,
            packetsSent: sent,
            packetsReceived: received,
            packetLoss,
            minPing,
            maxPing,
            avgPing,
            jitter,
            points: currentPoints,
          });
        },
        () => stopRequestedRef.current
      );

      setResult(res);

      // Save to LocalStorage if packets were sent
      if (res.packetsSent > 0) {
        const item: HistoryItem = {
          id: res.id,
          type: 'ping',
          timestamp: res.timestamp,
          title: `Ping ${res.label}: avg ${displayMetric(res.avgPing, 'ms')}${
            packetCount === 0 ? ' (continuous)' : ''
          }`,
          summary: `Min: ${displayMetric(res.minPing, 'ms')} | Max: ${displayMetric(
            res.maxPing,
            'ms',
          )} | Jitter: ${displayMetric(res.jitter, 'ms')} | Loss: ${res.packetLoss}% (${
            res.packetsSent
          } sent)`,
          data: res,
        };

        saveHistoryItem(item);
        onHistoryUpdate();
      }
    } catch (e) {
      console.error('Ping batch failed:', e);
    } finally {
      setIsPinging(false);
    }
  };

  const handleStartPing = () => {
    if (isPinging) {
      stopRequestedRef.current = true;
      return;
    }
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
          className={`flex items-center space-x-2 font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg active:scale-95 ${
            isPinging
              ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-500/20'
              : 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white shadow-blue-500/20'
          }`}
        >
          {isPinging ? (
            <>
              <StopCircle className="w-4 h-4 fill-white animate-pulse" />
              <span>
                Stop Ping {packetCount === 0 ? `(${points.length} sent)` : `(${points.length}/${packetCount})`}
              </span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>{packetCount === 0 ? 'Start Continuous Ping' : 'Start Ping Sequence'}</span>
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
                disabled={isPinging}
                onClick={() => {
                  setSelectedTarget(preset.url);
                  setCustomTarget('');
                }}
                className={`p-3 rounded-xl text-xs font-medium text-left transition-all border ${
                  isSelected
                    ? 'bg-blue-500/15 text-blue-300 border-blue-500/40 shadow-sm'
                    : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                } disabled:opacity-50`}
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
              disabled={isPinging}
              placeholder="e.g. https://api.github.com or my-router.local"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Packet Sequence Count:
            </label>
            <select
              value={packetCount}
              disabled={isPinging}
              onChange={(e) => setPacketCount(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            >
              <option value={10}>10 Packets</option>
              <option value={15}>15 Packets</option>
              <option value={20}>20 Packets</option>
              <option value={50}>50 Packets</option>
              <option value={100}>100 Packets</option>
              <option value={0}>Continuous Ping (∞ / -t)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Ping Metrics Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Min Ping</div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            <MetricValue value={result?.minPing ?? null} unit="ms" unavailableClassName="text-slate-700" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Avg Ping</div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            <MetricValue value={result?.avgPing ?? null} unit="ms" unavailableClassName="text-slate-700" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Max Ping</div>
          <div className="text-2xl font-bold font-mono text-rose-400">
            <MetricValue value={result?.maxPing ?? null} unit="ms" unavailableClassName="text-slate-700" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div className="text-xs text-slate-400 uppercase font-medium mb-1">Jitter Variance</div>
          <div className="text-2xl font-bold font-mono text-purple-400">
            <MetricValue value={result?.jitter ?? null} unit="ms" unavailableClassName="text-slate-700" />
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Ping Latency Curve (ms per packet)
          </h2>
          {isPinging && packetCount === 0 && (
            <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono rounded-lg">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span>Continuous Active ({points.length} sent)</span>
            </span>
          )}
        </div>

        <div className="h-64 w-full">
          {points.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
              Click "{packetCount === 0 ? 'Start Continuous Ping' : 'Start Ping Sequence'}" to view sequence latency variations.
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
            Packet Sequence Log ({points.length} Sent{packetCount === 0 ? ' - Continuous Mode' : ''})
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
