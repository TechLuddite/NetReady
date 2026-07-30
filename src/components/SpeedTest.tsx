import React, { useState } from 'react';
import {
  Gauge,
  Play,
  RotateCcw,
  CheckCircle2,
  Zap,
  ArrowDown,
  ArrowUp,
  Activity,
  ShieldCheck,
  Server,
  HardDrive,
  Info,
  Globe,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { SpeedTestResult, HistoryItem } from '../types';
import { runSpeedTest, SpeedTestServerTarget } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface SpeedTestProps {
  onHistoryUpdate: () => void;
}

export const SpeedTest: React.FC<SpeedTestProps> = ({ onHistoryUpdate }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<'idle' | 'ping' | 'download' | 'upload' | 'complete'>('idle');
  const [progress, setProgress] = useState(0);
  const [currentDownload, setCurrentDownload] = useState(0);
  const [currentUpload, setCurrentUpload] = useState(0);
  const [currentPing, setCurrentPing] = useState(0);
  const [currentJitter, setCurrentJitter] = useState(0);
  const [serverTarget, setServerTarget] = useState<SpeedTestServerTarget>('auto');
  const [serverName, setServerName] = useState<string>('Auto-Select Best Endpoint');
  const [bytesDownloaded, setBytesDownloaded] = useState<number>(0);
  const [bytesUploaded, setBytesUploaded] = useState<number>(0);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  const [chartData, setChartData] = useState<{ time: number; download: number; upload: number }[]>([]);
  const [result, setResult] = useState<SpeedTestResult | null>(null);

  const executeTest = async () => {
    setIsRunning(true);
    setStage('ping');
    setProgress(0);
    setCurrentDownload(0);
    setCurrentUpload(0);
    setCurrentPing(0);
    setCurrentJitter(0);
    setBytesDownloaded(0);
    setBytesUploaded(0);
    setChartData([]);
    setResult(null);

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
      }, serverTarget);

      clearInterval(interval);
      setResult(res);

      // Save to LocalStorage
      const historyItem: HistoryItem = {
        id: res.id,
        type: 'speedtest',
        timestamp: res.timestamp,
        title: `Speed Test: ${res.downloadSpeed} Mbps Down / ${res.uploadSpeed} Mbps Up`,
        summary: `Server: ${res.serverName || 'App Server'} | Ping: ${res.ping} ms | Download: ${res.totalBytesDownloaded || 0} MB`,
        data: res,
      };

      saveHistoryItem(historyItem);
      onHistoryUpdate();
    } catch (e) {
      console.error('Speed test error:', e);
    } finally {
      setIsRunning(false);
      setStage('complete');
      setProgress(100);
    }
  };

  const startTest = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeTest();
  };

  const getBufferbloatColor = (grade?: string) => {
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
            Multi-threaded streaming throughput engine. Measures real-time chunked data transfers directly against app server endpoints or global CDN nodes.
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

      {/* Target Server Configurator */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Test Endpoint Server:
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setServerTarget('auto')}
            disabled={isRunning}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all border ${
              serverTarget === 'auto'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700/60'
            }`}
          >
            Auto-Detect Best
          </button>

          <button
            onClick={() => setServerTarget('app_server')}
            disabled={isRunning}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all border ${
              serverTarget === 'app_server'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700/60'
            }`}
          >
            App Server (Express Backend)
          </button>

          <button
            onClick={() => setServerTarget('cloudflare')}
            disabled={isRunning}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all border ${
              serverTarget === 'cloudflare'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700/60'
            }`}
          >
            Cloudflare CDN Edge
          </button>
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
              {currentDownload > 0 ? currentDownload : '--'}
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">Mbps</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Transferred: {mbDownFormatted} MB
            </div>
          </div>

          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-cyan-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (currentDownload / 150) * 100)}%` }}
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
              {currentUpload > 0 ? currentUpload : '--'}
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">Mbps</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Transferred: {mbUpFormatted} MB
            </div>
          </div>

          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-blue-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (currentUpload / 100) * 100)}%` }}
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
              {currentPing > 0 ? currentPing : '--'}
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase font-medium">
              ms (Jitter: {currentJitter}ms)
            </div>
          </div>

          <div className="text-[11px] text-slate-400 text-center font-mono">
            {currentPing < 30 && currentPing > 0 ? 'Excellent Latency' : currentPing > 0 ? 'Standard Response' : 'Idle'}
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
              <span className={`text-2xl font-extrabold font-mono border px-3 py-0.5 rounded-lg ${getBufferbloatColor(result?.bufferbloatScore)}`}>
                {result?.bufferbloatScore || 'A+'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              Loaded Ping: {result?.loadedPing ? `${result.loadedPing} ms` : '--'}
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

