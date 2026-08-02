import React, { useState } from 'react';
import {
  ShieldQuestion,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
} from 'lucide-react';
import type {
  CaptivePortalResult,
  DnsIntegrityResult,
  HistoryItem,
  IntegrityProbe,
} from '../types';
import { checkCaptivePortal, checkDnsIntegrity } from '../utils/captivePortal';
import { FailureNotice, MetricValue } from './MetricValue';
import { saveHistoryItem } from '../utils/storage';

/**
 * Captive portal and DNS hijack detection.
 *
 * Worth stating plainly in the UI, because it is the part users get wrong: over
 * HTTPS a captive portal cannot rewrite a response. It can only block. So the
 * thing to look for is not tampered content — it is silence from every secure
 * endpoint while the browser still insists it is online.
 *
 * The DNS half tests the one thing about the system resolver a web page can
 * observe: whether a server reachable by literal IP is also reachable by name.
 */

interface CaptivePortalCheckProps {
  onHistoryUpdate: () => void;
}

const PORTAL_HEADLINE: Record<NonNullable<CaptivePortalResult['verdict']>, string> = {
  'no-interception-detected': 'Nothing is standing in the way',
  'content-substituted': 'Something is answering in place of known endpoints',
  'https-blocked': 'Online, but no secure connection completes',
  mixed: 'Mixed result',
};

