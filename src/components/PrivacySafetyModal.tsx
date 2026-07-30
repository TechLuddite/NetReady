import React from 'react';
import { ShieldCheck, X, Lock, Database, EyeOff, Scale, CheckCircle2, AlertTriangle } from 'lucide-react';

interface PrivacySafetyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacySafetyModal: React.FC<PrivacySafetyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-slate-200">
        {/* Glow Header Accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500" />

        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center space-x-2">
                <span>Privacy & Safety Statement</span>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                  100% Private
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Zero telemetry, local client-side execution, and full data autonomy.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto font-sans">
          {/* Main Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2 text-cyan-400 font-semibold text-xs uppercase tracking-wider">
                <Lock className="w-4 h-4" />
                <span>100% Client-Side</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                All network diagnostics, socket probes, DNS queries, and port scans run directly inside your browser process.
              </p>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-xs uppercase tracking-wider">
                <EyeOff className="w-4 h-4" />
                <span>Zero Server Telemetry</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                We do not collect, transmit, track, or record any IP addresses, scan targets, domain names, or diagnostic logs.
              </p>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2 text-purple-400 font-semibold text-xs uppercase tracking-wider">
                <Database className="w-4 h-4" />
                <span>Local Storage Isolation</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your diagnostic reports are saved exclusively in your browser’s standard <code className="text-cyan-300">localStorage</code>.
              </p>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
                <Scale className="w-4 h-4" />
                <span>AGPL-3.0 License</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Open-source and auditable. Anyone can inspect the full application source code for total safety verification.
              </p>
            </div>
          </div>

          {/* Ethical Diagnostic Usage Guidelines */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4" />
              <span>Ethical Network Auditing Notice</span>
            </div>
            <p className="text-xs text-amber-200/90 leading-relaxed">
              Port scanning and network probing tools should strictly be used on hosts, subnets, and local dev environments that you own or have explicit permission to test. Always adhere to authorized security assessment practices.
            </p>
          </div>

          {/* Feature Checklist */}
          <div className="space-y-2 border-t border-white/5 pt-4">
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Security Guarantee Checklist
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-300">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No Third-Party Analytics Cookies</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No Backend Database Persistence</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Encrypted DoH (Cloudflare / Google)</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Instant Data Wipe via Clear Storage</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-white/[0.02] border-t border-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl text-xs transition-colors"
          >
            I Understand & Accept
          </button>
        </div>
      </div>
    </div>
  );
};
