import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Zap,
  Pause,
  Play,
  Trash2,
  Wifi,
  Clock,
  HardDrive,
  Filter,
  Layers,
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
import { MetricValue } from './MetricValue';

export interface CapturedResource {
  id: string;
  name: string;
  initiatorType: string;
  duration: number; // ms
  transferSize: number; // bytes
  decodedBodySize: number; // bytes
  startTime: number; // ms timestamp from performance.now()
  timestamp: number; // absolute ms
}

export interface TrafficSample {
  timestamp: number;
  timeLabel: string;
  requestsCount: number;
  transferBytes: number;
  throughputKbps: number;
  avgLatencyMs: number;
  peakLatencyMs: number;
}

export const TrafficMonitor: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  const [recentResources, setRecentResources] = useState<CapturedResource[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [isGeneratingTraffic, setIsGeneratingTraffic] = useState(false);
  const [totalCapturedCount, setTotalCapturedCount] = useState(0);
  const [totalBytesCaptured, setTotalBytesCaptured] = useState(0);

  // Buffer for entries collected in current 1-second interval
  const pendingEntriesRef = useRef<CapturedResource[]>([]);
  const isMonitoringRef = useRef(isMonitoring);

  useEffect(() => {
    isMonitoringRef.current = isMonitoring;
  }, [isMonitoring]);

  // PerformanceObserver Setup
  useEffect(() => {
    // Initial backlog load from performance buffer
    try {
      const existing = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      if (existing && existing.length > 0) {
        const parsed: CapturedResource[] = existing.slice(-50).map((entry, i) => ({
          id: `init_${i}_${Date.now()}`,
          name: entry.name,
          initiatorType: entry.initiatorType || 'other',
          duration: Math.max(1, Math.round(entry.duration)),
          transferSize: entry.transferSize || entry.encodedBodySize || 0,
          decodedBodySize: entry.decodedBodySize || 0,
          startTime: entry.startTime,
          timestamp: Date.now() - (performance.now() - entry.startTime),
        }));
        pendingEntriesRef.current.push(...parsed);
      }
    } catch (e) {
      console.warn('Unable to read initial performance entries:', e);
    }

    let observer: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver((list) => {
          if (!isMonitoringRef.current) return;
          const entries = list.getEntries() as PerformanceResourceTiming[];
          const newCaptured: CapturedResource[] = entries.map((entry, idx) => ({
            id: `res_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
            name: entry.name,
            initiatorType: entry.initiatorType || 'fetch',
            duration: Math.max(1, Math.round(entry.duration)),
            transferSize: entry.transferSize || entry.encodedBodySize || 0,
            decodedBodySize: entry.decodedBodySize || 0,
            startTime: entry.startTime,
            timestamp: Date.now(),
          }));

          pendingEntriesRef.current.push(...newCaptured);
        });

        observer.observe({ entryTypes: ['resource'] });
      } catch (err) {
        console.warn('PerformanceObserver resource observation error:', err);
      }
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  // Interval timer to aggregate samples every 1 second
  useEffect(() => {
    const MAX_SAMPLES = 30; // 30-second sliding sparkline window

    const interval = setInterval(() => {
      // Pause means pause. This guard was missing, so "Pause" only stopped the
      // PerformanceObserver from collecting — the aggregation tick kept pushing
      // empty samples and re-rendering the whole Dashboard subtree every second,
      // indefinitely.
      if (!isMonitoringRef.current) return;

      const now = new Date();
      const timeLabel = now.toLocaleTimeString([], {
        hour12: false,
        minute: '2-digit',
        second: '2-digit',
      });

      const currentBatch = [...pendingEntriesRef.current];
      pendingEntriesRef.current = [];

      const requestsCount = currentBatch.length;
      let transferBytes = 0;
      let totalLatency = 0;
      let peakLatencyMs = 0;

      if (requestsCount > 0) {
        currentBatch.forEach((res) => {
          transferBytes += res.transferSize;
          totalLatency += res.duration;
          if (res.duration > peakLatencyMs) {
            peakLatencyMs = res.duration;
          }
        });
      }

      const avgLatencyMs = requestsCount > 0 ? Math.round(totalLatency / requestsCount) : 0;
      const throughputKbps = Math.round((transferBytes * 8) / 1024); // kilobits per second for 1s frame

      setTotalCapturedCount((prev) => prev + requestsCount);
      setTotalBytesCaptured((prev) => prev + transferBytes);

      const newSample: TrafficSample = {
        timestamp: Date.now(),
        timeLabel,
        requestsCount,
        transferBytes,
        throughputKbps,
        avgLatencyMs,
        peakLatencyMs,
      };

      setSamples((prev) => {
        const updated = [...prev, newSample];
        if (updated.length > MAX_SAMPLES) {
          return updated.slice(updated.length - MAX_SAMPLES);
        }
        return updated;
      });

      if (currentBatch.length > 0) {
        setRecentResources((prev) => {
          const combined = [...currentBatch.reverse(), ...prev];
          return combined.slice(0, 40);
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Generate simulated test requests to show live spikes on sparkline
  const handleGenerateTestTraffic = async () => {
    setIsGeneratingTraffic(true);
    const endpoints = [
      'https://1.1.1.1/cdn-cgi/trace',
      'https://dns.google/resolve?name=example.com&type=A',
      'https://cloudflare-dns.com/dns-query?name=cloudflare.com&type=A',
      'https://httpbin.org/get',
    ];

    try {
      const promises = endpoints.map((url) =>
        fetch(`${url}${url.includes('?') ? '&' : '?'}cache_bust=${Date.now()}_${Math.random()}`, {
          cache: 'no-store',
          mode: 'cors',
        }).catch(() => null)
      );

      await Promise.all(promises);
    } catch (e) {
      console.warn('Test traffic error:', e);
    } finally {
      setTimeout(() => setIsGeneratingTraffic(false), 600);
    }
  };

  const handleClearHistory = () => {
    setSamples([]);
    setRecentResources([]);
    setTotalCapturedCount(0);
    setTotalBytesCaptured(0);
  };

  // Filtered resources for recent stream table
  const filteredResources = recentResources.filter((res) => {
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'fetch') return res.initiatorType === 'fetch' || res.initiatorType === 'xmlhttprequest';
    if (selectedFilter === 'script') return res.initiatorType === 'script';
    if (selectedFilter === 'css') return res.initiatorType === 'css' || res.initiatorType === 'link';
    if (selectedFilter === 'img') return res.initiatorType === 'img' || res.initiatorType === 'image';
    return res.initiatorType === selectedFilter;
  });

  // Calculate current live metrics from last 5 samples
  const activeSamples = samples.slice(-5);
  const currentRequestsPerSec = activeSamples.length
    ? Math.round(activeSamples.reduce((acc, s) => acc + s.requestsCount, 0) / activeSamples.length)
    : 0;
  // Only samples that actually contain a request carry a latency. With none, the
  // answer is "no latency to average", not "0 ms" — the `|| 1` denominator here
  // used to divide a sum of zeros by one and render a confident 0 ms while the
  // machine was offline and nothing had been requested at all.
  const samplesWithRequests = activeSamples.filter((s) => s.requestsCount > 0);
  const currentAvgLatency: number | null =
    samplesWithRequests.length > 0
      ? Math.round(
          samplesWithRequests.reduce((acc, s) => acc + s.avgLatencyMs, 0) /
            samplesWithRequests.length,
        )
      : null;
  const currentKbps = activeSamples.length
    ? Math.round(activeSamples.reduce((acc, s) => acc + s.throughputKbps, 0) / activeSamples.length)
    : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatUrlName = (url: string) => {
    try {
      const parsed = new URL(url);
      return { host: parsed.host, path: parsed.pathname + parsed.search };
    } catch {
      return { host: 'resource', path: url.length > 50 ? url.substring(0, 50) + '...' : url };
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
      {/* Background Subtle Accent */}
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="p-1.5 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
              <Activity className="w-5 h-5 animate-pulse" />
            </span>
            <h2 className="text-lg font-bold text-slate-100">
              Real-Time Network Traffic Monitor
            </h2>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded uppercase">
              PerformanceObserver API
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Live browser network throughput (Kbps / requests) and response latency (ms) sparkline metrics recorded in real-time.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setIsMonitoring(!isMonitoring)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              isMonitoring
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
            }`}
            title={isMonitoring ? 'Pause Live Monitoring' : 'Resume Live Monitoring'}
          >
            {isMonitoring ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Monitoring Live</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Paused</span>
              </>
            )}
          </button>

          <button
            onClick={handleGenerateTestTraffic}
            disabled={isGeneratingTraffic}
            className="flex items-center space-x-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            title="Fire sample HTTP requests to trigger real-time sparkline spikes"
          >
            <Zap className={`w-3.5 h-3.5 ${isGeneratingTraffic ? 'animate-bounce text-cyan-300' : ''}`} />
            <span>{isGeneratingTraffic ? 'Probing...' : 'Trigger Network Spike'}</span>
          </button>

          <button
            onClick={handleClearHistory}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 rounded-xl text-xs transition-colors"
            title="Clear Sparkline History"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top Telemetry KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Current Throughput */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider flex items-center justify-between">
            <span>Throughput</span>
            <Wifi className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              {currentKbps}
            </span>
            <span className="text-xs text-cyan-400 font-mono font-semibold">Kbps</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">
            {currentRequestsPerSec} req/sec live rate
          </div>
        </div>

        {/* Avg Response Latency */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider flex items-center justify-between">
            <span>Avg Latency</span>
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              <MetricValue
                value={currentAvgLatency}
                failure={{
                  metric: 'avgLatencyMs',
                  reason: 'insufficient-samples',
                  detail:
                    'No request completed in the last five seconds, so there is no latency to ' +
                    'average.',
                }}
                unavailableClassName="text-slate-600"
              />
            </span>
            {currentAvgLatency !== null && (
              <span className="text-xs text-emerald-400 font-mono font-semibold">ms</span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">
            Last 5s rolling average
          </div>
        </div>

        {/* Total Captured Requests */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider flex items-center justify-between">
            <span>Captured Requests</span>
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              {totalCapturedCount}
            </span>
            <span className="text-xs text-slate-400 font-mono">reqs</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">
            Recorded in session
          </div>
        </div>

        {/* Total Transferred Payload */}
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 relative overflow-hidden">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider flex items-center justify-between">
            <span>Payload Size</span>
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-xl font-extrabold text-white font-mono">
              {formatBytes(totalBytesCaptured)}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 font-mono">
            Transferred over network
          </div>
        </div>
      </div>

      {/* Sparkline Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Network Throughput & Request Count Sparkline */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Network Throughput (Kbps)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">30s Window</span>
          </div>

          <div className="h-44 w-full">
            {samples.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 text-xs font-mono">
                Waiting for network activity...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={samples} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    stroke="#475569"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#475569"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    unit=" Kbps"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '0.75rem',
                      fontSize: '11px',
                    }}
                    formatter={(val: any) => [`${val} Kbps`, 'Throughput']}
                    labelFormatter={(lbl) => `Time: ${lbl}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="throughputKbps"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#throughputGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 2. Response Latency Sparkline */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Response Latency (ms)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Peak & Avg ms</span>
          </div>

          <div className="h-44 w-full">
            {samples.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 text-xs font-mono">
                Waiting for network activity...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={samples} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    stroke="#475569"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#475569"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    unit=" ms"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '0.75rem',
                      fontSize: '11px',
                    }}
                    formatter={(val: any, name: any) => [
                      `${val} ms`,
                      name === 'avgLatencyMs' ? 'Avg Latency' : 'Peak Latency',
                    ]}
                    labelFormatter={(lbl) => `Time: ${lbl}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="avgLatencyMs"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="peakLatencyMs"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    fill="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Captured Resource Requests Feed Table */}
      <div className="border-t border-slate-800 pt-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Recent Network Resource Log ({filteredResources.length})
            </h3>
          </div>

          {/* Initiator Type Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-medium">
            {['all', 'fetch', 'script', 'css', 'img'].map((type) => (
              <button
                key={type}
                onClick={() => setSelectedFilter(type)}
                className={`px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all ${
                  selectedFilter === type
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {filteredResources.length === 0 ? (
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-500 font-mono">
            No network request entries matching filter. Trigger test traffic above or perform actions in the app!
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
                <tr>
                  <th className="py-2.5 px-3">Resource Target</th>
                  <th className="py-2.5 px-3">Initiator</th>
                  <th className="py-2.5 px-3">Latency</th>
                  <th className="py-2.5 px-3">Transfer Size</th>
                  <th className="py-2.5 px-3 text-right">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredResources.slice(0, 12).map((res) => {
                  const urlFormatted = formatUrlName(res.name);
                  return (
                    <tr key={res.id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="py-2 px-3 max-w-xs truncate">
                        <span className="text-slate-200 font-semibold block truncate">
                          {urlFormatted.host}
                        </span>
                        <span className="text-slate-500 text-[10px] truncate block">
                          {urlFormatted.path}
                        </span>
                      </td>

                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-800 text-cyan-300 border border-slate-700">
                          {res.initiatorType}
                        </span>
                      </td>

                      <td className="py-2 px-3 font-semibold">
                        <span
                          className={
                            res.duration < 100
                              ? 'text-emerald-400'
                              : res.duration < 300
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }
                        >
                          {res.duration} ms
                        </span>
                      </td>

                      <td className="py-2 px-3 text-slate-300">
                        {formatBytes(res.transferSize)}
                      </td>

                      <td className="py-2 px-3 text-right text-[10px] text-slate-500">
                        {new Date(res.timestamp).toLocaleTimeString([], {
                          hour12: false,
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
