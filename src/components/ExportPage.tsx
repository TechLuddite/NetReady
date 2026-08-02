import React, { useState, useMemo } from 'react';
import {
  Download,
  FileSpreadsheet,
  Archive,
  CheckSquare,
  Square,
  Filter,
  FileText,
  Search,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  GitCommit,
  Gauge,
  Radio,
  Radar,
  Globe,
  ShieldCheck,
  Zap,
  Activity,
  Calculator,
  Search as SearchIcon,
  HardDrive,
} from 'lucide-react';
import { HistoryItem } from '../types';
import {
  getHistory,
  clearAllHistory,
  getLocalStorageSizeBytes,
} from '../utils/storage';
import {
  TEST_TYPES,
  exportSingleCsv,
  exportBundledZip,
  generateMasterSummaryCsv,
  getCsvForType,
} from '../utils/export';

interface ExportPageProps {
  onHistoryUpdate: () => void;
}

export const ExportPage: React.FC<ExportPageProps> = ({ onHistoryUpdate }) => {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => getHistory());
  const [selectedTypes, setSelectedTypes] = useState<string[]>(
    TEST_TYPES.map((t) => t.id)
  );
  const [dateFilter, setDateFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewType, setPreviewType] = useState<string>('master');
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  // Reload history
  const reloadHistory = () => {
    const updated = getHistory();
    setHistoryItems(updated);
    onHistoryUpdate();
  };

  // Icon Map Helper
  const renderIcon = (typeId: string, className: string = 'w-5 h-5') => {
    switch (typeId) {
      case 'tracert':
        return <GitCommit className={`${className} rotate-90 text-cyan-400`} />;
      case 'speedtest':
        return <Gauge className={`${className} text-amber-400`} />;
      case 'ping':
        return <Radio className={`${className} text-emerald-400`} />;
      case 'portscanner':
        return <Radar className={`${className} text-rose-400`} />;
      case 'dns':
        return <Globe className={`${className} text-blue-400`} />;
      case 'webrtc':
        return <ShieldCheck className={`${className} text-purple-400`} />;
      case 'httpprobe':
        return <Zap className={`${className} text-yellow-400`} />;
      case 'websocket':
        return <Activity className={`${className} text-pink-400`} />;
      case 'cidr':
        return <Calculator className={`${className} text-indigo-400`} />;
      case 'mac':
        return <SearchIcon className={`${className} text-teal-400`} />;
      default:
        return <FileSpreadsheet className={`${className} text-slate-400`} />;
    }
  };

  // Filter items by Date Range and Search Query
  const filteredItems = useMemo(() => {
    let result = historyItems;

    // Date Filter
    if (dateFilter !== 'all') {
      const now = Date.now();
      const cutoff =
        dateFilter === '24h'
          ? now - 24 * 60 * 60 * 1000
          : dateFilter === '7d'
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;

      result = result.filter((item) => item.timestamp >= cutoff);
    }

    // Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.summary && item.summary.toLowerCase().includes(q)) ||
          item.type.toLowerCase().includes(q)
      );
    }

    return result;
  }, [historyItems, dateFilter, searchQuery]);

  // Group counts by type
  const countsByType = useMemo(() => {
    const map: Record<string, number> = {};
    TEST_TYPES.forEach((t) => (map[t.id] = 0));

    filteredItems.forEach((item) => {
      map[item.type] = (map[item.type] || 0) + 1;
    });

    return map;
  }, [filteredItems]);

  // Toggle type checkbox selection
  const toggleTypeSelect = (typeId: string) => {
    if (selectedTypes.includes(typeId)) {
      setSelectedTypes(selectedTypes.filter((t) => t !== typeId));
    } else {
      setSelectedTypes([...selectedTypes, typeId]);
    }
  };

  const selectAllTypes = () => setSelectedTypes(TEST_TYPES.map((t) => t.id));
  const deselectAllTypes = () => setSelectedTypes([]);

  // Handle Bundled ZIP Export
  const handleExportZip = async () => {
    setIsZipping(true);
    try {
      await exportBundledZip(filteredItems, selectedTypes);
    } catch (e) {
      console.error('ZIP export error:', e);
    } finally {
      setIsZipping(false);
    }
  };

  // Handle Master CSV Export
  const handleExportMasterCsv = () => {
    const activeItems = filteredItems.filter((i) => selectedTypes.includes(i.type));
    const csvContent = generateMasterSummaryCsv(activeItems);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `netready_master_summary_${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Preview CSV Text generator
  const activePreviewText = useMemo(() => {
    const activeItems = filteredItems.filter((i) => selectedTypes.includes(i.type));
    if (previewType === 'master') {
      return generateMasterSummaryCsv(activeItems);
    }
    return getCsvForType(activeItems, previewType);
  }, [filteredItems, selectedTypes, previewType]);

  const handleCopyPreview = () => {
    navigator.clipboard.writeText(activePreviewText);
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 2000);
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear all diagnostic history records?')) {
      clearAllHistory();
      reloadHistory();
    }
  };

  const storageBytes = getLocalStorageSizeBytes();
  const storageKb = (storageBytes / 1024).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Archive className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-100">
              Data Export & Diagnostic Bundler
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full uppercase">
              CSV & ZIP Export
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Export diagnostic reports for Traceroute, Speed Tests, Port Scans, DNS, and WebRTC. Download individual CSV files per test type or package everything into a single, bundled ZIP archive.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Export Master CSV Button */}
          <button
            onClick={handleExportMasterCsv}
            disabled={filteredItems.length === 0}
            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-xs transition-all disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Master Summary CSV</span>
          </button>

          {/* Export Bundled ZIP Button */}
          <button
            onClick={handleExportZip}
            disabled={filteredItems.length === 0 || isZipping}
            className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-40"
          >
            {isZipping ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Creating ZIP...</span>
              </>
            ) : (
              <>
                <Archive className="w-4 h-4" />
                <span>Export Bundled ZIP</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Control Filters & Options Strip */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
            <Filter className="w-4 h-4 text-cyan-400" />
            <span>Select Test Types to Include ({selectedTypes.length}/{TEST_TYPES.length})</span>
          </h2>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <button
              onClick={selectAllTypes}
              className="text-cyan-400 hover:underline"
            >
              Select All
            </button>
            <span className="text-slate-600">•</span>
            <button
              onClick={deselectAllTypes}
              className="text-slate-400 hover:underline"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Test Type Selectable Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
          {TEST_TYPES.map((t) => {
            const isChecked = selectedTypes.includes(t.id);
            const count = countsByType[t.id] || 0;

            return (
              <button
                key={t.id}
                onClick={() => toggleTypeSelect(t.id)}
                className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                  isChecked
                    ? 'bg-slate-800/90 border-cyan-500/50 text-slate-100 shadow-sm'
                    : 'bg-slate-950/40 border-slate-800 text-slate-500 opacity-60 hover:opacity-100'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  {renderIcon(t.id, 'w-4 h-4 shrink-0')}
                  <span className="text-xs font-medium truncate">{t.label.split(' ')[0]}</span>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    count > 0 ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {count}
                  </span>
                  {isChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-600" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filters Row: Date Range & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80">
          <div>
            <label className="block text-xs text-slate-400 mb-1 font-mono">
              Date Range Filter:
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="all">All Time History</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-1 font-mono">
              Search Diagnostic Keywords / Target Host:
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter history by target IP, domain, or test title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Individual Test Type CSV Export Cards Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Individual Test Type Export Options</span>
          </h2>

          <span className="text-xs text-slate-400 font-mono">
            Download individual formatted CSVs per diagnostic test
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
          {TEST_TYPES.map((t) => {
            const typeItems = filteredItems.filter((i) => i.type === t.id);
            const count = typeItems.length;
            const latestItem = typeItems[0];

            return (
              <div
                key={t.id}
                className={`bg-slate-900 border rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all ${
                  count > 0 ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/60 opacity-70'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                        {renderIcon(t.id, 'w-5 h-5')}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">{t.label}</h3>
                        <div className="text-[10px] font-mono text-slate-400">File: {t.filename}</div>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold ${
                        count > 0
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {count} {count === 1 ? 'record' : 'records'}
                    </span>
                  </div>

                  {latestItem ? (
                    <div className="my-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 font-mono text-[11px] space-y-1">
                      <div className="flex justify-between text-slate-400 text-[10px]">
                        <span>Latest Diagnostic Result:</span>
                        <span>{new Date(latestItem.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="font-semibold text-slate-200 truncate">{latestItem.title}</div>
                      <div className="text-slate-400 truncate text-[10px]">{latestItem.summary}</div>
                    </div>
                  ) : (
                    <div className="my-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/40 text-center font-mono text-slate-500 text-[11px]">
                      No recorded diagnostic tests for {t.label.split(' ')[0]} yet.
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setPreviewType(t.id)}
                    className="text-xs font-mono text-slate-400 hover:text-cyan-400 flex items-center space-x-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Preview CSV</span>
                  </button>

                  <button
                    onClick={() => exportSingleCsv(filteredItems, t.id, t.filename)}
                    disabled={count === 0}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold font-mono transition-all disabled:opacity-30 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download CSV</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CSV Content Live Preview Modal / Inspector Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              CSV Live Data Preview ({previewType.toUpperCase()})
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            <select
              value={previewType}
              onChange={(e) => setPreviewType(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300 font-mono"
            >
              <option value="master">Master Summary CSV</option>
              {TEST_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} CSV
                </option>
              ))}
            </select>

            <button
              onClick={handleCopyPreview}
              className="flex items-center space-x-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-mono transition-colors"
            >
              {copiedPreview ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy CSV</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-64 leading-relaxed shadow-inner">
          <pre>{activePreviewText || 'No diagnostic records found for selected preview.'}</pre>
        </div>
      </div>

      {/* Local Storage & History Management Strip */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
            <HardDrive className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-200 uppercase font-mono">
              Diagnostic Storage Capacity
            </div>
            <div className="text-xs text-slate-400">
              Total stored items: <span className="text-white font-mono font-bold">{historyItems.length}</span> ({storageKb} KB of LocalStorage used)
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={reloadHistory}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-mono transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh State</span>
          </button>

          <button
            onClick={handleClearHistory}
            className="flex items-center space-x-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-mono transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        </div>
      </div>
    </div>
  );
};
