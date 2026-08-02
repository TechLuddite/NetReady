import React, { useState } from 'react';
import { Server, Play, RefreshCw } from 'lucide-react';
import { HttpProbeResult, HistoryItem } from '../types';
import { probeHttpEndpoint } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface HttpProbeProps {
  onHistoryUpdate: () => void;
}

const SAMPLE_PROBES = [
  'https://api.github.com',
  'https://httpbin.org/get',
  'https://cloudflare.com',
  'https://dns.google',
  '/index.html',
];

export const HttpProbe: React.FC<HttpProbeProps> = ({ onHistoryUpdate }) => {
  const [url, setUrl] = useState('https://api.github.com');
  const [isProbing, setIsProbing] = useState(false);
  const [result, setResult] = useState<HttpProbeResult | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);
  const [pendingTargetUrl, setPendingTargetUrl] = useState<string | null>(null);

  const executeProbe = async (targetUrlInput?: string) => {
    const targetUrl = targetUrlInput || pendingTargetUrl || url;
    if (!targetUrl.trim()) return;

    setIsProbing(true);
    setResult(null);

    try {
      const res = await probeHttpEndpoint(targetUrl);
      setResult(res);

      // Save to LocalStorage
      const item: HistoryItem = {
        id: res.id,
        type: 'httpprobe',
        timestamp: res.timestamp,
        title: `HTTP Probe: ${res.url}`,
        summary: res.isOk
          ? `Status ${res.status} OK | Latency: ${res.responseTimeMs} ms | CORS Allowed`
          : `CORS / Network Error: ${res.error || 'Blocked'}`,
        data: res,
      };

      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('HTTP Probe error:', e);
    } finally {
      setIsProbing(false);
      setPendingTargetUrl(null);
    }
  };

  const handleRunProbe = (overrideUrl?: string) => {
    const targetUrl = overrideUrl || url;
    setPendingTargetUrl(targetUrl);
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    executeProbe(targetUrl);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Server className="w-5 h-5 text-indigo-400" />
            <h1 className="text-xl font-bold text-slate-100">
              HTTP Reachability & CORS Probe
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Test custom web endpoints for status codes, CORS accessibility, TTFB latency, and header security settings directly from the browser.
          </p>
        </div>

        <button
          onClick={() => handleRunProbe()}
          disabled={isProbing}
          className="flex items-center space-x-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-indigo-500/20 active:scale-95 disabled:opacity-50"
        >
          {isProbing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Probing Endpoint...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Probe Endpoint</span>
            </>
          )}
        </button>
      </div>

      {/* Input Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 mr-1">Presets:</span>
          {SAMPLE_PROBES.map((sample) => (
            <button
              key={sample}
              onClick={() => {
                setUrl(sample);
                handleRunProbe(sample);
              }}
              className="px-3 py-1 rounded-full text-xs font-mono bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Target Endpoint URL:
          </label>
          <input
            type="text"
            placeholder="e.g. https://api.mycompany.com/v1/health"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunProbe()}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Results Box */}
      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
            <div>
              <div className="text-xs text-slate-400 font-mono uppercase">Target URL</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5 break-all">
                {result.url}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <span
                className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold ${
                  result.isOk
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {result.status ? `Status ${result.status}` : 'Fetch Blocked'}
              </span>

              <span className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-indigo-400 font-bold">
                {result.responseTimeMs} ms
              </span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="text-slate-400 uppercase text-[11px] mb-1">CORS & Security State</div>
              <div className="flex justify-between border-b border-slate-800 pb-1.5">
                <span className="text-slate-400">CORS Allowed:</span>
                <span className={result.corsAllowed ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {result.corsAllowed ? 'Yes (Access-Control-Allow-Origin)' : 'No / Restricted'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Response Status:</span>
                <span className="text-slate-100 font-bold">{result.statusText || 'N/A'}</span>
              </div>
            </div>

            {result.error && (
              <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-xl text-rose-300 text-xs font-mono">
                <div className="font-bold mb-1">Error Diagnostic:</div>
                <div>{result.error}</div>
              </div>
            )}
          </div>

          {/* Headers List */}
          {result.headers && Object.keys(result.headers).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Exposed HTTP Headers
              </h3>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs space-y-1.5">
                {Object.entries(result.headers).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-800/60 pb-1">
                    <span className="text-indigo-400 font-semibold">{k}:</span>
                    <span className="text-slate-200 truncate max-w-md">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          executeProbe();
        }}
      />
    </div>
  );
};
