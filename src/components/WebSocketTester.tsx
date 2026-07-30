import React, { useState } from 'react';
import { Terminal, Play, RefreshCw, CheckCircle2, AlertCircle, Radio } from 'lucide-react';
import { WebSocketResult, HistoryItem } from '../types';
import { testWebSocket } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';

interface WebSocketTesterProps {
  onHistoryUpdate: () => void;
}

const WS_PRESETS = [
  'wss://echo.websocket.org',
  'wss://ws.postman-echo.com/raw',
];

export const WebSocketTester: React.FC<WebSocketTesterProps> = ({ onHistoryUpdate }) => {
  const [wsUrl, setWsUrl] = useState('wss://echo.websocket.org');
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<WebSocketResult | null>(null);

  const handleTestWs = async (overrideUrl?: string) => {
    const url = overrideUrl || wsUrl;
    if (!url.trim()) return;

    setIsTesting(true);
    setResult(null);

    try {
      const res = await testWebSocket(url);
      setResult(res);

      // Save to LocalStorage
      const item: HistoryItem = {
        id: res.id,
        type: 'websocket',
        timestamp: res.timestamp,
        title: `WebSocket Test: ${res.url}`,
        summary: res.status === 'connected'
          ? `Connected in ${res.handshakeTimeMs} ms | Avg Ping: ${res.avgPingMs} ms`
          : `Connection Error / Closed`,
        data: res,
      };

      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('WebSocket test failed:', e);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Terminal className="w-5 h-5 text-teal-400" />
            <h1 className="text-xl font-bold text-slate-100">
              WebSocket Echo & Latency Tester
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Test persistent WebSocket handshake connection setup times, message frame roundtrip latency, and echo packet reliability.
          </p>
        </div>

        <button
          onClick={() => handleTestWs()}
          disabled={isTesting}
          className="flex items-center space-x-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-teal-500/20 active:scale-95 disabled:opacity-50"
        >
          {isTesting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Connecting & Echoing...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Test WebSocket Connection</span>
            </>
          )}
        </button>
      </div>

      {/* Input Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 mr-1">Presets:</span>
          {WS_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setWsUrl(preset);
                handleTestWs(preset);
              }}
              className="px-3 py-1 rounded-full text-xs font-mono bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
            WebSocket Endpoint (wss:// or ws://):
          </label>
          <input
            type="text"
            placeholder="wss://echo.websocket.org"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTestWs()}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-teal-500"
          />
        </div>
      </div>

      {/* Results View */}
      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
            <div>
              <div className="text-xs text-slate-400 font-mono uppercase">WebSocket URL</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5 break-all">
                {result.url}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <span
                className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold uppercase ${
                  result.status === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {result.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-slate-400 uppercase text-[11px] mb-1">Handshake Setup Latency</div>
              <div className="text-xl font-bold text-teal-400">{result.handshakeTimeMs} ms</div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-slate-400 uppercase text-[11px] mb-1">Average Echo Ping RTT</div>
              <div className="text-xl font-bold text-emerald-400">
                {result.avgPingMs > 0 ? `${result.avgPingMs} ms` : 'N/A'}
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-slate-400 uppercase text-[11px] mb-1">Frames Sent / Received</div>
              <div className="text-xl font-bold text-white">
                {result.messagesSent} / {result.messagesReceived}
              </div>
            </div>
          </div>

          {result.pings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Echo Sequence RTT Logs
              </h3>
              <div className="flex flex-wrap gap-2 font-mono text-xs">
                {result.pings.map((pingMs, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg"
                  >
                    Ping #{idx + 1}: <strong className="text-teal-400">{pingMs} ms</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
