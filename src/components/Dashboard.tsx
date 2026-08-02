import React, { useState, useEffect } from 'react';
import {
  Gauge,
  Radio,
  Globe,
  Cpu,
  Calculator,
  Search,
  Server,
  Terminal,
  History,
  Zap,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Clock,
  Radar,
  GitCommit,
  Archive,
  Compass,
  Stethoscope,
  Network,
  ShieldQuestion,
} from 'lucide-react';
import { ToolTab, NetworkConnectionInfo, SpeedTestResult, PingResult, HistoryItem } from '../types';
import {
  runSpeedTest,
  executePingBatch,
  gatherWebRtcCandidates,
  calculateNetReadyScore,
  createId,
} from '../utils/network';
import { displayMetric } from './MetricValue';
import { BottleneckSummary } from './BottleneckSummary';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';
import { TrafficMonitor } from './TrafficMonitor';

/**
 * One category readiness bar. A category with no measurement behind it shows an
 * em-dash and an empty track, not a zero-width bar that reads as "scored 0".
 */
const ScoreBar: React.FC<{ label: string; score: number | null }> = ({ label, score }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="text-slate-400">{label}</span>
      <span
        className={`font-mono font-semibold ${score === null ? 'text-slate-600' : 'text-cyan-400'}`}
        title={score === null ? 'Not enough measurements to score this category.' : undefined}
      >
        {score === null ? '—' : `${score}%`}
      </span>
    </div>
    <div
      className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={score ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={score === null ? 'not measured' : `${score} percent`}
    >
      {score !== null && (
        <div
          className="bg-cyan-500 h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%` }}
        />
      )}
    </div>
  </div>
);

interface DashboardProps {
  setActiveTab: (tab: ToolTab) => void;
  connInfo: NetworkConnectionInfo;
  history: HistoryItem[];
  onHistoryUpdate: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  setActiveTab,
  connInfo,
  history,
  onHistoryUpdate,
}) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditStep, setAuditStep] = useState<string>('');
  const [latestSpeed, setLatestSpeed] = useState<SpeedTestResult | null>(null);
  const [latestPing, setLatestPing] = useState<PingResult | null>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Load existing test results from history on mount (do NOT auto-run any test)
  useEffect(() => {
    const speedItem = history.find((h) => h.type === 'speedtest');
    if (speedItem) setLatestSpeed(speedItem.data);

    const pingItem = history.find((h) => h.type === 'ping');
    if (pingItem) setLatestPing(pingItem.data);
  }, [history]);

  // Null until enough has been measured to score anything. The score is never
  // computed from stand-in values.
  const netReadyScore = calculateNetReadyScore(latestSpeed, latestPing);
  const hasMeasured = netReadyScore !== null;

  const executeFullAudit = async () => {
    setIsAuditing(true);
    setAuditError(null);
    try {
      setAuditStep('1 of 3 — measuring latency and jitter');
      const pingRes = await executePingBatch('https://1.1.1.1/cdn-cgi/trace', 'Cloudflare (1.1.1.1)', 8);
      setLatestPing(pingRes);

      setAuditStep('2 of 3 — measuring bandwidth via the Cloudflare edge');
      const speedRes = await runSpeedTest();
      setLatestSpeed(speedRes);

      setAuditStep('3 of 3 — gathering WebRTC ICE candidates');
      const rtcRes = await gatherWebRtcCandidates();
      if (rtcRes.publicIps.length > 0) {
        setPublicIp(rtcRes.publicIps[0]);
      }

      const score = calculateNetReadyScore(speedRes, pingRes);
      const auditItem: HistoryItem = {
        id: createId('audit'),
        type: 'speedtest',
        timestamp: Date.now(),
        title: score
          ? `Full audit: grade ${score.grade} (${score.overallScore}%)`
          : 'Full audit: not scorable — no measurement succeeded',
        summary: `Cloudflare CDN | Download: ${displayMetric(
          speedRes.downloadSpeed,
          'Mbps',
          2,
        )} | Ping: ${displayMetric(pingRes.avgPing, 'ms')} | Jitter: ${displayMetric(
          pingRes.jitter,
          'ms',
        )}`,
        data: speedRes,
      };

      saveHistoryItem(auditItem);
      onHistoryUpdate();
    } catch (e) {
      console.error('Audit failed:', e);
      setAuditError(
        e instanceof Error
          ? `The audit could not complete: ${e.message}`
          : 'The audit could not complete.',
      );
    } finally {
      setIsAuditing(false);
      setAuditStep('');
    }
  };

  const handleRunFullAudit = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeFullAudit();
  };

  const getGradeColor = (grade?: string) => {
    if (!grade) return 'text-slate-500 bg-slate-800/50 border-slate-700/50';
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

  return (
    <div className="space-y-6">
      {/* Hero Header & NetReady Readiness Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Readiness Score Badge */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  NetReady Connection Benchmark
                </span>
              </div>
              <h1 className="text-2xl font-bold text-slate-100">
                Network Readiness Score
              </h1>
              <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                Derived from measured round-trip latency, jitter and throughput against the
                Cloudflare edge. Categories whose inputs could not be measured are left blank
                rather than scored from typical values.
              </p>
            </div>

            {/* Score. `netReadyScore` is null until something has actually been
                measured — there is no "typical value" fallback behind it. */}
            <div className="flex items-center space-x-4 bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60 shadow-inner">
              <div className="text-center">
                <div
                  className={`text-4xl font-extrabold border px-4 py-1 rounded-xl font-mono ${getGradeColor(
                    netReadyScore?.grade,
                  )}`}
                >
                  {netReadyScore?.grade ?? '--'}
                </div>
                <div className="text-[10px] text-slate-400 font-medium uppercase mt-1">Grade</div>
              </div>

              <div className="h-10 w-[1px] bg-slate-700" />

              <div>
                <div className="text-3xl font-extrabold text-white font-mono">
                  {netReadyScore?.overallScore ?? '--'}
                  <span className="text-lg text-slate-400">%</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium uppercase">Overall score</div>
              </div>
            </div>
          </div>

          {/* Bottleneck attribution.
              This is the headline now. Four flat bars showed which categories
              scored low without ever saying which measured input was dragging
              them down, so the one question a user actually has — "what do I
              change?" — went unanswered. The bars are still below, demoted to
              supporting detail. */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            <BottleneckSummary score={netReadyScore} speed={latestSpeed} ping={latestPing} />
          </div>

          {/* Application category suitability */}
          <div className="mt-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
              Category suitability
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ScoreBar label="Gaming" score={netReadyScore?.gamingScore ?? null} />
              <ScoreBar label="4K Video" score={netReadyScore?.streamingScore ?? null} />
              <ScoreBar label="VoIP / Calls" score={netReadyScore?.voipScore ?? null} />
              <ScoreBar label="Large Files" score={netReadyScore?.downloadScore ?? null} />
            </div>
          </div>

          {auditError && (
            <div
              role="alert"
              className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-200"
            >
              {auditError}
            </div>
          )}

          {/* Audit action */}
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={handleRunFullAudit}
                disabled={isAuditing}
                className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
              >
                {isAuditing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>{auditStep || 'Auditing network...'}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-white" />
                    <span>{hasMeasured ? 'Re-run full audit' : 'Run readiness baseline test'}</span>
                  </>
                )}
              </button>

              {isAuditing && (
                <span aria-live="polite" className="sr-only">
                  {auditStep}
                </span>
              )}
            </div>

            {/* Every generated finding is shown. Previously only the first of
                three was rendered and the other two were dead code. */}
            {netReadyScore ? (
              <ul className="space-y-1 text-xs text-slate-400 leading-relaxed">
                {netReadyScore.details.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span className="text-cyan-500 shrink-0">-</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">
                No baseline yet. Run the audit to measure latency, jitter and throughput.
              </p>
            )}
          </div>
        </div>

        {/* Live Browser Connection Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Browser Interface Status
              </h2>
              <span className={`w-2.5 h-2.5 rounded-full ${connInfo.isOnline ? 'bg-emerald-400 animate-ping' : 'bg-rose-500'}`} />
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Online Status:</span>
                <span className={connInfo.isOnline ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {connInfo.isOnline ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Downlink Estimate:</span>
                <span className="text-slate-200 font-bold">
                  {connInfo.downlink ? `${connInfo.downlink} Mbps` : 'N/A'}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Network Type:</span>
                <span className="text-cyan-400 font-semibold uppercase">
                  {connInfo.effectiveType || connInfo.type || 'Standard'}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Estimated RTT:</span>
                <span className="text-slate-200 font-bold">
                  {connInfo.rtt ? `${connInfo.rtt} ms` : 'N/A'}
                </span>
              </div>

              {publicIp && (
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Public IP:</span>
                  <span className="text-emerald-400 font-semibold">{publicIp}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Local Storage Persistence</span>
            <span className="text-emerald-400 font-mono">Active</span>
          </div>
        </div>
      </div>

      {/* Real-Time PerformanceObserver Traffic Monitor Sparklines */}
      <TrafficMonitor />

      {/* Tool Launch Grid */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">
          Local Network Diagnostic Tools
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Triage — the answer layer */}
          <div
            onClick={() => setActiveTab('triage')}
            className="group bg-gradient-to-br from-cyan-950/50 via-slate-900 to-slate-900 border border-cyan-500/40 hover:border-cyan-400 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500 text-black flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              <Stethoscope className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition-colors">
                Is it me or the internet?
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-300 line-clamp-2">
              One run walks the whole decision tree and returns a verdict with ranked causes and
              fixes — deterministic rules, no model, every finding backed by its measurements.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform">
              <span>Run triage</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Dual-stack */}
          <div
            onClick={() => setActiveTab('dualstack')}
            className="group bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3 group-hover:bg-indigo-500 group-hover:text-slate-950 transition-colors">
              <Network className="w-5 h-5" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 group-hover:text-indigo-300 transition-colors">
                IPv4 / IPv6 Reachability
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">
              Call hosts that publish only an A record and only an AAAA record, and see which
              family actually carries traffic from here.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-indigo-300 group-hover:translate-x-1 transition-transform">
              <span>Check both families</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Captive portal & DNS hijack */}
          <div
            onClick={() => setActiveTab('captive')}
            className="group bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
              <ShieldQuestion className="w-5 h-5" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 group-hover:text-amber-300 transition-colors">
                Portal &amp; DNS Hijack
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">
              Endpoints whose exact response is known, checked for substitution — plus whether a
              server reachable by literal IP is also reachable by name.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-amber-300 group-hover:translate-x-1 transition-transform">
              <span>Check for interception</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Traceroute TRACERT Hop Map */}
          <div
            onClick={() => setActiveTab('edgepath')}
            className="group bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-900 border border-cyan-500/30 hover:border-cyan-400 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500 text-black flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              <Compass className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition-colors">
                Edge Path Explorer
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-300 line-clamp-2">
              Real DNS, TCP, TLS and first-byte timings, the CDN edge that answered, and whether
              HTTP/3 is reaching your network.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform">
              <span>Explore edge path</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Route model (simulated) */}
          <div
            onClick={() => setActiveTab('tracert')}
            className="group bg-slate-900 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
              <GitCommit className="w-5 h-5 rotate-90" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 group-hover:text-amber-300 transition-colors">
                Route Model
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded uppercase">
                Simulated
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">
              An illustrative great-circle path to a target. Browsers cannot traceroute, so the
              intermediate hops are modelled rather than measured.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-amber-300 group-hover:translate-x-1 transition-transform">
              <span>Open route model</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Port Scanner */}
          <div
            onClick={() => setActiveTab('portscanner')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
              <Radar className="w-5 h-5" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                Local Port Scanner
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded uppercase">
                BETA
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">
              Probe host IPs, dev servers, or subnets for open TCP socket services using browser resources.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Scanner</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* GeoIP Geolocation Inspector */}
          <div
            onClick={() => setActiveTab('geoip')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
              <Compass className="w-5 h-5" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                GeoIP & ISP Inspector
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">
              Inspect physical coordinates, country flags, ISP / Autonomous System (ASN), and proxy/VPN security status for any IP or domain.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform">
              <span>Launch GeoIP Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Speed Test */}
          <div
            onClick={() => setActiveTab('speedtest')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
              <Gauge className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-cyan-400 transition-colors">
              Speed & Bandwidth Test
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Measure real-time download/upload throughput, peak Mbps, and bufferbloat under load.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Ping & Jitter */}
          <div
            onClick={() => setActiveTab('ping')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-3 group-hover:bg-blue-500 group-hover:text-slate-950 transition-colors">
              <Radio className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-blue-400 transition-colors">
              Ping & Jitter Monitor
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Multi-sample HTTP latency benchmarks, packet loss calculations, and real-time interval graphs.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-blue-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* DoH DNS Resolver */}
          <div
            onClick={() => setActiveTab('dns')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-3 group-hover:bg-purple-500 group-hover:text-slate-950 transition-colors">
              <Globe className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-purple-400 transition-colors">
              DoH DNS Resolver
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Query A, AAAA, MX, TXT, and CNAME records directly using Cloudflare & Google DNS-over-HTTPS.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-purple-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* WebRTC Candidate Gatherer */}
          <div
            onClick={() => setActiveTab('webrtc')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-amber-400 transition-colors">
              WebRTC STUN Analyzer
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Inspect ICE candidates, public reflexive IPs, local interface candidates, and NAT type inference.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-amber-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* CIDR Subnet Calculator */}
          <div
            onClick={() => setActiveTab('cidr')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-3 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
              <Calculator className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-emerald-400 transition-colors">
              CIDR Subnet Calculator
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Calculate usable host ranges, broadcast addresses, wildcard masks, and binary representation.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* MAC Address / OUI Vendor */}
          <div
            onClick={() => setActiveTab('mac')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3 group-hover:bg-rose-500 group-hover:text-slate-950 transition-colors">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-rose-400 transition-colors">
              MAC / OUI Lookup
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Identify hardware manufacturer from MAC addresses using local OUI database dictionary.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-rose-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* HTTP Reachability Probe */}
          <div
            onClick={() => setActiveTab('httpprobe')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3 group-hover:bg-indigo-500 group-hover:text-slate-950 transition-colors">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-indigo-400 transition-colors">
              HTTP Probe & CORS Analyzer
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Probe endpoint availability, inspect CORS header permissions, and measure server response latency.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-indigo-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* WebSocket Tester */}
          <div
            onClick={() => setActiveTab('websocket')}
            className="group bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center mb-3 group-hover:bg-teal-500 group-hover:text-slate-950 transition-colors">
              <Terminal className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1 group-hover:text-teal-400 transition-colors">
              WebSocket Latency Tester
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Connect to WebSocket endpoints, measure handshake timing, and perform live message ping loops.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-teal-400 group-hover:translate-x-1 transition-transform">
              <span>Launch Tool</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>

          {/* Data Export & ZIP Bundler */}
          <div
            onClick={() => setActiveTab('export')}
            className="group bg-gradient-to-br from-emerald-950/30 via-slate-900 to-slate-900 border border-emerald-500/30 hover:border-emerald-400 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <Archive className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="flex items-center space-x-2 mb-1">
              <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">
                Data Export & ZIP Bundler
              </h3>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded uppercase">
                New
              </span>
            </div>
            <p className="text-xs text-slate-300 line-clamp-2">
              Export diagnostic test data into individual CSV files per test type or download a bundled ZIP archive.
            </p>
            <div className="mt-4 flex items-center text-xs font-semibold text-emerald-400 group-hover:translate-x-1 transition-transform">
              <span>Open Export Page</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Log Stream */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Recent Local Storage Diagnostic History
            </h2>
          </div>
          <button
            onClick={() => setActiveTab('history')}
            className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
          >
            <span>View All Logs</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            No diagnostic history recorded yet. Run a speed test or ping query to save local logs!
          </div>
        ) : (
          <div className="space-y-3">
            {history.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-xl text-xs transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-700 text-slate-300 border border-slate-600">
                    {item.type}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-200">{item.title}</div>
                    <div className="text-slate-400 text-[11px] font-mono">{item.summary}</div>
                  </div>
                </div>

                <div className="text-right text-[11px] text-slate-400 font-mono">
                  <div className="flex items-center space-x-1 justify-end text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executeFullAudit();
        }}
      />
    </div>
  );
};
