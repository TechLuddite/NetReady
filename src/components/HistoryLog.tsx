import React, { useState } from 'react';
import { History, Download, Trash2, Search, FileJson, FileSpreadsheet, HardDrive, Clock, ShieldCheck, AlertCircle } from 'lucide-react';
import { HistoryItem } from '../types';
import {
  deleteHistoryItem,
  clearAllHistory,
  exportHistoryAsJson,
  exportHistoryAsCsv,
  getLocalStorageSizeBytes,
} from '../utils/storage';

interface HistoryLogProps {
  history: HistoryItem[];
  onHistoryUpdate: () => void;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({ history, onHistoryUpdate }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const kbUsed = (getLocalStorageSizeBytes() / 1024).toFixed(1);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteHistoryItem(id);
    onHistoryUpdate();
    if (selectedItem?.id === id) setSelectedItem(null);
  };

  const handleClearAll = () => {
    clearAllHistory();
    onHistoryUpdate();
    setSelectedItem(null);
    setConfirmClear(false);
  };

  const filteredHistory = history.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.summary.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || item.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <History className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-100">
              Persistent Local Storage Logs
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            100% client-side persistence in browser <code className="text-cyan-400 font-mono">localStorage</code>. Data stays in your browser across page refreshes and browser restarts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportHistoryAsJson}
            disabled={history.length === 0}
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40"
          >
            <FileJson className="w-4 h-4 text-cyan-400" />
            <span>Export JSON</span>
          </button>

          <button
            onClick={exportHistoryAsCsv}
            disabled={history.length === 0}
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>

          {confirmClear ? (
            <button
              onClick={handleClearAll}
              className="flex items-center space-x-1 bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-md"
            >
              <AlertCircle className="w-4 h-4" />
              <span>Confirm Clear?</span>
            </button>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={history.length === 0}
              className="flex items-center space-x-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 px-3 py-2 rounded-xl text-xs transition-colors border border-transparent hover:border-rose-500/30 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear History</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search diagnostic logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Storage Meter Indicator */}
          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 text-slate-400">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            <span>LocalStorage Used: <strong className="text-white">{kbUsed} KB</strong> ({history.length} records)</span>
          </div>
        </div>

        {/* Type Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/5">
          {['all', 'tracert', 'portscanner', 'speedtest', 'ping', 'dns', 'webrtc', 'cidr', 'mac', 'httpprobe', 'websocket'].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-lg text-xs font-mono uppercase transition-colors ${
                typeFilter === t
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                  : 'bg-white/5 hover:bg-white/10 text-slate-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* History Items Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 text-xs font-mono">
              No matching diagnostic logs found in local storage.
            </div>
          ) : (
            filteredHistory.map((item) => {
              const isSelected = selectedItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`bg-slate-900 border rounded-2xl p-4 cursor-pointer transition-all hover:border-slate-700 flex items-center justify-between shadow-md ${
                    isSelected ? 'border-cyan-500 bg-slate-800/80 shadow-cyan-500/10' : 'border-slate-800'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-800 text-cyan-400 border border-slate-700">
                        {item.type}
                      </span>
                      <h3 className="text-sm font-bold text-slate-200">{item.title}</h3>
                    </div>
                    <p className="text-xs text-slate-400 font-mono">{item.summary}</p>
                  </div>

                  <div className="flex items-center space-x-3 pl-4">
                    <div className="text-right text-[11px] text-slate-500 font-mono hidden sm:block">
                      <div className="flex items-center space-x-1 justify-end">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div>{new Date(item.timestamp).toLocaleTimeString()}</div>
                    </div>

                    <button
                      onClick={(e) => handleDelete(item.id, e)}
                      className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                      title="Delete Record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Record Inspector Drawer */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl h-fit sticky top-24">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-4 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Record Payload Inspector</span>
          </h2>

          {selectedItem ? (
            <div className="space-y-4 font-mono text-xs">
              <div>
                <div className="text-slate-400 text-[10px] uppercase">Title</div>
                <div className="text-slate-100 font-bold text-sm">{selectedItem.title}</div>
              </div>

              <div>
                <div className="text-slate-400 text-[10px] uppercase">Timestamp</div>
                <div className="text-cyan-400">{new Date(selectedItem.timestamp).toLocaleString()}</div>
              </div>

              <div>
                <div className="text-slate-400 text-[10px] uppercase mb-1">Stored Payload JSON</div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-emerald-400 overflow-x-auto max-h-80">
                  <pre>{JSON.stringify(selectedItem.data, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-xs text-center py-12 border border-dashed border-slate-800 rounded-xl">
              Click any log record on the left to inspect its complete JSON payload.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
