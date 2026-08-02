import React, { useState } from 'react';
import {
  Gauge,
  Play,
  RotateCcw,
  ArrowDown,
  ArrowUp,
  Activity,
  ShieldCheck,
  Server,
  Globe,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { SpeedTestResult, HistoryItem } from '../types';
import { runSpeedTest, SPEED_TEST_SERVER_NAME } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';
import { MetricValue, FailureNotice, displayMetric } from './MetricValue';

interface SpeedTestProps {
  onHistoryUpdate: () => void;
}

export const SpeedTest: React.FC<SpeedTestProps> = ({ onHistoryUpdate }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<'idle' | 'ping' | 'download' | 'upload' | 'complete'>('idle');
  const [progress, setProgress] = useState(0);
  const [currentDownload, setCurrentDownload] = useState<number | null>(null);
  const [currentUpload, setCurrentUpload] = useState<number | null>(null);
  const [currentPing, setCurrentPing] = useState<number | null>(null);
  const [currentJitter, setCurrentJitter] = useState<number | null>(null);
  const [serverName, setServerName] = useState<string>(SPEED_TEST_SERVER_NAME);
  const [bytesDownloaded, setBytesDownloaded] = useState<number>(0);
  const [bytesUploaded, setBytesUploaded] = useState<number>(0);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chartData, setChartData] = useState<
    { time: number; download: number | null; upload: number | null }[]
  >([]);
  const [result, setResult] = useState<SpeedTestResult | null>(null);

  const executeTest = async () => {
    setIsRunning(true);
    setStage('ping');
    setProgress(0);
    setCurrentDownload(null);
    setCurrentUpload(null);
    setCurrentPing(null);
    setCurrentJitter(null);
    setBytesDownloaded(0);
    setBytesUploaded(0);
    setChartData([]);
    setResult(null);
    setError(null);

    let sec = 0;
    const interval = setInterval(() => {
      sec += 0.2;
    }, 200);

    try {
      const res = await runSpeedTest((data) => {
        setStage(data.stage);
        setProgress(data.progress);
        setCurrentDownload(data.downloadSpeed);
        setCurrentUpload(data.uploadSpeed);
        setCurrentPing(data.ping);
        setCurrentJitter(data.jitter);
        setServerName(data.serverName);
        setBytesDownloaded(data.totalBytesDownloaded);
        setBytesUploaded(data.totalBytesUploaded);

        setChartData((prev) => [
          ...prev,
          {
            time: Math.round(sec * 10) / 10,
            download: data.downloadSpeed,
            upload: data.uploadSpeed,
          },
        ]);
      });

      setResult(res);

      const historyItem: HistoryItem = {
        id: res.id,
        type: 'speedtest',
        timestamp: res.timestamp,
        title: `Speed Test: ${displayMetric(res.downloadSpeed, 'Mbps', 2)} down / ${displayMetric(
          res.uploadSpeed,
          'Mbps',
          2,
        )} up`,
        summary: `${res.serverName ?? SPEED_TEST_SERVER_NAME} | Ping: ${displayMetric(
          res.ping,
          'ms',
        )} | Transferred: ${res.totalBytesDownloaded ?? 0} MB`,
        data: res,
      };

      saveHistoryItem(historyItem);
      onHistoryUpdate();
      setStage('complete');
      setProgress(100);
    } catch (e) {
      // A thrown test is a failed test. It must not render as a completed one.
      console.error('Speed test error:', e);
      setError(
        e instanceof Error
          ? `The speed test could not run: ${e.message}`
          : 'The speed test could not run.',
      );
      setStage('idle');
      setProgress(0);
    } finally {
      clearInterval(interval);
      setIsRunning(false);
    }
  };

  const startTest = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeTest();
  };

  const getBufferbloatColor = (grade?: string | null) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'B':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case 'C':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default:
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    }
  };

  const mbDownFormatted = (bytesDownloaded / (1024 * 1024)).toFixed(1);
  const mbUpFormatted = (bytesUploaded / (1024 * 1024)).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Gauge className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-100">
              Speed & Bandwidth Benchmark
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Streams real data over three concurrent connections and reports throughput from the
            bytes that actually moved. Anything the test cannot measure is shown as “—”, never
            estimated.
          </p>
        </div>

        <button
          onClick={startTest}
          disabled={isRunning}
          className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <RotateCcw className="w-4 h-4 animate-spin" />
              <span>Testing ({progress}%)...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Start Speed Test</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      <FailureNotice failures={result?.failures} />

      {/* Test endpoint. This used to be a three-way selector whose "Auto-Detect
          Best" option never compared anything and whose "App Server" option
          pointed at a backend that does not exist in the static build. */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Test endpoint
          </span>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          <span className="text-cyan-300">{serverName}</span>
          <span className="text-slate-600"> — speed.cloudflare.com, reached directly from your browser</span>
        </div>
      </div>

      {/* Main Gauges & Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Download Speed Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span className="flex items-center space-x-1">
              <ArrowDown className="w-4 h-4 text-cyan-400" />
              <span>Download</span>
            </span>
            {stage === 'download' && (
              <span className="animate-pulse text-cyan-400 text-[10px] font-mono">Streaming Data...</span>
            )}
          </div>

          <div className="my-4 text-center">
            <div className="text-4xl font-extrabold font-mono text-white">
              <MetricValue value={currentDownload} precision={2} unavailableClassName="text-slate-700" />
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">Mbps</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Transferred: {mbDownFormatted} MB
            </div>
          </div>

          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-cyan-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, ((currentDownload ?? 0) / 150) * 100)}%` }}
            />
          </div>
        </div>

        {/* Upload Speed Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span className="flex items-center space-x-1">
              <ArrowUp className="w-4 h-4 text-blue-400" />
              <span>Upload</span>
            </span>
            {stage === 'upload' && (
              <span className="animate-pulse text-blue-400 text-[10px] font-mono">Posting Payload...</span>
            )}
          </div>

          <div className="my-4 text-center">
            <div className="text-4xl font-extrabold font-mono text-white">
              <MetricValue value={currentUpload} precision={2} unavailableClassName="text-slate-700" />
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">Mbps</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Transferred: {mbUpFormatted} MB
            </div>
          </div>

          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-blue-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, ((currentUpload ?? 0) / 100) * 100)}%` }}
            />
          </div>
        </div>

        {/* Ping / Latency Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span className="flex items-center space-x-1">
              <Activity className="w-4 h-4 text-purple-400" />
              <span>Ping / Latency</span>
            </span>
            {stage === 'ping' && (
              <span className="animate-pulse text-purple-400 text-[10px] font-mono">Pinging...</span>
            )}
          </div>

          <div className="my-4 text-center">
            <div className="text-4xl font-extrabold font-mono text-white">
              <MetricValue value={currentPing} unavailableClassName="text-slate-700" />
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">
              ms (Jitter: {displayMetric(currentJitter, 'ms')})
            </div>
          </div>

          <div className="text-[11px] text-slate-400 text-center font-mono">
            {currentPing === null
              ? 'Not measured'
              : currentPing < 30
                ? 'Excellent latency'
                : 'Standard response'}
          </div>
        </div>

        {/* Bufferbloat / Loaded Latency */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span className="flex items-center space-x-1">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>Bufferbloat</span>
            </span>
          </div>

          <div className="my-3 text-center">
            <div className="flex items-center justify-center space-x-2">
              {/* An ungraded test rendered a passing 'A+' here, so a run that
                  never measured loaded latency looked like a perfect result. */}
              <span
                className={`text-2xl font-extrabold font-mono border px-3 py-0.5 rounded-lg ${
                  result?.bufferbloatScore
                    ? getBufferbloatColor(result.bufferbloatScore)
                    : 'text-slate-600 bg-slate-800/50 border-slate-700/50'
                }`}
                title={
                  result?.bufferbloatScore
                    ? undefined
                    : 'Needs both an idle and an under-load latency sample.'
                }
              >
                {result?.bufferbloatScore ?? '—'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              Loaded ping: {displayMetric(result?.loadedPing ?? null, 'ms')}
            </div>
          </div>

          <div className="text-[10px] text-slate-500 text-center">
            Measures latency spike under network load
          </div>
        </div>
      </div>

      {/* Test Progress & Server Info Bar */}
      {(isRunning || stage === 'complete') && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <span className="uppercase font-semibold tracking-wider text-cyan-400 font-mono">
                Stage: {stage.toUpperCase()}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-300 flex items-center space-x-1">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>Endpoint: <strong>{serverName}</strong></span>
              </span>
            </div>

            <span className="font-mono text-slate-400">
              Progress: <strong className="text-white">{progress}%</strong>
            </span>
          </div>

          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Live Bandwidth Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Live Throughput Timeline (Mbps)
          </h2>
          {result && (
            <div className="text-xs text-slate-400 font-mono">
              Total Data Transferred: <span className="text-cyan-400 font-bold">{((result.totalBytesDownloaded || 0) + (result.totalBytesUploaded || 0)).toFixed(1)} MB</span>
            </div>
          )}
        </div>

        <div className="h-64 w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
              Click "Start Speed Test" to record live download and upload performance curves.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <Line
                  type="monotone"
                  dataKey="download"
                  name="Download (Mbps)"
                  stroke="#06b6d4"
                  strokeWidth={3}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="upload"
                  name="Upload (Mbps)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executeTest();
        }}
      />
    </div>
  );
};

