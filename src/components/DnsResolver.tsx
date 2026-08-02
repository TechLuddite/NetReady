import React, { useState } from 'react';
import { Globe, Search, RefreshCw, CheckCircle2, Copy, Code } from 'lucide-react';
import { DnsQueryResult, HistoryItem } from '../types';
import { queryDnsOverHttps } from '../utils/network';
import { saveHistoryItem } from '../utils/storage';

interface DnsResolverProps {
  onHistoryUpdate: () => void;
}

const PRESET_DOMAINS = ['google.com', 'cloudflare.com', 'github.com', 'wikipedia.org', 'apple.com'];
const RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'CAA', 'SOA'];

export const DnsResolver: React.FC<DnsResolverProps> = ({ onHistoryUpdate }) => {
  const [domain, setDomain] = useState('cloudflare.com');
  const [recordType, setRecordType] = useState('A');
  const [provider, setProvider] = useState<'cloudflare' | 'google'>('cloudflare');
  const [isQuerying, setIsQuerying] = useState(false);
  const [result, setResult] = useState<DnsQueryResult | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleLookup = async (overrideDomain?: string) => {
    const targetDomain = overrideDomain || domain;
    if (!targetDomain.trim()) return;

    setIsQuerying(true);
    setResult(null);

    try {
      const res = await queryDnsOverHttps(targetDomain, recordType, provider);
      setResult(res);

      // Save to LocalStorage
      const item: HistoryItem = {
        id: res.id,
        type: 'dns',
        timestamp: res.timestamp,
        title: `DoH DNS (${res.provider.toUpperCase()}): ${res.domain} [${res.recordType}]`,
        summary: `${res.statusText} | ${res.records.length} records found in ${res.responseTimeMs}ms`,
        data: res,
      };

      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('DoH query failed:', e);
    } finally {
      setIsQuerying(false);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Globe className="w-5 h-5 text-purple-400" />
            <h1 className="text-xl font-bold text-slate-100">
              DNS-over-HTTPS (DoH) Resolver
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Query standard DNS records over encrypted HTTPS protocols directly from your browser using Cloudflare or Google DoH backends.
          </p>
        </div>

        <button
          onClick={() => handleLookup()}
          disabled={isQuerying}
          className="flex items-center space-x-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-purple-500/20 active:scale-95 disabled:opacity-50"
        >
          {isQuerying ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Resolving DNS...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4 text-white" />
              <span>Resolve DNS Records</span>
            </>
          )}
        </button>
      </div>

      {/* Query Form Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        {/* Preset Domain Quick Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 mr-1">Presets:</span>
          {PRESET_DOMAINS.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setDomain(preset);
                handleLookup(preset);
              }}
              className="px-3 py-1 rounded-full text-xs font-mono bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Form Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
          {/* Domain Input */}
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Domain Name:</label>
            <input
              type="text"
              placeholder="e.g. google.com or mydomain.org"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {/* Record Type Dropdown */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Record Type:</label>
            <select
              value={recordType}
              onChange={(e) => setRecordType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            >
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t} Record
                </option>
              ))}
            </select>
          </div>

          {/* DoH Provider */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">DoH Provider:</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'cloudflare' | 'google')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            >
              <option value="cloudflare">Cloudflare (1.1.1.1)</option>
              <option value="google">Google Public DNS</option>
            </select>
          </div>
        </div>
      </div>

      {/* Query Results View */}
      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          {/* Summary Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <span className="px-3 py-1 rounded-lg text-xs font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                {result.recordType}
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-100 font-mono">{result.domain}</h2>
                <p className="text-xs text-slate-400">
                  Resolved via {result.provider.toUpperCase()} DoH in {result.responseTimeMs} ms
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <span className={`px-3 py-1 rounded-full text-xs font-mono font-semibold ${
                result.status === 0
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
              }`}>
                {result.statusText}
              </span>

              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="flex items-center space-x-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors border border-slate-700"
              >
                <Code className="w-3.5 h-3.5" />
                <span>{showRawJson ? 'Hide JSON' : 'View Raw JSON'}</span>
              </button>
            </div>
          </div>

          {/* Record List */}
          {result.records.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs font-mono">
              No {result.recordType} records found for {result.domain}.
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Found {result.records.length} Answer Record(s)
              </h3>

              <div className="space-y-2">
                {result.records.map((rec, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800/80 rounded-xl font-mono text-xs hover:border-slate-700 transition-colors"
                  >
                    <div className="space-y-1 overflow-hidden pr-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-purple-400 font-bold">{rec.typeName}</span>
                        <span className="text-slate-500">TTL: {rec.TTL}s</span>
                      </div>
                      <div className="text-slate-200 font-semibold break-all">{rec.data}</div>
                    </div>

                    <button
                      onClick={() => copyToClipboard(rec.data, idx)}
                      className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                      title="Copy Record Data"
                    >
                      {copiedIndex === idx ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON View Modal/Box */}
          {showRawJson && (
            <div className="pt-4 border-t border-slate-800">
              <div className="bg-slate-950 p-4 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto border border-slate-800">
                <pre>{JSON.stringify(result.rawJson, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
