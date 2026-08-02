import React from 'react';
import { Heart, ExternalLink, X, ShieldCheck, Sparkles, Coffee, Gift, Building2, Code2 } from 'lucide-react';

interface DevSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAYPAL_DONATION_URL = 'https://www.paypal.com/donate/?hosted_button_id=JLAGXTV4FX96S';

export const DevSupportModal: React.FC<DevSupportModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 w-full max-w-xl sm:max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <Heart className="w-6 h-6 fill-amber-400/20" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-lg sm:text-2xl">Support Development</h3>
              <p className="text-xs sm:text-sm text-slate-400">Keep NetReady 100% free & private client-side</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-6 text-sm sm:text-base max-h-[82vh] overflow-y-auto">
          {/* Main Hero Box */}
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-b from-amber-950/30 to-slate-950/70 border border-amber-500/30 space-y-2.5">
            <div className="flex items-center gap-2.5 text-amber-300 font-bold text-base sm:text-lg">
              <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
              <span>Independent & Private Forever</span>
            </div>
            <p className="text-slate-200 leading-relaxed text-sm sm:text-base">
              NetReady is built as a private, 100% browser-native network diagnostics workstation without subscription paywalls, ad trackers, or account sign-ups. Your diagnostic data stays strictly inside your browser.
            </p>
          </div>

          <div className="space-y-4 text-slate-200">
            <p className="font-medium leading-relaxed text-sm sm:text-base">
              If NetReady helped you diagnose local network issues, audit open ports, or save hours of manual network troubleshooting, consider supporting direct development!
            </p>

            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-3 text-slate-300 text-xs sm:text-sm">
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0" />
                <span>100% free & open-source under AGPL-3.0</span>
              </div>
              <div className="flex items-center gap-3 text-slate-300 text-xs sm:text-sm">
                <Coffee className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
                <span>Supports future browser socket & WebRTC diagnostic tools</span>
              </div>
              <div className="flex items-center gap-3 text-slate-300 text-xs sm:text-sm">
                <Gift className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 shrink-0" />
                <span>Voluntary contributions via secure PayPal link</span>
              </div>
            </div>
          </div>

          {/* Action Button - PayPal */}
          <div className="pt-2">
            <a
              href={PAYPAL_DONATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99] group cursor-pointer"
            >
              <Heart className="w-5 h-5 text-rose-300 fill-rose-300 group-hover:scale-110 transition-transform" />
              <span>Donate via PayPal</span>
              <ExternalLink className="w-5 h-5 text-blue-200 group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          {/* Employer & Company Shout-out (ABOVE OSS SHOUT-OUTS) */}
          <div className="p-5 sm:p-6 rounded-2xl bg-slate-950/80 border border-slate-800/90 space-y-3">
            <div className="flex items-center gap-2.5 text-sm sm:text-base font-bold text-cyan-300">
              <Building2 className="w-5 h-5 text-cyan-400 shrink-0" />
              <span>Special Thanks & Tech Shout-Out</span>
            </div>
            <div className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
              <p>
                Huge shout-out to{' '}
                <a
                  href="https://halomsp.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline inline-flex items-center gap-1"
                >
                  Halo MSP
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </a>
                {' '}(<a href="https://halomsp.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">halomsp.com</a>)—helping businesses navigate safe and sensible AI and software implementations!
              </p>
              <p>
                And to their parent company,{' '}
                <a
                  href="https://tech2u.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline inline-flex items-center gap-1"
                >
                  Tech 2U
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </a>
                {' '}(<a href="https://tech2u.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline">tech2u.com</a>), ready to assist with any business or personal IT need with expert, reliable support.
              </p>
            </div>
          </div>

          {/* Supporting Open Source Projects Shout-outs */}
          <div className="p-5 sm:p-6 rounded-2xl bg-slate-950/50 border border-slate-800/60 space-y-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold text-slate-300 uppercase tracking-wider">
              <Code2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Supporting Open-Source Projects</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="font-bold text-white">Lucide Icons</span> — Clean UI icons
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="font-bold text-white">Tailwind CSS</span> — Utility styling
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="font-bold text-white">Vite & React</span> — Fast Web Engine
              </div>
              <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                <span className="font-bold text-white">Cloudflare & Google DoH</span> — DNS
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400 px-6 sm:px-8">
          <span>NetReady • Browser-Native Diagnostics</span>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white font-semibold transition-colors cursor-pointer"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
};
