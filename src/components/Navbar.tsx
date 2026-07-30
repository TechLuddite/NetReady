import React, { useState } from 'react';
import {
  Activity,
  Gauge,
  Globe,
  Radio,
  Cpu,
  Calculator,
  Search,
  Server,
  Terminal,
  History,
  Wifi,
  WifiOff,
  HardDrive,
  Radar,
  ShieldCheck,
  Heart,
  GitCommit,
  Archive,
  AlertTriangle,
  Compass,
} from 'lucide-react';
import { ToolTab, NetworkConnectionInfo } from '../types';
import { PrivacySafetyModal } from './PrivacySafetyModal';
import { DevSupportModal } from './DevSupportModal';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';

interface NavbarProps {
  activeTab: ToolTab;
  setActiveTab: (tab: ToolTab) => void;
  connInfo: NetworkConnectionInfo;
  storageBytes: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  connInfo,
  storageBytes,
}) => {
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showDevSupportModal, setShowDevSupportModal] = useState(false);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  const tabs: { id: ToolTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'tracert', label: 'Tracert Hop Map', icon: GitCommit },
    { id: 'portscanner', label: 'Port Scanner', icon: Radar },
    { id: 'geoip', label: 'GeoIP Lookup', icon: Compass },
    { id: 'speedtest', label: 'Speed Test', icon: Gauge },
    { id: 'ping', label: 'Ping & Jitter', icon: Radio },
    { id: 'dns', label: 'DoH DNS', icon: Globe },
    { id: 'webrtc', label: 'WebRTC STUN', icon: Cpu },
    { id: 'cidr', label: 'CIDR Subnet', icon: Calculator },
    { id: 'mac', label: 'MAC / OUI', icon: Search },
    { id: 'httpprobe', label: 'HTTP Probe', icon: Server },
    { id: 'websocket', label: 'WebSocket', icon: Terminal },
    { id: 'history', label: 'Storage Logs', icon: History },
    { id: 'export', label: 'Data Export', icon: Archive },
  ];

  const kbUsed = (storageBytes / 1024).toFixed(1);

  return (
    <>
      <header className="bg-black/40 backdrop-blur-md border-b border-white/5 sticky top-0 z-50 text-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top Brand Bar */}
          <div className="flex items-center justify-between h-16 border-b border-white/5">
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="w-9 h-9 rounded-xl bg-cyan-500 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                <Activity className="w-5 h-5 text-black font-bold" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xl font-bold tracking-tight text-white">
                    NetReady<span className="text-cyan-500">.local</span>
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full uppercase tracking-wider">
                    Client-Side Workstation
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  Browser-Native Diagnostics & Port Scanner Engine
                </p>
              </div>
            </div>

            {/* Action Buttons & Status Indicators */}
            <div className="flex items-center space-x-2.5">
              {/* Responsible Networking Warning Button */}
              <button
                onClick={() => setShowResponsibleModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 transition-all cursor-pointer"
                title="Responsible Networking & Scanning Disclaimer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="hidden sm:inline font-semibold">Authorized Use Only</span>
              </button>

              {/* Privacy & Safety Modal Button */}
              <button
                onClick={() => setShowPrivacyModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition-all cursor-pointer"
                title="View Privacy & Safety Statement"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline font-semibold">Privacy & Safety</span>
              </button>

              {/* Support / Donate Modal Button */}
              <button
                onClick={() => setShowDevSupportModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition-all cursor-pointer"
                title="Support Open Source Development"
              >
                <Heart className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span className="hidden sm:inline font-semibold">Support Dev</span>
              </button>

              {/* Online Badge */}
              <div
                className={`hidden lg:flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono border uppercase tracking-wider ${
                  connInfo.isOnline
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${connInfo.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {connInfo.isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Persistence Active</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline Mode</span>
                  </>
                )}
              </div>

              {/* Downlink Speed Badge */}
              {connInfo.downlink && (
                <div className="hidden xl:flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white/5 border border-white/10 text-slate-300">
                  <span className="text-slate-400">Est. Downlink:</span>
                  <span className="font-semibold text-cyan-400">{connInfo.downlink} Mbps</span>
                </div>
              )}

              {/* Storage Meter */}
              <button
                onClick={() => setActiveTab('history')}
                className="hidden md:flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors"
                title="LocalStorage Persistence Usage"
              >
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-slate-300">{kbUsed} KB Saved</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 overflow-x-auto py-2.5 scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 ${
                    isActive
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Modals */}
      <PrivacySafetyModal isOpen={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} />
      <DevSupportModal isOpen={showDevSupportModal} onClose={() => setShowDevSupportModal(false)} />
      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => setShowResponsibleModal(false)}
        forceRequireCheck={false}
      />
    </>
  );
};
