import React, { useState } from 'react';
import { Calculator, Copy, CheckCircle2, Bookmark, Layers } from 'lucide-react';
import { calculateCidr, generateSubnets } from '../utils/cidr';
import { HistoryItem } from '../types';
import { saveHistoryItem } from '../utils/storage';

interface CidrCalculatorProps {
  onHistoryUpdate: () => void;
}

export const CidrCalculator: React.FC<CidrCalculatorProps> = ({ onHistoryUpdate }) => {
  const [ip, setIp] = useState('192.168.1.100');
  const [prefix, setPrefix] = useState<number>(24);
  const [subnetPrefix, setSubnetPrefix] = useState<number>(26);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const cidr = calculateCidr(ip, prefix);
  const subnets = cidr ? generateSubnets(cidr.networkAddress, prefix, subnetPrefix) : [];

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleSaveToHistory = () => {
    if (!cidr) return;
    const item: HistoryItem = {
      id: 'cidr_' + Date.now(),
      type: 'cidr',
      timestamp: Date.now(),
      title: `CIDR: ${cidr.networkAddress}/${cidr.prefix}`,
      summary: `Hosts: ${cidr.usableHosts.toLocaleString()} | Range: ${cidr.firstUsableIp} - ${cidr.lastUsableIp}`,
      data: cidr,
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
            <Calculator className="w-5 h-5 text-emerald-400" />
            <h1 className="text-xl font-bold text-slate-100">
              IPv4 CIDR & Subnet Calculator
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            100% offline client-side IP subnet calculator. Determines network bounds, broadcast addresses, usable host ranges, binary representation, and subnetting plans.
          </p>
        </div>

        {cidr && (
          <button
            onClick={handleSaveToHistory}
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors"
          >
            <Bookmark className="w-4 h-4 text-emerald-400" />
            <span>Save Calculation Log</span>
          </button>
        )}
      </div>

      {/* Input Form Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* IP Input */}
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              IP Address:
            </label>
            <input
              type="text"
              placeholder="e.g. 10.0.0.1 or 192.168.1.50"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Mask / Prefix Slider */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                CIDR Prefix:
              </label>
              <span className="font-mono text-emerald-400 font-bold text-sm">/{prefix}</span>
            </div>
            <input
              type="range"
              min={0}
              max={32}
              value={prefix}
              onChange={(e) => setPrefix(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>/0 (Internet)</span>
              <span>/24 (Class C)</span>
              <span>/32 (Host)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results View */}
      {cidr ? (
        <div className="space-y-6">
          {/* Core Specs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="text-xs text-slate-400 uppercase font-semibold mb-1">Network Address</div>
              <div className="text-lg font-bold font-mono text-emerald-400 flex items-center justify-between">
                <span>{cidr.networkAddress}/{cidr.prefix}</span>
                <button
                  onClick={() => copyToClipboard(`${cidr.networkAddress}/${cidr.prefix}`, 'net')}
                  className="p-1 hover:text-white text-slate-500"
                >
                  {copiedKey === 'net' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="text-xs text-slate-400 uppercase font-semibold mb-1">Subnet Mask</div>
              <div className="text-lg font-bold font-mono text-cyan-400 flex items-center justify-between">
                <span>{cidr.netmask}</span>
                <button
                  onClick={() => copyToClipboard(cidr.netmask, 'mask')}
                  className="p-1 hover:text-white text-slate-500"
                >
                  {copiedKey === 'mask' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="text-xs text-slate-400 uppercase font-semibold mb-1">Usable Host Capacity</div>
              <div className="text-lg font-bold font-mono text-white">
                {cidr.usableHosts.toLocaleString()} Hosts
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">Total: {cidr.totalHosts.toLocaleString()}</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="text-xs text-slate-400 uppercase font-semibold mb-1">IP Classification</div>
              <div className="text-sm font-bold text-slate-200">
                {cidr.ipClass}
              </div>
              <div className="mt-1">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                  cidr.isPrivate ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                }`}>
                  {cidr.isPrivate ? 'Private IP (RFC 1918)' : 'Public Internet IP'}
                </span>
              </div>
            </div>
          </div>

          {/* Detailed Calculations Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Detailed Network Boundaries
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">First Usable Host:</span>
                  <span className="text-slate-100 font-bold">{cidr.firstUsableIp}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Last Usable Host:</span>
                  <span className="text-slate-100 font-bold">{cidr.lastUsableIp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Broadcast Address:</span>
                  <span className="text-rose-400 font-bold">{cidr.broadcastAddress}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Wildcard Mask:</span>
                  <span className="text-slate-100 font-bold">{cidr.wildcard}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Binary IP:</span>
                  <span className="text-emerald-400 font-mono text-[11px]">{cidr.binaryIp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Binary Netmask:</span>
                  <span className="text-cyan-400 font-mono text-[11px]">{cidr.binaryNetmask}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Subnetting Divider Planner */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  Subnet Partitioning Planner
                </h2>
              </div>

              <div className="flex items-center space-x-3">
                <span className="text-xs text-slate-400">Divide /{prefix} into:</span>
                <select
                  value={subnetPrefix}
                  onChange={(e) => setSubnetPrefix(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                >
                  {Array.from({ length: 32 - prefix }, (_, i) => prefix + i + 1).map((p) => (
                    <option key={p} value={p}>
                      /{p} Subnets
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {subnets.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                      <th className="pb-3 px-3">#</th>
                      <th className="pb-3 px-3">Subnet Network</th>
                      <th className="pb-3 px-3">Usable Host Range</th>
                      <th className="pb-3 px-3">Broadcast Address</th>
                      <th className="pb-3 px-3">Hosts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {subnets.map((sub) => (
                      <tr key={sub.subnetIndex} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 text-slate-500">Subnet {sub.subnetIndex}</td>
                        <td className="py-2.5 px-3 font-bold text-cyan-400">
                          {sub.networkAddress}/{sub.prefix}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.firstUsableIp} - {sub.lastUsableIp}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">{sub.broadcastAddress}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-200">
                          {sub.usableHosts}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-rose-400 text-xs font-mono bg-slate-900 border border-slate-800 rounded-2xl">
          Invalid IPv4 address format. Please enter a valid IPv4 address (e.g., 192.168.1.1).
        </div>
      )}
    </div>
  );
};
