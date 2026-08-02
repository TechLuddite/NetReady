import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, Square, X, Lock, Check } from 'lucide-react';

interface ResponsibleNetworkingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  forceRequireCheck?: boolean;
}

export const RESPONSIBLE_NETWORKING_STORAGE_KEY = 'netready_responsible_networking_accepted';

export const isResponsibleNetworkingAccepted = (): boolean => {
  try {
    return localStorage.getItem(RESPONSIBLE_NETWORKING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setResponsibleNetworkingAccepted = (accepted: boolean) => {
  try {
    if (accepted) {
      localStorage.setItem(RESPONSIBLE_NETWORKING_STORAGE_KEY, 'true');
    } else {
      localStorage.removeItem(RESPONSIBLE_NETWORKING_STORAGE_KEY);
    }
  } catch (e) {
    console.error('Failed to set responsible networking state in localStorage', e);
  }
};

export const ResponsibleNetworkingModal: React.FC<ResponsibleNetworkingModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  forceRequireCheck = true,
}) => {
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Check if previously accepted
      const alreadyAccepted = isResponsibleNetworkingAccepted();
      if (alreadyAccepted && !forceRequireCheck) {
        setIsChecked(true);
      } else {
        setIsChecked(false);
      }
    }
  }, [isOpen, forceRequireCheck]);

  if (!isOpen) return null;

  const handleConfirmAction = () => {
    if (!isChecked) return;
    setResponsibleNetworkingAccepted(true);
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-xl bg-[#0b0f17] border border-amber-500/30 rounded-2xl shadow-[0_0_50px_rgba(245,158,11,0.15)] overflow-hidden text-slate-200">
        {/* Glow Header Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500" />

        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-amber-500/5">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-400">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
                <span>Responsible Networking Warning</span>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
                  Authorization Required
                </span>
              </h2>
              <p className="text-xs text-amber-200/80">
                Authorized testing & ethical network diagnostics policy
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Close Notice"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4 text-xs font-sans">
          <div className="p-3.5 bg-amber-950/30 border border-amber-500/20 rounded-xl space-y-2">
            <div className="flex items-center space-x-2 text-amber-300 font-semibold text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Ethical Scanning & Diagnostic Standard</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              Port scanning, ping testing, socket probing, and traceroute diagnostic tools generate active TCP/UDP or HTTP network requests. You must ensure you have legal authorization before executing tests against external hosts or infrastructure.
            </p>
          </div>

          <div className="space-y-2.5 text-slate-300">
            <p className="font-semibold text-slate-200">
              By utilizing NetReady diagnostic features, you agree to comply with the following principles:
            </p>
            <ul className="space-y-2 pl-1">
              <li className="flex items-start space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-white">Authorized Targets Only:</strong> Only scan hosts, subnets, IP addresses, or domain names that you own, operate, or have explicit authorization to audit.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-white">Client-Side Execution:</strong> All scans originate directly from your current browser client IP address without any intermediate server proxies.
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-white">Policy Compliance:</strong> Do not perform excessive, malicious, or unauthorized port sweeps against third-party servers or infrastructure.
                </span>
              </li>
            </ul>
          </div>

          {/* Consent.
              This was a <label onClick> wrapping a decorative icon, with no
              input element anywhere — so the control that gates the whole
              authorisation flow was unreachable by keyboard and announced as
              nothing by a screen reader. It is a real checkbox now. */}
          <div className="pt-2 border-t border-white/10">
            <label
              htmlFor="responsible-networking-consent"
              className="flex items-start space-x-3 p-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl cursor-pointer transition-all select-none group focus-within:ring-2 focus-within:ring-cyan-500/60"
            >
              <span className="relative mt-0.5 shrink-0">
                <input
                  id="responsible-networking-consent"
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => setIsChecked(e.target.checked)}
                  className="peer absolute inset-0 w-5 h-5 opacity-0 cursor-pointer"
                />
                <span aria-hidden="true" className="block text-cyan-400">
                  {isChecked ? (
                    <span className="w-5 h-5 bg-cyan-500 rounded flex items-center justify-center text-black font-bold">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  ) : (
                    <Square className="w-5 h-5 text-slate-500 group-hover:text-slate-300" />
                  )}
                </span>
              </span>
              <span className="text-xs">
                <span className="font-semibold text-white block mb-0.5">
                  I confirm that I own or have explicit authorization to scan and test target hosts.
                </span>
                <span className="text-slate-400 text-[11px] block">
                  I assume full responsibility for all network diagnostic actions initiated from
                  this client browser session.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-medium rounded-xl text-xs transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleConfirmAction}
            disabled={!isChecked}
            className={`px-5 py-2.5 rounded-xl font-semibold text-xs transition-all flex items-center space-x-2 ${
              isChecked
                ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)] cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Confirm & Continue</span>
          </button>
        </div>
      </div>
    </div>
  );
};
