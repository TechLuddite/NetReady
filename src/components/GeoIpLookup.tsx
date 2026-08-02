import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Search,
  Shield,
  Compass,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Navigation,
  Server,
  Radio,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { GeoIpResult } from '../types';
import { saveHistoryItem } from '../utils/storage';

interface GeoIpLookupProps {
  onHistoryUpdate?: () => void;
}

export const GeoIpLookup: React.FC<GeoIpLookupProps> = ({ onHistoryUpdate }) => {
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeoIpResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeQuickTab, setActiveQuickTab] = useState<string>('myip');

  // Helper to resolve domain to IP via DNS over HTTPS if domain entered
  const resolveDomainToIp = async (query: string): Promise<string> => {
    const clean = query.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    // Check if it's already an IP (v4 or v6)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}$/;
    
    if (ipv4Regex.test(clean) || ipv6Regex.test(clean)) {
      return clean;
    }

    // Attempt DoH resolution
    try {
      const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(clean)}&type=A`);
      if (res.ok) {
        const data = await res.json();
        if (data.Answer && data.Answer.length > 0) {
          const aRecord = data.Answer.find((ans: any) => ans.type === 1);
          if (aRecord && aRecord.data) {
            return aRecord.data;
          }
        }
      }
    } catch (e) {
      console.warn('DNS lookup fallback error:', e);
    }
    return clean;
  };

  const performLookup = async (targetIpOrDomain?: string) => {
    setLoading(true);
    setError(null);

    const rawQuery = targetIpOrDomain !== undefined ? targetIpOrDomain : inputQuery;
    const cleanQuery = rawQuery.trim();

    try {
      let targetIp = '';
      if (cleanQuery) {
        targetIp = await resolveDomainToIp(cleanQuery);
      }

      // Try Primary Geolocation API: ipwho.is (Supports HTTPS & CORS)
      let geoData: any = null;
      let apiSuccess = false;

      const primaryUrl = targetIp
        ? `https://ipwho.is/${encodeURIComponent(targetIp)}`
        : `https://ipwho.is/`;

      try {
        const response = await fetch(primaryUrl);
        if (response.ok) {
          const json = await response.json();
          if (json && json.success !== false) {
            geoData = {
              ip: json.ip,
              city: json.city || 'Unknown City',
              region: json.region || 'Unknown Region',
              country: json.country || 'Unknown Country',
              countryCode: json.country_code || 'UN',
              flag: json.flag?.emoji || '🌐',
              postal: json.postal || 'N/A',
              lat: json.latitude || 0,
              lng: json.longitude || 0,
              timezone: json.timezone?.id ? `${json.timezone.id} (${json.timezone.utc || ''})` : 'UTC',
              isp: json.connection?.isp || json.connection?.org || 'Unknown ISP',
              org: json.connection?.org || json.connection?.isp || '',
              asn: json.connection?.asn ? `AS${json.connection.asn}` : '',
              callingCode: json.calling_code ? `+${json.calling_code}` : '',
              currency: json.currency ? `${json.currency.code} (${json.currency.symbol || ''})` : '',
              isProxy: json.security?.proxy || false,
              isVpn: json.security?.vpn || false,
            };
            apiSuccess = true;
          }
        }
      } catch (errPrimary) {
        console.warn('ipwho.is API failed, attempting fallback...', errPrimary);
      }

      // Secondary Fallback API: ipapi.co
      if (!apiSuccess) {
        try {
          const fallbackUrl = targetIp
            ? `https://ipapi.co/${encodeURIComponent(targetIp)}/json/`
            : `https://ipapi.co/json/`;
          
          const fallbackRes = await fetch(fallbackUrl);
          if (fallbackRes.ok) {
            const json = await fallbackRes.json();
            if (json && !json.error) {
              geoData = {
                ip: json.ip,
                city: json.city || 'Unknown City',
                region: json.region || 'Unknown Region',
                country: json.country_name || 'Unknown Country',
                countryCode: json.country_code || 'UN',
                flag: '🌐',
                postal: json.postal || 'N/A',
                lat: json.latitude || 0,
                lng: json.longitude || 0,
                timezone: json.timezone || 'UTC',
                isp: json.org || json.asn || 'Unknown ISP',
                org: json.org || '',
                asn: json.asn || '',
                callingCode: json.country_calling_code || '',
                currency: json.currency || '',
                isProxy: false,
                isVpn: false,
              };
              apiSuccess = true;
            }
          }
        } catch (errFallback) {
          console.warn('ipapi.co API fallback failed:', errFallback);
        }
      }

      if (!apiSuccess || !geoData) {
        throw new Error(`Unable to fetch geolocation data for "${cleanQuery || 'Current IP'}". Please verify the IP/domain or try again.`);
      }

      const lookupResult: GeoIpResult = {
        id: `geoip_${Date.now()}`,
        timestamp: Date.now(),
        query: cleanQuery || 'My Public IP',
        ...geoData,
      };

      setResult(lookupResult);

      // Save to global storage history
      saveHistoryItem({
        id: lookupResult.id,
        type: 'geoip',
        timestamp: lookupResult.timestamp,
        title: `GeoIP: ${lookupResult.ip}`,
        summary: `${lookupResult.city}, ${lookupResult.country} • ${lookupResult.isp}`,
        data: lookupResult,
      });

      if (onHistoryUpdate) {
        onHistoryUpdate();
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during GeoIP lookup.');
    } finally {
      setLoading(false);
    }
  };

  // Perform initial lookup on mount for user's own public IP
  useEffect(() => {
    performLookup('');
  }, []);

  const handlePresetSelect = (ip: string, tabName: string) => {
    setActiveQuickTab(tabName);
    setInputQuery(ip);
    performLookup(ip);
  };

  const handleCopy = () => {
    if (!result) return;
    const text = `IP: ${result.ip}\nLocation: ${result.city}, ${result.region}, ${result.country}\nCoordinates: ${result.lat}, ${result.lng}\nISP: ${result.isp}\nASN: ${result.asn || 'N/A'}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-60 h-60 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center space-x-2.5 mb-1">
              <span className="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-500/20">
                <Compass className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-bold text-slate-100">IP Geolocation & ISP Inspector</h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full uppercase">
                GeoIP Workstation
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Inspect physical geolocation coordinates, Autonomous System Number (ASN), Internet Service Provider (ISP), timezone, and proxy/VPN security status for any IPv4/IPv6 address or domain.
            </p>
          </div>

          <button
            onClick={() => performLookup(inputQuery)}
            disabled={loading}
            className="flex items-center space-x-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Querying...' : 'Refresh GeoIP'}</span>
          </button>
        </div>

        {/* Input Controls & Quick Targets */}
        <div className="mt-5 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              performLookup(inputQuery);
            }}
            className="flex flex-col sm:flex-row items-center gap-2"
          >
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="Enter IP address (e.g. 8.8.8.8, 1.1.1.1) or Domain (e.g. cloudflare.com)..."
                className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-cyan-500 text-slate-100 placeholder-slate-500 text-xs font-mono rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold text-xs px-5 py-3 rounded-xl transition-all cursor-pointer shrink-0"
            >
              Lookup Address
            </button>
          </form>

          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="text-slate-500 text-[11px] uppercase tracking-wider font-sans">Presets:</span>
            
            <button
              type="button"
              onClick={() => handlePresetSelect('', 'myip')}
              className={`px-3 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
                activeQuickTab === 'myip'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
              }`}
            >
              My Public IP
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('1.1.1.1', 'cloudflare')}
              className={`px-3 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
                activeQuickTab === 'cloudflare'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
              }`}
            >
              Cloudflare (1.1.1.1)
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('8.8.8.8', 'google')}
              className={`px-3 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
                activeQuickTab === 'google'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
              }`}
            >
              Google DNS (8.8.8.8)
            </button>

            <button
              type="button"
              onClick={() => handlePresetSelect('9.9.9.9', 'quad9')}
              className={`px-3 py-1 rounded-lg border text-[11px] transition-all cursor-pointer ${
                activeQuickTab === 'quad9'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
              }`}
            >
              Quad9 (9.9.9.9)
            </button>
          </div>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <div className="inline-flex p-4 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <Radio className="w-8 h-8 animate-spin" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Querying Geolocation Servers</h3>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Resolving latitude/longitude coordinates, ASN records, and ISP metadata...
            </p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-300 space-y-2">
          <div className="flex items-center space-x-2 font-bold text-sm">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <span>GeoIP Query Failed</span>
          </div>
          <p className="text-xs font-mono text-rose-200">{error}</p>
        </div>
      )}

      {/* Main Results Display */}
      {result && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Key Location & ISP Overview (2 Cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Primary Location Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center space-x-3">
                    <span className="text-3xl">{result.flag || '🌐'}</span>
                    <div>
                      <h2 className="text-2xl font-extrabold text-white tracking-tight">
                        {result.city}, {result.country}
                      </h2>
                      <p className="text-xs text-slate-400 font-mono">
                        {result.region} {result.postal !== 'N/A' ? `• Postal: ${result.postal}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
                  title="Copy GeoIP Details"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Details</span>
                    </>
                  )}
                </button>
              </div>

              {/* Grid of Geolocation Attributes */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {/* IP Address */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    IP Address
                  </span>
                  <span className="text-sm font-bold font-mono text-cyan-400 block truncate">
                    {result.ip}
                  </span>
                </div>

                {/* Country Code */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    Country Code
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-200 block">
                    {result.countryCode} ({result.country})
                  </span>
                </div>

                {/* Coordinates */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    Coordinates
                  </span>
                  <span className="text-sm font-bold font-mono text-emerald-400 block">
                    {result.lat.toFixed(4)}, {result.lng.toFixed(4)}
                  </span>
                </div>

                {/* Timezone */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    Timezone
                  </span>
                  <span className="text-xs font-semibold font-mono text-slate-200 block truncate">
                    {result.timezone || 'UTC'}
                  </span>
                </div>

                {/* Calling Code */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    Calling Code
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-200 block">
                    {result.callingCode || 'N/A'}
                  </span>
                </div>

                {/* Currency */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                    Currency
                  </span>
                  <span className="text-sm font-bold font-mono text-slate-200 block">
                    {result.currency || 'N/A'}
                  </span>
                </div>
              </div>

              {/* ISP & Autonomous System (ASN) Card */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800/80 pb-2">
                  <Server className="w-4 h-4 text-cyan-400" />
                  <span>Network Carrier & Organization</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Internet Service Provider (ISP)</span>
                    <span className="text-slate-100 font-bold">{result.isp}</span>
                  </div>

                  {result.asn && (
                    <div>
                      <span className="text-[10px] text-slate-500 block">Autonomous System (ASN)</span>
                      <span className="text-cyan-300 font-bold">{result.asn}</span>
                    </div>
                  )}

                  {result.org && result.org !== result.isp && (
                    <div className="sm:col-span-2">
                      <span className="text-[10px] text-slate-500 block">Organization</span>
                      <span className="text-slate-300">{result.org}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Security & Proxy Detection Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Network & Proxy Security Signals
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-slate-500">Security Telemetry</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-slate-400">Proxy Detected</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      result.isProxy
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {result.isProxy ? 'YES' : 'NO'}
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-slate-400">VPN Node</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      result.isVpn
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {result.isVpn ? 'YES' : 'NO'}
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between col-span-2 sm:col-span-1">
                  <span className="text-slate-400">IP Version</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                    {result.ip.includes(':') ? 'IPv6' : 'IPv4'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Geographic Map Coordinates & External Link (1 Col) */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Geographic Coordinates
                  </h3>
                </div>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${result.lat}&mlon=${result.lng}#map=11/${result.lat}/${result.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center space-x-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <span>OpenMap</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* OpenStreetMap Iframe or Radar Box */}
              <div className="h-64 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 relative group">
                <iframe
                  title="GeoIP OpenStreetMap"
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  scrolling="no"
                  marginHeight={0}
                  marginWidth={0}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${result.lng - 0.15}%2C${
                    result.lat - 0.15
                  }%2C${result.lng + 0.15}%2C${result.lat + 0.15}&layer=mapnik&marker=${result.lat}%2C${
                    result.lng
                  }`}
                  className="grayscale opacity-85 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300"
                />
                
                {/* Overlay Badge */}
                <div className="absolute bottom-2 left-2 right-2 bg-slate-950/90 border border-slate-800 backdrop-blur-md rounded-lg p-2 text-[10px] font-mono text-slate-300 flex items-center justify-between pointer-events-none">
                  <span className="truncate">Lat: {result.lat.toFixed(4)}, Lng: {result.lng.toFixed(4)}</span>
                  <span className="text-emerald-400 font-bold shrink-0 ml-1">Verified Location</span>
                </div>
              </div>

              {/* Quick Actions & Export */}
              <div className="space-y-2">
                <a
                  href={`https://maps.google.com/?q=${result.lat},${result.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2.5 rounded-xl text-xs font-semibold transition-all"
                >
                  <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                  <span>View in Google Maps</span>
                </a>
              </div>
            </div>

            {/* Documentation Note */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 text-[11px] text-slate-400 space-y-2">
              <div className="flex items-center space-x-1.5 font-bold text-slate-300">
                <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                <span>About GeoIP Accuracy</span>
              </div>
              <p className="leading-relaxed">
                IP Geolocation determines the approximate physical location of the Internet Service Provider's point of presence (POP) or routing gateway. Accuracy is generally within city-level precision.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
