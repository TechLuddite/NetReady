import React, { useState, useRef, useEffect } from 'react';
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
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { ToolTab, NetworkConnectionInfo } from '../types';
import { PrivacySafetyModal } from './PrivacySafetyModal';
import { DevSupportModal } from './DevSupportModal';
import { ResponsibleNetworkingModal } from './ResponsibleNetworkingModal';

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

  const navRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const tabs: { id: ToolTab; label: string; icon: React.FC<{ className?: string }>; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'tracert', label: 'Tracert Hop Map', icon: GitCommit },
    { id: 'portscanner', label: 'Port Scanner', icon: Radar, badge: 'BETA' },
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

  const checkScroll = () => {
    const el = navRef.current;
    if (!el) return;
    const scrollLeft = el.scrollLeft;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < maxScrollLeft - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = navRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
    }
    window.addEventListener('resize', checkScroll);
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);

  useEffect(() => {
    checkScroll();
    const activeEl = navRef.current?.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeTab]);

  const scrollTabs = (direction: 'left' | 'right') => {
    if (!navRef.current) return;
    const scrollAmount = direction === 'left' ? -220 : 220;
    navRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  return (
    <>
      <header className="bg-black/40 backdrop-blur-md border-b border-white/5 sticky top-0 z-50 text-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top Brand Bar */}
          <div className="flex items-center justify-between min-h-[4rem] py-2 sm:py-0 h-auto sm:h-16 border-b border-white/5 gap-2">
            <div className="flex items-center space-x-2.5 sm:space-x-3 cursor-pointer min-w-0" onClick={() => setActiveTab('dashboard')}>
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-cyan-500 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)] flex-shrink-0">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-black font-bold" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap">
                  <span className="text-lg sm:text-xl font-bold tracking-tight text-white whitespace-nowrap">
                    NetReady<span className="text-cyan-500">.local</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block truncate">
                  Browser-Native Diagnostics & Port Scanner Engine
                </p>
              </div>
            </div>

            {/* Action Buttons & Status Indicators */}
            <div className="flex items-center space-x-1.5 sm:space-x-2.5 flex-shrink-0">
              {/* Responsible Networking Warning Button */}
              <button
                onClick={() => setShowResponsibleModal(true)}
                className="flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 sm:px-3 rounded-full text-xs font-mono bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 transition-all cursor-pointer"
                title="Responsible Networking & Scanning Disclaimer"
                aria-label="Responsible Networking Disclaimer"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse flex-shrink-0" />
                <span className="hidden sm:inline font-semibold">Authorized Use Only</span>
              </button>

              {/* Privacy & Safety Modal Button */}
              <button
                onClick={() => setShowPrivacyModal(true)}
                className="flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 sm:px-3 rounded-full text-xs font-mono bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition-all cursor-pointer"
                title="View Privacy & Safety Statement"
                aria-label="Privacy & Safety"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="hidden sm:inline font-semibold">Privacy & Safety</span>
              </button>

              {/* Support / Donate Modal Button */}
              <button
                onClick={() => setShowDevSupportModal(true)}
                className="flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 sm:px-3 rounded-full text-xs font-mono bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition-all cursor-pointer"
                title="Support Open Source Development"
                aria-label="Support Dev"
              >
                <Heart className="w-3.5 h-3.5 text-rose-400 animate-pulse flex-shrink-0" />
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
              {connInfo.downlink !== undefined && connInfo.downlink > 0 && (
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

          {/* Navigation Tabs Bar Container */}
          <div className="relative py-2">
            {/* Left Fade & Arrow Indicator */}
            {canScrollLeft && (
              <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center pr-8 pl-0.5 bg-gradient-to-r from-[#050608] via-[#050608]/90 to-transparent pointer-events-none transition-opacity duration-200">
                <button
                  onClick={() => scrollTabs('left')}
                  className="pointer-events-auto p-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(0,0,0,0.8)] transition-all transform hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center"
                  title="Scroll left for previous tools"
                  aria-label="Scroll left"
                >
                  <ChevronLeft className="w-4 h-4 text-cyan-300 stroke-[2.5]" />
                </button>
              </div>
            )}

            {/* Scrollable Navigation Bar */}
            <nav
              ref={navRef}
              className="flex space-x-1 overflow-x-auto py-1 no-scrollbar scroll-smooth"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    data-active={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 cursor-pointer flex-shrink-0 ${
                      isActive
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span>{tab.label}</span>
                    {tab.badge && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Right Fade & Strong Glowing Arrow Indicator */}
            {canScrollRight && (
              <div className="absolute right-0 top-0 bottom-0 z-20 flex items-center pl-8 pr-0.5 bg-gradient-to-l from-[#050608] via-[#050608]/95 to-transparent pointer-events-none transition-opacity duration-200">
                <button
                  onClick={() => scrollTabs('right')}
                  className="pointer-events-auto flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-300 border border-cyan-400/60 shadow-[0_0_16px_rgba(6,182,212,0.7)] animate-pulse-glow transition-all transform hover:scale-105 active:scale-95 cursor-pointer"
                  title="Scroll right to see more diagnostic tools"
                  aria-label="Scroll right for more tools"
                >
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-200 hidden sm:inline">
                    More Tools
                  </span>
                  <ChevronRight className="w-4 h-4 text-cyan-300 stroke-[3] animate-bounce-right" />
                </button>
              </div>
            )}
          </div>
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
