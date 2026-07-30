import React, { useState } from 'react';
import { Cpu, Play, RefreshCw, ShieldAlert, Wifi, Globe, CheckCircle2 } from 'lucide-react';
import { WebRtcResult, HistoryItem } from '../types';
import { gatherWebRtcCandidates } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';

interface WebRtcAnalyzerProps {
  onHistoryUpdate: () => void;
}

const STUN_PRESETS = [
  { label: 'Google STUN 1', url: 'stun:stun.l.google.com:19302' },
  { label: 'Google STUN 2', url: 'stun:stun1.l.google.com:19302' },
  { label: 'Cloudflare STUN', url: 'stun:stun.cloudflare.com:3478' },
  { label: 'Mozilla STUN', url: 'stun:stun.services.mozilla.com' },
];

export const WebRtcAnalyzer: React.FC<WebRtcAnalyzerProps> = ({ onHistoryUpdate }) => {
  const [selectedStun, setSelectedStun] = useState(STUN_PRESETS[0].url);
  const [customStun, setCustomStun] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<WebRtcResult | null>(null);

  const handleRunScan = async () => {
    setIsScanning(true);
    setResult(null);

    const stunUrl = customStun.trim() || selectedStun;

    try {
      const res = await gatherWebRtcCandidates(stunUrl);
      setResult(res);

      // Save to LocalStorage
      const item: HistoryItem = {
        id: res.id,
        type: 'webrtc',
        timestamp: res.timestamp,
        title: `WebRTC Scan: ${res.candidates.length} ICE Candidates`,
        summary: `Public IPs: ${res.publicIps.join(', ') || 'None'} | NAT: ${res.natTypeInference}`,
        data: res,
      };

      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('WebRTC gather failed:', e);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Cpu className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-slate-100">
              WebRTC & STUN ICE Candidate Analyzer
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Inspect real-time ICE candidate gathering, discover public server-reflexive (srflx) IPs, local host IPs, protocol bindings, and infer NAT firewall types.
          </p>
        </div>

        <button
          onClick={handleRunScan}
          disabled={isScanning}
          className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
        >
          {isScanning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Gathering Candidates...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Inspect ICE Candidates</span>
            </>
          )}
        </button>
      </div>

      {/* STUN Server Config */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          STUN Server Endpoint
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STUN_PRESETS.map((preset) => {
            const isSelected = selectedStun === preset.url && !customStun;
            return (
              <button
                key={preset.url}
                onClick={() => {
                  setSelectedStun(preset.url);
                  setCustomStun('');
                }}
                className={`p-3 rounded-xl text-xs font-medium text-left transition-all border ${
                  isSelected
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                }`}
              >
                <div className="font-semibold">{preset.label}</div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{preset.url}</div>
              </button>
            );
          })}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Or Custom STUN URL:</label>
          <input
            type="text"
            placeholder="e.g. stun:stun.mycompany.com:3478"
            value={customStun}
            onChange={(e) => setCustomStun(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
          />
        </div>
      </div>

      {/* Discovered IP Cards */}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Public Reflexive IP */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">
              <Globe className="w-4 h-4" />
              <span>Public Reflexive IP (srflx)</span>
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {result.publicIps.length > 0 ? result.publicIps.join(', ') : 'Not Discovered'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Exposed by STUN Server via NAT</div>
          </div>

          {/* Local Interface Candidate */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-cyan-400 mb-2">
              <Wifi className="w-4 h-4" />
              <span>Local Candidates (host)</span>
            </div>
            <div className="text-xl font-bold font-mono text-white truncate">
              {result.localIps.length > 0 ? result.localIps.join(', ') : 'mDNS / Anonymized'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Local Network Interface</div>
          </div>

          {/* NAT Firewall Type */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
              <ShieldAlert className="w-4 h-4" />
              <span>NAT Firewall Inference</span>
            </div>
            <div className="text-sm font-bold text-slate-200 line-clamp-2">
              {result.natTypeInference}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Gathered in {result.gatheringTimeMs} ms
            </div>
          </div>
        </div>
      )}

      {/* ICE Candidate Table */}
      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl overflow-x-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Gathered ICE Candidates ({result.candidates.length})
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              STUN: {result.stunServer}
            </span>
          </div>

          {result.candidates.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs font-mono">
              No ICE candidates gathered. Browser WebRTC permissions or firewall may restrict UDP STUN requests.
            </div>
          ) : (
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                  <th className="pb-3 px-3">Type</th>
                  <th className="pb-3 px-3">Protocol</th>
                  <th className="pb-3 px-3">IP Address</th>
                  <th className="pb-3 px-3">Port</th>
                  <th className="pb-3 px-3">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {result.candidates.map((cand, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-bold">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] uppercase ${
                          cand.type === 'srflx'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : cand.type === 'host'
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {cand.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 uppercase text-slate-300">{cand.protocol}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-100">{cand.ip || 'Anonymized'}</td>
                    <td className="py-2.5 px-3 text-slate-400">{cand.port || '--'}</td>
                    <td className="py-2.5 px-3 text-slate-500">{cand.priority || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
