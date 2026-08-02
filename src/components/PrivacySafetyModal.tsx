import React from 'react';
import { ShieldCheck, X, Lock, Database, EyeOff, Scale, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Every third party the browser contacts on NetReady's behalf, and what each
 * one receives. Kept next to the privacy copy deliberately: if a new provider
 * is added to the engine, this list is the thing that has to change with it.
 */
export const THIRD_PARTY_DISCLOSURES: { host: string; receives: string }[] = [
  {
    host: 'speed.cloudflare.com',
    receives: 'Your IP, plus tens of MB of transfer, whenever you run a speed test or full audit.',
  },
  {
    host: 'cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com',
    receives:
      'Your IP, as the targets of the Edge Path Explorer\u2019s connection-timing probes. A few KB each.',
  },
  {
    host: 'cloudflare-dns.com / dns.google',
    receives: 'Every domain name you resolve, over encrypted DNS-over-HTTPS.',
  },
  {
    host: 'ipwho.is / ipapi.co / freeipapi.com',
    receives:
      'Your public IP when you open the GeoIP tool, and every IP or domain you look up or trace.',
  },
  {
    host: '1.1.1.1, one.one.one.one, dns.quad9.net, doh.opendns.com, en.wikipedia.org',
    receives:
      'Your IP, as the targets of latency probes you choose to run. The triage and DNS-hijack ' +
      'checks call 1.1.1.1 twice — once by name and once by literal address — to test ' +
      'this network’s resolver.',
  },
  {
    host: 'ipv4.icanhazip.com, ipv6.icanhazip.com, api4.ipify.org, api6.ipify.org',
    receives:
      'Your IP, when you run the dual-stack check. Each host answers on one address family only, ' +
      'and each returns the address it saw you arrive from.',
  },
  {
    host: 'cp.cloudflare.com',
    receives:
      'Your IP, during the captive-portal check — but only when NetReady is opened over plain ' +
      'http. A page served over https cannot make this request at all.',
  },
  {
    host: 'stun.l.google.com (and other STUN servers)',
    receives: 'Your public IP, and potentially local network addresses, during WebRTC analysis.',
  },
  {
    host: 'httpbin.org',
    receives:
      'Your IP, only if you press “Trigger Network Spike” on the live traffic monitor, which ' +
      'makes a handful of requests so the sparklines have something real to draw.',
  },
  {
    host: 'basemaps.cartocdn.com',
    receives: 'The map area you view, which reveals the approximate location of a traced target.',
  },
  {
    host: 'openstreetmap.org',
    receives: 'Coordinates of a looked-up IP, via the embedded map frame on the GeoIP tool.',
  },
  {
    host: 'Hosts you enter yourself',
    receives:
      'Direct connections from your browser and therefore your IP — this is what a scan or probe is.',
  },
];

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
                <span>No NetReady Servers</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                NetReady has no backend. Nothing is sent to, stored on, or logged by any server we
                operate — because there isn&rsquo;t one. That is not the same as nothing leaving your
                browser; see the list below.
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
                <span>MIT License</span>
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

          {/* The honest part.
              A diagnostic tool cannot measure a network without touching it.
              Claiming "we do not transmit any IP addresses, scan targets or
              domain names" was flatly untrue: running a trace sends the target
              IP to two GeoIP providers, opening the GeoIP tab sends your own
              public IP before you click anything, and a speed test moves tens
              of megabytes through Cloudflare. Listing that is more useful to a
              privacy-conscious user than a reassuring sentence. */}
          <div className="space-y-3 border-t border-white/5 pt-4">
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
              What leaves your browser, and to whom
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              These are direct browser-to-provider requests. NetReady never sees them, but the
              providers do, and each is subject to its own privacy policy.
            </p>
            <div className="space-y-1.5 text-[11px] font-mono text-slate-300">
              {THIRD_PARTY_DISCLOSURES.map((d) => (
                <div
                  key={d.host}
                  className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-cyan-300 shrink-0 sm:w-52">{d.host}</span>
                  <span className="text-slate-400 leading-relaxed">{d.receives}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Tools that need no network at all — the CIDR calculator, MAC/OUI lookup, stored
              history and every export — contact nobody.
            </p>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-4">
            <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
              What NetReady itself does
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-slate-300">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No analytics, no cookies, no trackers</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No backend, no account, no database</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>DNS queries go out over encrypted DoH</span>
              </div>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Clearing site data erases everything</span>
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
