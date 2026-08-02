import React, { useMemo, useState } from 'react';
import {
  Compass,
  Play,
  RefreshCw,
  Server,
  Radio,
  Info,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import type { EdgePathResult, EdgeProbeResult, HistoryItem, PhaseTimings } from '../types';
import { exploreEdgePath } from '../utils/edgePath';
import { saveHistoryItem } from '../utils/storage';
import { ResponsibleNetworkingModal, isResponsibleNetworkingAccepted } from './ResponsibleNetworkingModal';
import { FailureNotice, displayMetric } from './MetricValue';
import { EdgeMap, type MapNode, type MapLink, type MapRing } from './EdgeMap';

interface EdgePathExplorerProps {
  onHistoryUpdate: () => void;
}

const PRESETS = ['cloudflare.com', 'discord.com', 'shopify.com', 'medium.com'];

/** Colour and label for each phase of the connection. */
const PHASE_SPEC = [
  { key: 'dnsMs', label: 'DNS', colour: 'bg-violet-500', hint: 'Resolving the hostname' },
  { key: 'tcpMs', label: 'TCP', colour: 'bg-cyan-500', hint: 'Opening the socket' },
  { key: 'tlsMs', label: 'TLS', colour: 'bg-emerald-500', hint: 'Negotiating encryption' },
  { key: 'ttfbMs', label: 'TTFB', colour: 'bg-amber-500', hint: 'Waiting for the first byte' },
  { key: 'transferMs', label: 'Transfer', colour: 'bg-slate-500', hint: 'Receiving the body' },
] as const satisfies readonly { key: keyof PhaseTimings; label: string; colour: string; hint: string }[];

const AVAILABILITY_COPY: Record<EdgeProbeResult['availability'], string> = {
  available: '',
  'timing-allow-origin-missing':
    'This origin does not send Timing-Allow-Origin, so the browser zeroes its DNS, TCP and TLS timings. They are unavailable, not zero.',
  'connection-reused':
    'Answered over a connection that was already open, so there was no handshake to measure. Reload to force a fresh one.',
  'request-failed': 'The request did not complete.',
};

/** Stacked bar of the connection phases, proportional to their real durations. */
const Waterfall: React.FC<{ probe: EdgeProbeResult }> = ({ probe }) => {
  const segments = PHASE_SPEC.map((spec) => ({
    ...spec,
    value: probe.phases[spec.key],
  })).filter((s): s is (typeof PHASE_SPEC)[number] & { value: number } => s.value !== null && s.value > 0);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (segments.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 italic py-2">
        {AVAILABILITY_COPY[probe.availability] || 'No phase data.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-6 rounded-lg overflow-hidden bg-slate-950 border border-white/5">
        {segments.map((s) => (
          <div
            key={s.key}
            className={`${s.colour} relative group transition-all`}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${s.value} ms — ${s.hint}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className={`w-2 h-2 rounded-sm ${s.colour}`} aria-hidden="true" />
            <span className="text-slate-400">{s.label}</span>
            <span className="text-slate-200 font-semibold">{s.value} ms</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export const EdgePathExplorer: React.FC<EdgePathExplorerProps> = ({ onHistoryUpdate }) => {
  const [targetHost, setTargetHost] = useState('cloudflare.com');
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [result, setResult] = useState<EdgePathResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResponsibleModal, setShowResponsibleModal] = useState(false);

  const execute = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await exploreEdgePath(targetHost, setStage);
      setResult(res);

      const item: HistoryItem = {
        id: res.id,
        type: 'edgepath',
        timestamp: res.timestamp,
        title: `Edge path: ${res.targetHost ?? 'this connection'}${
          res.referencePop ? ` via ${res.referencePop.colo}` : ''
        }`,
        summary: [
          res.referencePop ? `Edge: ${res.referencePop.colo}` : 'Edge: unknown',
          res.client?.asOrganization ? `ASN: ${res.client.asOrganization}` : null,
          res.protocolEvidence.negotiated.length
            ? `Protocol: ${res.protocolEvidence.negotiated.join(', ')}`
            : null,
          res.clientToPopKm !== null ? `${res.clientToPopKm} km to edge` : null,
        ]
          .filter(Boolean)
          .join(' | '),
        data: res,
      };
      saveHistoryItem(item);
      onHistoryUpdate();
    } catch (e) {
      console.error('Edge path exploration failed:', e);
      setError(
        e instanceof Error ? `Exploration failed: ${e.message}` : 'Exploration failed.',
      );
    } finally {
      setIsRunning(false);
      setStage('');
    }
  };

  const handleStart = () => {
    if (!isResponsibleNetworkingAccepted()) {
      setShowResponsibleModal(true);
      return;
    }
    execute();
  };

  // Only points with genuine coordinates reach the map.
  const { nodes, links, rings } = useMemo(() => {
    const n: MapNode[] = [];
    const l: MapLink[] = [];
    const r: MapRing[] = [];
    if (!result) return { nodes: n, links: l, rings: r };

    if (result.client?.lat != null && result.client?.lng != null) {
      n.push({
        id: 'client',
        lat: result.client.lat,
        lng: result.client.lng,
        kind: 'client',
        label: 'Your connection',
        detail: [
          result.client.ip ? `IP: ${result.client.ip}` : 'IP: unknown',
          result.client.asOrganization
            ? `Network: ${result.client.asOrganization}`
            : 'Network: unknown',
          result.client.asn ? `ASN: AS${result.client.asn}` : '',
          [result.client.city, result.client.country].filter(Boolean).join(', '),
          'Location as reported by the edge that served you.',
        ].filter(Boolean),
      });
    }

    if (result.referencePop?.lat != null && result.referencePop?.lng != null) {
      n.push({
        id: 'edge',
        lat: result.referencePop.lat,
        lng: result.referencePop.lng,
        kind: 'edge-pop',
        label: `Edge ${result.referencePop.colo}`,
        detail: [
          [result.referencePop.city, result.referencePop.country].filter(Boolean).join(', '),
          result.referencePop.httpProtocol
            ? `Protocol: ${result.referencePop.httpProtocol}`
            : '',
          'The CDN point of presence that answered your request.',
        ].filter(Boolean),
      });
      if (n.some((x) => x.id === 'client')) {
        l.push({ fromId: 'client', toId: 'edge' });
      }

      // Constraint ring: the tightest round trip bounds how far the edge is.
      const best = result.probes
        .map((p) => p.maxDistanceKm)
        .filter((d): d is number => d !== null);
      if (best.length > 0) {
        const radius = Math.min(...best);
        r.push({
          centerLat: result.referencePop.lat,
          centerLng: result.referencePop.lng,
          radiusKm: radius,
          label: `Within ${radius.toLocaleString()} km of this edge (speed-of-light limit)`,
        });
      }
    }

    if (result.targetPop?.lat != null && result.targetPop?.lng != null) {
      n.push({
        id: 'target',
        lat: result.targetPop.lat,
        lng: result.targetPop.lng,
        kind: 'target-pop',
        label: `${result.targetHost ?? 'Target'} → ${result.targetPop.colo}`,
        detail: [
          [result.targetPop.city, result.targetPop.country].filter(Boolean).join(', '),
          result.targetPop.httpProtocol ? `Protocol: ${result.targetPop.httpProtocol}` : '',
          'The edge this host reports serving your traffic from.',
        ].filter(Boolean),
      });
      if (n.some((x) => x.id === 'client')) {
        l.push({ fromId: 'client', toId: 'target' });
      }
    }

    return { nodes: n, links: l, rings: r };
  }, [result]);

  const verdictStyle = (() => {
    switch (result?.protocolEvidence.verdict) {
      case 'http3-working':
        return { icon: CheckCircle2, cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' };
      case 'http3-absent-udp-possibly-blocked':
        return { icon: AlertTriangle, cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' };
      case 'legacy-http1':
        return { icon: AlertTriangle, cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' };
      default:
        return { icon: Info, cls: 'text-slate-400 bg-slate-800/50 border-slate-700/50' };
    }
  })();
  const VerdictIcon = verdictStyle.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Compass className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-slate-100">Edge Path Explorer</h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 rounded-full uppercase">
              Measured
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Everything a browser can genuinely observe about the path to a host: the real
            DNS → TCP → TLS → first-byte breakdown, which CDN edge answered, the protocol that was
            negotiated, and how far away a server can possibly be.
          </p>
        </div>

        <button
          onClick={handleStart}
          disabled={isRunning}
          className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Exploring…</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Explore path</span>
            </>
          )}
        </button>
      </div>

      {/* Why there are no intermediate hops. */}
      <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300 leading-relaxed">
          <span className="font-semibold text-cyan-300">Why there are no router-by-router hops.</span>{' '}
          A traceroute works by sending packets with a deliberately small IP TTL and reading the
          errors that come back. A web page can do neither — there are no raw sockets and no TTL
          control in the browser. So rather than invent the middle of the path, this tool measures
          the endpoints precisely: the phases of a real connection, the edge that terminated it, and
          a distance bound that physics guarantees.
        </p>
      </div>

      {isRunning && stage && (
        <p aria-live="polite" className="text-xs font-mono text-cyan-300">
          {stage}…
        </p>
      )}

      {error && (
        <div role="alert" className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Target */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <label htmlFor="edge-target" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
          Host to inspect (optional)
        </label>
        <input
          id="edge-target"
          type="text"
          value={targetHost}
          onChange={(e) => setTargetHost(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleStart()}
          placeholder="e.g. cloudflare.com"
          className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 shadow-inner"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setTargetHost(p)}
              disabled={isRunning}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all disabled:opacity-50 ${
                targetHost === p
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700/60'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Only Cloudflare-fronted hosts expose their edge location to a browser. For anything else
          the field is reported as unavailable rather than guessed — the rest of the exploration
          still runs.
        </p>
      </div>

      {result && (
        <>
          <FailureNotice failures={result.failures.length ? result.failures : undefined} />

          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Serving edge',
                value: result.referencePop?.colo ?? '—',
                sub: result.referencePop
                  ? [result.referencePop.city, result.referencePop.country].filter(Boolean).join(', ') ||
                    'Location not in the bundled table'
                  : 'Not determined',
                icon: Server,
              },
              {
                label: 'Distance to edge',
                value: result.clientToPopKm !== null ? `${result.clientToPopKm.toLocaleString()}` : '—',
                sub: result.clientToPopKm !== null ? 'km, great-circle' : 'Needs both locations',
                icon: Compass,
              },
              {
                label: 'Your network',
                value: result.client?.asn ? `AS${result.client.asn}` : '—',
                sub: result.client?.asOrganization ?? 'Not determined',
                icon: Radio,
              },
              {
                label: 'Protocol',
                value: result.protocolEvidence.negotiated[0] ?? '—',
                sub: result.protocolEvidence.negotiated.length > 1
                  ? `also ${result.protocolEvidence.negotiated.slice(1).join(', ')}`
                  : 'Across probed origins',
                icon: ShieldCheck,
              },
            ].map((tile) => (
              <div key={tile.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  <tile.icon className="w-3.5 h-3.5 text-cyan-400" />
                  {tile.label}
                </div>
                <div className="text-2xl font-extrabold font-mono text-white">{tile.value}</div>
                <div className="text-[11px] text-slate-500 mt-1 leading-snug">{tile.sub}</div>
              </div>
            ))}
          </div>

          {/* The answer to what the user actually asked. Without this the target
              host's edge was only reachable by opening a map popup. */}
          {result.targetHost && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
                {result.targetHost}
              </h2>
              {result.targetPop ? (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm text-slate-300">Your traffic enters at</span>
                  <span className="text-2xl font-extrabold font-mono text-rose-300">
                    {result.targetPop.colo}
                  </span>
                  <span className="text-sm text-slate-300">
                    {[result.targetPop.city, result.targetPop.country].filter(Boolean).join(', ') ||
                      'an edge not present in the bundled location table'}
                  </span>
                  {result.targetPop.httpProtocol && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase">
                      {result.targetPop.httpProtocol}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 leading-relaxed">
                  This host did not report an edge location. Only Cloudflare-fronted sites expose{' '}
                  <code className="text-slate-400">/cdn-cgi/trace</code> to a browser, so this is the
                  normal result for most of the web — not a failure of your network.
                </p>
              )}
            </div>
          )}

          {/* Map */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Measured geography
              </h2>
              <p className="text-[11px] text-slate-500">
                Dashed circle = furthest the edge can be, given round-trip time
              </p>
            </div>
            <EdgeMap nodes={nodes} links={links} rings={rings} />
          </div>

          {/* Protocol verdict */}
          <div className={`rounded-2xl border p-4 flex items-start gap-3 ${verdictStyle.cls}`}>
            <VerdictIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold">
                {result.protocolEvidence.verdict === 'http3-working' && 'HTTP/3 is working'}
                {result.protocolEvidence.verdict === 'http3-absent-udp-possibly-blocked' &&
                  'HTTP/3 unavailable — UDP/443 may be blocked'}
                {result.protocolEvidence.verdict === 'legacy-http1' && 'Connections fell back to HTTP/1.1'}
                {result.protocolEvidence.verdict === 'http2-only' && 'HTTP/2 in use'}
                {result.protocolEvidence.verdict === null && 'Protocol not observable'}
              </p>
              <p className="text-xs leading-relaxed opacity-90">
                {result.protocolEvidence.explanation}
              </p>
            </div>
          </div>

          {/* Waterfalls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Connection phase breakdown
              </h2>
              <p className="text-[11px] text-slate-500 mt-1">
                Real timings from the Performance Timeline. Handshake phases only exist on a
                connection&rsquo;s first request.
              </p>
            </div>

            {result.probes.map((probe) => (
              <div key={probe.target.origin} className="space-y-2 pb-4 border-b border-white/5 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">{probe.target.label}</span>
                    <span className="text-[10px] font-mono text-slate-500">{probe.target.origin}</span>
                    {probe.protocol && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase">
                        {probe.protocol}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-slate-400">
                      RTT {displayMetric(probe.roundTripMs, 'ms', 1)}
                    </span>
                    {probe.maxDistanceKm !== null && (
                      <span
                        className="text-slate-500"
                        title={
                          `At most ${probe.maxDistanceKm.toLocaleString()} km away. Derived from ` +
                          `${probe.phases.ttfbMs !== null ? 'time to first byte' : 'round-trip time'}` +
                          ' and the speed of light in fibre (~200 km/ms), halved for one direction.'
                        }
                      >
                        ≤ {probe.maxDistanceKm.toLocaleString()} km away
                      </span>
                    )}
                  </div>
                </div>
                <Waterfall probe={probe} />
                {probe.availability !== 'available' && (
                  <p className="text-[11px] text-amber-200/70 leading-relaxed">
                    {probe.error ?? AVAILABILITY_COPY[probe.availability]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <ResponsibleNetworkingModal
        isOpen={showResponsibleModal}
        onClose={() => setShowResponsibleModal(false)}
        onConfirm={() => {
          setShowResponsibleModal(false);
          execute();
        }}
      />
    </div>
  );
};