const PORTAL_TONE: Record<NonNullable<CaptivePortalResult['verdict']>, string> = {
  'no-interception-detected': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'content-substituted': 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  'https-blocked': 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  mixed: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

const DNS_HEADLINE: Record<NonNullable<DnsIntegrityResult['verdict']>, string> = {
  'resolver-working': 'Name resolution is working',
  'resolver-failing': 'Name resolution is broken',
  'answers-diverge': 'Two DNS providers disagree',
};

const DNS_TONE: Record<NonNullable<DnsIntegrityResult['verdict']>, string> = {
  'resolver-working': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  'resolver-failing': 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  'answers-diverge': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

const OUTCOME_STYLE: Record<
  IntegrityProbe['outcome'],
  { icon: React.FC<{ className?: string }>; tone: string; label: string }
> = {
  verified: { icon: CheckCircle2, tone: 'text-emerald-400', label: 'returned its own content' },
  'content-mismatch': { icon: AlertTriangle, tone: 'text-rose-400', label: 'wrong content' },
  'no-response': { icon: XCircle, tone: 'text-amber-400', label: 'no response' },
  'not-attempted': { icon: MinusCircle, tone: 'text-slate-500', label: 'not attempted' },
};

const reachabilityWord = (v: boolean | null): string =>
  v === null ? 'not checked' : v ? 'answered' : 'no response';

export const CaptivePortalCheck: React.FC<CaptivePortalCheckProps> = ({ onHistoryUpdate }) => {
  const [portal, setPortal] = useState<CaptivePortalResult | null>(null);
  const [dns, setDns] = useState<DnsIntegrityResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState('');

  const run = async () => {
    setIsRunning(true);
    setPortal(null);
    setDns(null);
    try {
      const portalResult = await checkCaptivePortal(setStage);
      setPortal(portalResult);
      const dnsResult = await checkDnsIntegrity(setStage);
      setDns(dnsResult);

      const item: HistoryItem = {
        id: portalResult.id,
        type: 'captive',
        timestamp: portalResult.timestamp,
        title: `Interception check: ${
          portalResult.verdict === null ? 'no verdict' : PORTAL_HEADLINE[portalResult.verdict]
        }`,
        summary:
          `Interception: ${portalResult.verdict ?? 'unknown'} | DNS: ${dnsResult.verdict ?? 'unknown'}`,
        data: { portal: portalResult, dns: dnsResult },
      };
      saveHistoryItem(item);
      onHistoryUpdate();
    } finally {
      setIsRunning(false);
      setStage('');
    }
  };

  const failures = [...(portal?.failures ?? []), ...(dns?.failures ?? [])];

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
            <ShieldQuestion className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-100">
              Captive portal &amp; DNS hijack check
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              A captive portal cannot rewrite an HTTPS response without breaking the certificate
              chain, so from a secure page it shows up as silence rather than as a redirect. This
              calls endpoints whose exact response is known in advance and reports which answered
              correctly, which answered with something else, and which said nothing at all — then
              tests whether a server reachable by literal IP is also reachable by name.
            </p>
          </div>
        </div>

        <button
          onClick={run}
          disabled={isRunning}
          className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{stage.length > 0 ? stage : 'Checking…'}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{portal ? 'Check again' : 'Run the check'}</span>
            </>
          )}
        </button>
      </div>

      {portal && (
        <>
          <div
            className={`border rounded-2xl p-6 space-y-2 ${
              portal.verdict === null
                ? 'border-slate-700 bg-slate-800/40 text-slate-300'
                : PORTAL_TONE[portal.verdict]
            }`}
          >
            <h2 className="text-lg font-bold">
              {portal.verdict === null ? 'No verdict' : PORTAL_HEADLINE[portal.verdict]}
            </h2>
            <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{portal.explanation}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3 shadow-xl">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Known-content probes
            </h3>
            <ul>
              {portal.probes.map((p) => {
                const style = OUTCOME_STYLE[p.outcome];
                const Icon = style.icon;
                return (
                  <li
                    key={p.url}
                    className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0"
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.tone}`} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold text-slate-200">{p.label}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                          {style.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono truncate">{p.url}</p>
                      <p className="text-[11px] text-slate-400">Expected: {p.expectation}</p>
                      {p.note !== null && (
                        <p className="text-[11px] text-slate-400 leading-relaxed">{p.note}</p>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 shrink-0">
                      <MetricValue value={p.roundTripMs} unit="ms" className="text-slate-300" />
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Page served over <span className="font-mono">{portal.pageProtocol}</span>. The
              plaintext 204 probe is only possible from an http origin — a secure page may not open
              a plaintext connection, which is a browser rule rather than a network result.
            </p>
          </div>
        </>
      )}

      {dns && (
        <>
          <div
            className={`border rounded-2xl p-6 space-y-2 ${
              dns.verdict === null
                ? 'border-slate-700 bg-slate-800/40 text-slate-300'
                : DNS_TONE[dns.verdict]
            }`}
          >
            <h2 className="text-lg font-bold">
              {dns.verdict === null ? 'No DNS verdict' : DNS_HEADLINE[dns.verdict]}
            </h2>
            <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{dns.explanation}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-100">Resolver test</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                The same Cloudflare server, reached two ways. Reaching it by name uses this
                network&rsquo;s resolver; reaching it by literal address does not. A browser cannot
                read the answer the resolver gave, but it can compare the outcomes.
              </p>
              <dl className="space-y-2 text-[11px] font-mono">
                <div className="flex justify-between gap-2 border-b border-white/5 pb-2">
                  <dt className="text-slate-400 truncate">by name</dt>
                  <dd className="text-slate-200 shrink-0">
                    {reachabilityWord(dns.hostnameReachable)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400 truncate">by literal IP</dt>
                  <dd className="text-slate-200 shrink-0">
                    {reachabilityWord(dns.literalIpReachable)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-100">Provider cross-check</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Names whose correct answer is identical worldwide, resolved through two independent
                DNS-over-HTTPS providers. Ordinary CDN hostnames answer differently by location by
                design, so they would produce disagreement constantly and mean nothing.
              </p>
              {dns.comparisons.length === 0 ? (
                <p className="text-[11px] text-slate-500">No name was compared.</p>
              ) : (
                <ul className="space-y-2 text-[11px] font-mono">
                  {dns.comparisons.map((c) => (
                    <li key={c.name} className="space-y-0.5 border-b border-white/5 pb-2 last:border-0 last:pb-0">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-300 truncate">{c.name}</span>
                        <span
                          className={
                            c.agrees === null
                              ? 'text-slate-500'
                              : c.agrees
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                          }
                        >
                          {c.agrees === null ? 'not comparable' : c.agrees ? 'agree' : 'differ'}
                        </span>
                      </div>
                      <div className="text-slate-500">
                        cloudflare: {c.cloudflare === null ? '—' : c.cloudflare.join(', ')}
                      </div>
                      <div className="text-slate-500">
                        google: {c.google === null ? '—' : c.google.join(', ')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <FailureNotice failures={failures.length > 0 ? failures : undefined} />
    </div>
  );
};
