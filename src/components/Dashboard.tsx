import { useState, type ComponentType, type FormEvent } from 'react';
import { Gauge, Radio, Globe, Cpu, Calculator, Search, Server, Terminal, History, Radar, Archive, Compass, Stethoscope, Network, ShieldQuestion, Timer, Footprints, ArrowRight } from 'lucide-react';
import type { ToolTab, HistoryItem } from '../types';

interface QuickField {
  key: string;
  label: string;
  placeholder: string;
  optional?: boolean;
  pattern?: string;
}
interface ToolCard {
  tab: ToolTab;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  fields?: QuickField[];
  action?: string;
}
const TOOLS: ToolCard[] = [
  { tab: 'walktest', title: 'Walk & Test', description: 'Measure HTTPS response times while you move between spots.', icon: Footprints, fields: [{ key: 'spot', label: 'Starting spot (optional)', placeholder: 'Lobby', optional: true }] },
  { tab: 'triage', title: 'Me or the Internet?', description: 'Run network checks and see findings backed by their measurements.', icon: Stethoscope },
  { tab: 'dualstack', title: 'IPv4 / IPv6 Reachability', description: 'Check each address family with independent probe providers.', icon: Network },
  { tab: 'captive', title: 'Portal & DNS Hijack', description: 'Check known responses for signs of interception or resolver trouble.', icon: ShieldQuestion },
  { tab: 'edgepath', title: 'Edge Path Explorer', description: 'Measure connection phases and identify the CDN edge that answered.', icon: Compass, fields: [{ key: 'target', label: 'Hostname or URL (optional)', placeholder: 'example.com', optional: true }] },
  { tab: 'portscanner', title: 'Local Port Scanner', description: 'Browser service probes. Port state is inferred from connection timing.', icon: Radar, fields: [{ key: 'target', label: 'Host, subnet or range', placeholder: '192.168.1.1' }, { key: 'ports', label: 'Ports', placeholder: '80,443,3000,8080' }] },
  { tab: 'geoip', title: 'GeoIP & ISP Lookup', description: 'Look up provider-reported location and network details.', icon: Globe, fields: [{ key: 'target', label: 'IP or hostname (optional)', placeholder: 'Leave blank for your public IP', optional: true }], action: 'Look up' },
  { tab: 'speedtest', title: 'Speed & Bandwidth', description: 'Measure download, upload, latency and behaviour under load.', icon: Gauge },
  { tab: 'ping', title: 'Ping & Jitter', description: 'Measure HTTPS round trips to your target, including jitter and unanswered probes.', icon: Radio, fields: [{ key: 'target', label: 'IP, hostname or URL', placeholder: 'example.com' }] },
  { tab: 'dns', title: 'DNS-over-HTTPS Resolver', description: 'Query DNS records over an encrypted HTTPS connection.', icon: Globe, fields: [{ key: 'domain', label: 'Domain', placeholder: 'example.com' }], action: 'Resolve' },
  { tab: 'dnsbench', title: 'DNS Resolver Benchmark', description: 'Compare measured query times across public DoH resolvers.', icon: Timer },
  { tab: 'webrtc', title: 'WebRTC ICE Analyzer', description: 'Gather ICE candidates and inspect what your browser exposes.', icon: Cpu },
  { tab: 'cidr', title: 'Subnet & CIDR Calculator', description: 'Calculate address ranges and subnet masks locally.', icon: Calculator, fields: [{ key: 'cidr', label: 'IPv4 CIDR', placeholder: '192.168.1.0/24', pattern: '[0-9]{1,3}(\\.[0-9]{1,3}){3}/([0-9]|[12][0-9]|3[0-2])' }], action: 'Calculate' },
  { tab: 'mac', title: 'MAC / OUI Lookup', description: 'Look up vendor prefixes in the bundled offline database.', icon: Search, fields: [{ key: 'mac', label: 'MAC address or prefix', placeholder: '00:1A:2B:3C:4D:5E' }], action: 'Look up' },
  { tab: 'httpprobe', title: 'HTTP Probe', description: 'Measure response time and inspect status and visible headers.', icon: Server, fields: [{ key: 'url', label: 'HTTP or HTTPS URL', placeholder: 'https://example.com' }], action: 'Probe' },
  { tab: 'websocket', title: 'WebSocket Tester', description: 'Measure a WebSocket handshake and application echo round trips.', icon: Terminal, fields: [{ key: 'url', label: 'WebSocket URL', placeholder: 'wss://your-echo-server.example' }] },
  { tab: 'history', title: 'Diagnostic History', description: 'Search and inspect results saved in this browser.', icon: History, action: 'Open history' },
  { tab: 'export', title: 'Data Export', description: 'Download saved measurements as CSV, JSON or a bundled ZIP.', icon: Archive, action: 'Open export' },
];

function QuickToolCard({ tool, onLaunch, onOpen }: { tool: ToolCard; onLaunch: (tab: ToolTab, values: Record<string, string>) => void; onOpen: (tab: ToolTab) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const Icon = tool.icon;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (tool.tab === 'history' || tool.tab === 'export') onOpen(tool.tab);
    else onLaunch(tool.tab, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])));
  };
  return (
    <article className="bg-slate-900 border border-slate-800 hover:border-cyan-500/40 rounded-2xl p-5 flex flex-col gap-4 shadow-lg">
      <div>
        <Icon className="w-6 h-6 text-cyan-400 mb-3" />
        <h2 className="font-bold text-slate-100">{tool.title}</h2>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">{tool.description}</p>
      </div>
      <form onSubmit={submit} className="mt-auto space-y-3">
        {tool.fields?.map(field => (
          <div key={field.key}>
            <label htmlFor={`quick-${tool.tab}-${field.key}`} className="block text-xs text-slate-300 mb-1.5">{field.label}</label>
            <input id={`quick-${tool.tab}-${field.key}`} type="text" required={!field.optional} pattern={field.pattern} placeholder={field.placeholder}
              value={values[field.key] ?? ''} onChange={event => setValues({ ...values, [field.key]: event.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-cyan-500" />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="submit" className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold px-4 py-2 rounded-xl text-sm">{tool.action ?? 'Run test'}</button>
          {tool.tab !== 'history' && tool.tab !== 'export' && <button type="button" onClick={() => onOpen(tool.tab)} className="text-xs text-slate-400 hover:text-cyan-300 flex items-center gap-1">Open tool <ArrowRight className="w-3 h-3" /></button>}
        </div>
      </form>
    </article>
  );
}

export function Dashboard({ setActiveTab, onLaunch, history }: { setActiveTab: (tab: ToolTab) => void; onLaunch: (tab: ToolTab, values: Record<string, string>) => void; history: HistoryItem[] }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map(tool => <QuickToolCard key={tool.tab} tool={tool} onLaunch={onLaunch} onOpen={setActiveTab} />)}
      </div>
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-slate-100">Recent diagnostic history</h2>
          <button onClick={() => setActiveTab('history')} className="text-xs text-cyan-400 hover:underline">View all history</button>
        </div>
        {history.length === 0 ? <p className="text-sm text-slate-400">No saved diagnostics yet. Results are stored in this browser.</p> : (
          <ul className="divide-y divide-slate-800">
            {history.slice(0, 5).map(item => <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-slate-200">{item.title}</span><time dateTime={new Date(item.timestamp).toISOString()} className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleString()}</time></div>
              <p className="text-xs text-slate-400 mt-1 break-words">{item.summary}</p>
            </li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
