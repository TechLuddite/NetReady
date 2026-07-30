import React, { useState, useEffect } from 'react';
import { ToolTab, NetworkConnectionInfo, HistoryItem } from './types';
import { getNetworkConnectionInfo } from './utils/network';
import { getHistory, getLocalStorageSizeBytes } from './utils/storage';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { TracertVisualizer } from './components/TracertVisualizer';
import { PortScanner } from './components/PortScanner';
import { GeoIpLookup } from './components/GeoIpLookup';
import { SpeedTest } from './components/SpeedTest';
import { PingTester } from './components/PingTester';
import { DnsResolver } from './components/DnsResolver';
import { WebRtcAnalyzer } from './components/WebRtcAnalyzer';
import { CidrCalculator } from './components/CidrCalculator';
import { MacLookup } from './components/MacLookup';
import { HttpProbe } from './components/HttpProbe';
import { WebSocketTester } from './components/WebSocketTester';
import { HistoryLog } from './components/HistoryLog';
import { ExportPage } from './components/ExportPage';
import { ShieldCheck, HardDrive } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<ToolTab>('dashboard');
  const [connInfo, setConnInfo] = useState<NetworkConnectionInfo>(getNetworkConnectionInfo());
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [storageBytes, setStorageBytes] = useState<number>(0);

  const refreshHistory = () => {
    setHistory(getHistory());
    setStorageBytes(getLocalStorageSizeBytes());
  };

  useEffect(() => {
    refreshHistory();

    const handleStatusChange = () => {
      setConnInfo(getNetworkConnectionInfo());
    };

    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', handleStatusChange);
    }

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
      if (connection) {
        connection.removeEventListener('change', handleStatusChange);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050608] text-slate-200 flex flex-col relative overflow-x-hidden font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Immersive UI Background Atmospheric Glows */}
      <div className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-cyan-950/20 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-indigo-950/20 rounded-full blur-[100px] pointer-events-none z-0" />

      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connInfo={connInfo}
        storageBytes={storageBytes}
      />

      {/* Main Workspace Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        {activeTab === 'dashboard' && (
          <Dashboard
            setActiveTab={setActiveTab}
            connInfo={connInfo}
            history={history}
            onHistoryUpdate={refreshHistory}
          />
        )}

        {activeTab === 'tracert' && (
          <TracertVisualizer onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'portscanner' && (
          <PortScanner onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'geoip' && (
          <GeoIpLookup onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'speedtest' && (
          <SpeedTest onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'ping' && (
          <PingTester onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'dns' && (
          <DnsResolver onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'webrtc' && (
          <WebRtcAnalyzer onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'cidr' && (
          <CidrCalculator onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'mac' && (
          <MacLookup onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'httpprobe' && (
          <HttpProbe onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'websocket' && (
          <WebSocketTester onHistoryUpdate={refreshHistory} />
        )}

        {activeTab === 'history' && (
          <HistoryLog
            history={history}
            onHistoryUpdate={refreshHistory}
          />
        )}

        {activeTab === 'export' && (
          <ExportPage onHistoryUpdate={refreshHistory} />
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="border-t border-white/5 bg-black/90 py-4 text-xs text-slate-500 relative z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              <span>NetReady Engine Active</span>
            </span>
            <span className="text-slate-700">|</span>
            <span className="text-[11px] text-slate-400">100% Client-Side Browser Storage</span>
          </div>

          <div className="flex items-center space-x-4 font-mono text-[11px] text-slate-500 uppercase">
            <span className="flex items-center space-x-1">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              <span>Browser Persistence Online</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
