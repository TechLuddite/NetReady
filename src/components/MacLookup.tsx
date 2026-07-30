import React, { useState } from 'react';
import { Search, Copy, CheckCircle2, Bookmark, ShieldCheck, HardDrive } from 'lucide-react';
import { parseAndLookupMac } from '../utils/oui';
import { HistoryItem } from '../types';
import { saveHistoryItem } from '../utils/storage';

interface MacLookupProps {
  onHistoryUpdate: () => void;
}

const SAMPLE_MACS = [
  { label: 'Raspberry Pi', mac: 'DC:A6:32:00:11:22' },
  { label: 'Apple iPhone', mac: 'AC:BC:32:12:34:56' },
  { label: 'Cisco Router', mac: '00:00:0C:99:88:77' },
  { label: 'Google Chromecast', mac: '30:FD:38:AA:BB:CC' },
  { label: 'TP-Link Wi-Fi', mac: '18:66:DA:44:55:66' },
  { label: 'Ubiquiti AP', mac: '80:2A:A8:11:22:33' },
];

export const MacLookup: React.FC<MacLookupProps> = ({ onHistoryUpdate }) => {
  const [inputMac, setInputMac] = useState('DC:A6:32:00:11:22');
  const [copied, setCopied] = useState(false);

  const lookupResult = parseAndLookupMac(inputMac);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveToHistory = () => {
    if (!lookupResult) return;
    const item: HistoryItem = {
      id: 'mac_' + Date.now(),
      type: 'mac',
      timestamp: Date.now(),
      title: `MAC Lookup: ${lookupResult.mac}`,
      summary: `Vendor: ${lookupResult.vendor} | OUI: ${lookupResult.oui}`,
      data: lookupResult,
    };
    saveHistoryItem(item);
    onHistoryUpdate();
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Search className="w-5 h-5 text-rose-400" />
            <h1 className="text-xl font-bold text-slate-100">
              MAC Address & OUI Vendor Search
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Offline hardware vendor detection engine using IEEE Organizationally Unique Identifier (OUI) dictionary parsing.
          </p>
        </div>

        {lookupResult.isKnown && (
          <button
            onClick={handleSaveToHistory}
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors"
          >
            <Bookmark className="w-4 h-4 text-rose-400" />
            <span>Save Lookup Log</span>
          </button>
        )}
      </div>

      {/* Input Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        {/* Quick Sample Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 mr-1">Sample MACs:</span>
          {SAMPLE_MACS.map((sample) => (
            <button
              key={sample.label}
              onClick={() => setInputMac(sample.mac)}
              className="px-3 py-1 rounded-full text-xs font-mono bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-colors"
            >
              {sample.label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Enter MAC Address or 6-Hex OUI Prefix:
          </label>
          <input
            type="text"
            placeholder="e.g. 00:1A:2B:3C:4D:5E or 001A2B3C4D5E"
            value={inputMac}
            onChange={(e) => setInputMac(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-base text-slate-100 font-mono focus:outline-none focus:border-rose-500"
          />
        </div>
      </div>

      {/* Result Display */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Identified Vendor</div>
            <div className="text-2xl font-extrabold text-white mt-1">
              {lookupResult.vendor}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <span className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-sm text-rose-400 font-bold">
              OUI: {lookupResult.oui || 'N/A'}
            </span>

            <button
              onClick={() => copyToClipboard(lookupResult.mac)}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              title="Copy Standardized MAC"
            >
              {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Detailed Attributes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px] uppercase mb-1">Standardized Format</div>
            <div className="text-slate-100 font-bold text-sm">{lookupResult.mac}</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px] uppercase mb-1">Address Transmission Type</div>
            <div className="text-slate-100 font-bold text-sm">{lookupResult.addressType}</div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[11px] uppercase mb-1">Administration Scope</div>
            <div className="text-slate-100 font-bold text-sm">{lookupResult.administration}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
