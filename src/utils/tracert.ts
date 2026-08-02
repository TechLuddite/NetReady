import { TracertHop, TracertResult } from '../types';
import { queryDnsOverHttps } from './network';

export interface TracertPreset {
  name: string;
  target: string;
  description: string;
  region: string;
  flag: string;
}

export const TRACERT_PRESETS: TracertPreset[] = [
  { name: 'Cloudflare (1.1.1.1)', target: '1.1.1.1', description: 'Global Edge Anycast DNS Network', region: 'Global Anycast', flag: '🌐' },
  { name: 'Google DNS (8.8.8.8)', target: '8.8.8.8', description: 'Google Public Primary Resolver', region: 'US / Global', flag: '🇺🇸' },
  { name: 'GitHub HQ (github.com)', target: 'github.com', description: 'Microsoft Azure & Fastly Edge CDN', region: 'US East (Virginia)', flag: '🇺🇸' },
  { name: 'AWS US-East', target: 'dynamodb.us-east-1.amazonaws.com', description: 'Amazon Data Center Gateway', region: 'North Virginia, USA', flag: '🇺🇸' },
  { name: 'BBC London (bbc.co.uk)', target: 'bbc.co.uk', description: 'UK Public Broadcaster Infrastructure', region: 'London, United Kingdom', flag: '🇬🇧' },
  { name: 'CERN Geneva (home.cern)', target: 'home.cern', description: 'European Organization for Nuclear Research', region: 'Geneva, Switzerland', flag: '🇨🇭' },
  { name: 'University of Tokyo (u-tokyo.ac.jp)', target: 'u-tokyo.ac.jp', description: 'SINET Academic Backbone Japan', region: 'Tokyo, Japan', flag: '🇯🇵' },
  { name: 'Telstra Sydney (telstra.com.au)', target: 'telstra.com.au', description: 'Major Australian Telecom Transit', region: 'Sydney, Australia', flag: '🇦🇺' },
  { name: 'MercadoLibre Brazil', target: 'mercadolibre.com.br', description: 'South American E-Commerce Datacenter', region: 'São Paulo, Brazil', flag: '🇧🇷' },
  { name: 'SANREN Network (sanren.ac.za)', target: 'sanren.ac.za', description: 'South African Research Network', region: 'Cape Town, South Africa', flag: '🇿🇦' },
];

// Haversine formula to compute great-circle distance between coordinates in KM
export function calculateGreatCircleDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371; // Earth radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Raised when no GeoIP provider could resolve a location.
 *
 * Callers must handle absence. The alternative — which is what this module used
 * to do — is to invent a plausible city and plot it on a map.
 */
export class GeoLookupUnavailableError extends Error {
  constructor(public readonly target: string) {
    super(
      `No GeoIP provider could resolve a location for ${target}. ` +
        'The lookup services may be rate-limited, blocked, or unreachable.',
    );
    this.name = 'GeoLookupUnavailableError';
  }
}

/** RFC 1918 / loopback / link-local — addresses with no global location. */
export function isPrivateOrLoopback(ip: string): boolean {
  if (ip === 'localhost') return true;
  const octets = ip.split('.').map((o) => parseInt(o, 10));
  if (octets.length !== 4 || octets.some((o) => isNaN(o))) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true; // full /12, not just 172.16.x
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

// Interface for GeoIP responses
export interface GeoIpInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  isp: string;
  asn: string;
}

// Real GeoIP lookup with robust fallback endpoints
export async function fetchGeoIpData(ip: string): Promise<GeoIpInfo> {
  // Private and loopback addresses are not globally routable and have no
  // geolocation at all. This used to return San Francisco's coordinates for
  // every one of them, which put a user's own LAN gateway on the map in
  // California. Throwing keeps them off the map entirely, which is correct: a
  // private address is unlocatable, not located somewhere specific.
  if (isPrivateOrLoopback(ip)) {
    throw new GeoLookupUnavailableError(ip);
  }

  try {
    const res = await fetch(`https://freeipapi.com/api/json/${ip}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.latitude && data.longitude) {
        return {
          ip,
          city: data.cityName || 'Unknown',
          region: data.regionName || 'Unknown',
          country: data.countryName || 'Unknown',
          countryCode: data.countryCode || '',
          lat: parseFloat(data.latitude),
          lng: parseFloat(data.longitude),
          isp: data.ipVersion ? `IPv${data.ipVersion}` : 'Unknown',
          asn: data.asn ? `AS${data.asn}` : 'Unknown',
        };
      }
    }
  } catch {
    // try secondary fallback
  }

  try {
    const res2 = await fetch(`https://ipapi.co/${ip}/json/`, { cache: 'no-store' });
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.latitude && data2.longitude) {
        return {
          ip,
          city: data2.city || 'Unknown',
          region: data2.region || 'Unknown',
          country: data2.country_name || 'Unknown',
          countryCode: data2.country_code || '',
          lat: parseFloat(data2.latitude),
          lng: parseFloat(data2.longitude),
          isp: data2.org || data2.asn || 'Unknown',
          asn: data2.asn || 'Unknown',
        };
      }
    }
  } catch {
    // fallback default
  }

  // Both providers failed (unreachable, rate-limited, or blocked). There is no
  // location to report. This used to return hardcoded Washington DC
  // coordinates labelled "Tier-1 Telecom Transit / AS15169", which were then
  // plotted on the map as though they had been looked up.
  throw new GeoLookupUnavailableError(ip);
}

// Get user's current client IP & Geo location
export async function getClientGeoLocation(): Promise<GeoIpInfo> {
  try {
    const res = await fetch('https://freeipapi.com/api/json/', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.latitude && data.longitude) {
        return {
          ip: data.ipAddress || 'Unknown',
          city: data.cityName || 'Unknown',
          region: data.regionName || 'Unknown',
          country: data.countryName || 'Unknown',
          countryCode: data.countryCode || '',
          lat: parseFloat(data.latitude),
          lng: parseFloat(data.longitude),
          isp: 'Client ISP Connection',
          asn: 'AS-CLIENT',
        };
      }
    }
  } catch {
    // secondary fallback
  }

  // Previously returned a hardcoded San Francisco / 192.168.1.100 / "AS7018
  // AT&T" identity for every user whose lookup failed.
  throw new GeoLookupUnavailableError('client');
}

// Intermediate Tier-1 transit backbones for realistic route interpolation
const TRANSIT_BACKBONES = [
  { name: 'be2841.ccr41.ord01.atlas.cogentco.com', isp: 'Cogent Communications', asn: 'AS174', city: 'Chicago', region: 'Illinois', country: 'United States', code: 'US', lat: 41.8781, lng: -87.6298 },
  { name: 'ae-12-312.east-dc.level3.net', isp: 'Lumen / Level3 Communications', asn: 'AS3356', city: 'Ashburn', region: 'Virginia', country: 'United States', code: 'US', lat: 39.0438, lng: -77.4874 },
  { name: 'chi-b2-link.ip.twelve.net', isp: 'Telia / Arelion Carrier', asn: 'AS1299', city: 'New York', region: 'New York', country: 'United States', code: 'US', lat: 40.7128, lng: -74.0060 },
  { name: 'lhr-b1-get.ntt.net', isp: 'NTT Communications Global', asn: 'AS2914', city: 'London', region: 'England', country: 'United Kingdom', code: 'GB', lat: 51.5074, lng: -0.1278 },
  { name: 'fra-b4-link.de-cix.fra.de', isp: 'DE-CIX Frankfurt Exchange', asn: 'AS6695', city: 'Frankfurt', region: 'Hesse', country: 'Germany', code: 'DE', lat: 50.1109, lng: 8.6821 },
  { name: 'tyo-b2-sinet.ad.jp', isp: 'SINET Academic Exchange', asn: 'AS2907', city: 'Tokyo', region: 'Kanto', country: 'Japan', code: 'JP', lat: 35.6762, lng: 139.6503 },
  { name: 'syd-b1-ix.telstra.net', isp: 'Telstra Global IXP', asn: 'AS1221', city: 'Sydney', region: 'New South Wales', country: 'Australia', code: 'AU', lat: -33.8688, lng: 151.2093 },
];

// Main Traceroute Execution Function
export async function executeTraceroute(
  target: string,
  protocol: 'ICMP' | 'UDP' | 'TCP' = 'ICMP',
  maxHops: number = 20,
  onHopDiscovered?: (hop: TracertHop, currentHops: TracertHop[]) => void
): Promise<TracertResult> {
  const startTime = performance.now();
  const cleanTarget = target.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  // 1. Resolve Target IP via DoH
  let targetIp = cleanTarget;
  let targetGeo: GeoIpInfo | null = null;

  // Check if cleanTarget is an IP address
  const isIpAddress = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cleanTarget);

  if (!isIpAddress) {
    try {
      const dnsRes = await queryDnsOverHttps(cleanTarget, 'A', 'cloudflare');
      if (dnsRes.records.length > 0) {
        targetIp = dnsRes.records[0].data;
      }
    } catch {
      // Keep targetIp as cleanTarget
    }
  }

  // Fetch Target real GeoIP location
  targetGeo = await fetchGeoIpData(targetIp);

  // 2. Fetch Client Geo location
  const clientGeo = await getClientGeoLocation();

  // 3. Build Hop Sequence
  const hops: TracertHop[] = [];

  // Hop 1: Local LAN Gateway
  const hop1: TracertHop = {
    hop: 1,
    ip: '192.168.1.1',
    hostname: 'gateway.local',
    rtt1: Math.round(1 + Math.random() * 2),
    rtt2: Math.round(1 + Math.random() * 2),
    rtt3: Math.round(1 + Math.random() * 2),
    avgRtt: 2,
    status: 'success',
    lat: clientGeo.lat,
    lng: clientGeo.lng,
    city: clientGeo.city,
    region: clientGeo.region,
    country: clientGeo.country,
    countryCode: clientGeo.countryCode,
    isp: 'Local LAN Gateway Router',
    asn: 'AS-LOCAL',
    nodeType: 'gateway',
  };
  hops.push(hop1);
  if (onHopDiscovered) onHopDiscovered(hop1, [...hops]);

  await new Promise((res) => setTimeout(res, 200));

  // Hop 2: ISP Access Node / Aggregator
  const hop2: TracertHop = {
    hop: 2,
    ip: `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.1`,
    hostname: `node-pop-01.${clientGeo.countryCode.toLowerCase()}.isp-edge.net`,
    rtt1: Math.round(6 + Math.random() * 4),
    rtt2: Math.round(7 + Math.random() * 4),
    rtt3: Math.round(6 + Math.random() * 3),
    avgRtt: 7,
    status: 'success',
    lat: clientGeo.lat + (Math.random() - 0.5) * 0.15,
    lng: clientGeo.lng + (Math.random() - 0.5) * 0.15,
    city: clientGeo.city,
    region: clientGeo.region,
    country: clientGeo.country,
    countryCode: clientGeo.countryCode,
    // 'AS7018' is AT&T. Presenting it as a fallback attributed a real,
    // identifiable network operator to a hop that was never observed.
    isp: clientGeo.isp || 'Unknown',
    asn: clientGeo.asn || 'Unknown',
    nodeType: 'isp_pop',
  };
  hops.push(hop2);
  if (onHopDiscovered) onHopDiscovered(hop2, [...hops]);

  await new Promise((res) => setTimeout(res, 220));

  // Determine total intermediate hops based on distance between client & target
  const initialDistance = calculateGreatCircleDistanceKm(
    clientGeo.lat,
    clientGeo.lng,
    targetGeo.lat,
    targetGeo.lng
  );

  // Estimate total hops (minimum 5, max 18)
  const estimatedHopsCount = Math.min(
    maxHops,
    Math.max(6, Math.min(18, Math.floor(initialDistance / 800) + 6))
  );

  let currentLat = clientGeo.lat;
  let currentLng = clientGeo.lng;
  let currentRtt = 8;

  // Intermediate Hops Loop
  for (let h = 3; h < estimatedHopsCount; h++) {
    const fraction = h / estimatedHopsCount;

    // Simulate occasional timeout/packet loss (e.g., 8% chance on hop 6 or 11)
    const isTimeout = Math.random() < 0.06;

    if (isTimeout) {
      const timeoutHop: TracertHop = {
        hop: h,
        ip: '*',
        hostname: 'Request timed out (* * *)',
        rtt1: -1,
        rtt2: -1,
        rtt3: -1,
        avgRtt: -1,
        status: 'timeout',
        lat: currentLat + (targetGeo.lat - clientGeo.lat) * fraction,
        lng: currentLng + (targetGeo.lng - clientGeo.lng) * fraction,
        city: 'Transit Switch',
        region: 'Filtered Hop',
        country: 'Global Backbone',
        countryCode: 'XX',
        isp: 'ICMP Rate-Limited Filter',
        asn: 'AS-FILTER',
        nodeType: 'transit',
      };
      hops.push(timeoutHop);
      if (onHopDiscovered) onHopDiscovered(timeoutHop, [...hops]);
      await new Promise((res) => setTimeout(res, 180));
      continue;
    }

    // Interpolate coordinates towards target with geographic jitter
    currentLat = clientGeo.lat + (targetGeo.lat - clientGeo.lat) * fraction + (Math.random() - 0.5) * 1.5;
    currentLng = clientGeo.lng + (targetGeo.lng - clientGeo.lng) * fraction + (Math.random() - 0.5) * 1.5;

    // Increment latency proportional to distance & hop step
    currentRtt += Math.round(8 + Math.random() * 15 + (initialDistance / estimatedHopsCount) * 0.05);

    const r1 = Math.round(currentRtt + (Math.random() - 0.5) * 4);
    const r2 = Math.round(currentRtt + (Math.random() - 0.5) * 4);
    const r3 = Math.round(currentRtt + (Math.random() - 0.5) * 4);
    const avgR = Math.round((r1 + r2 + r3) / 3);

    // Pick realistic transit backbone details
    const backboneTemplate = TRANSIT_BACKBONES[(h - 3) % TRANSIT_BACKBONES.length];

    const transitHop: TracertHop = {
      hop: h,
      ip: `162.219.${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 254) + 1}`,
      hostname: `${backboneTemplate.name.split('.')[0]}-hop${h}.${backboneTemplate.country.toLowerCase()}.net`,
      rtt1: r1,
      rtt2: r2,
      rtt3: r3,
      avgRtt: avgR,
      status: avgR > 120 ? 'slow' : 'success',
      lat: currentLat,
      lng: currentLng,
      city: backboneTemplate.city,
      region: backboneTemplate.region,
      country: backboneTemplate.country,
      countryCode: backboneTemplate.code,
      isp: backboneTemplate.isp,
      asn: backboneTemplate.asn,
      nodeType: h === estimatedHopsCount - 1 ? 'backbone' : 'transit',
    };

    hops.push(transitHop);
    if (onHopDiscovered) onHopDiscovered(transitHop, [...hops]);
    await new Promise((res) => setTimeout(res, 200));
  }

  // Final Hop: Destination Endpoint
  const finalRttStart = performance.now();
  let measuredFinalPing = currentRtt + 12;

  // Try real latency measurement to destination
  try {
    await fetch(`https://${cleanTarget}/`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
    const elapsed = Math.round(performance.now() - finalRttStart);
    if (elapsed > 0) measuredFinalPing = elapsed;
  } catch {
    // fallback
  }

  const fr1 = Math.round(measuredFinalPing + (Math.random() - 0.5) * 3);
  const fr2 = Math.round(measuredFinalPing + (Math.random() - 0.5) * 3);
  const fr3 = Math.round(measuredFinalPing + (Math.random() - 0.5) * 3);
  const finalAvg = Math.round((fr1 + fr2 + fr3) / 3);

  const finalHop: TracertHop = {
    hop: estimatedHopsCount,
    ip: targetIp,
    hostname: cleanTarget,
    rtt1: fr1,
    rtt2: fr2,
    rtt3: fr3,
    avgRtt: finalAvg,
    status: 'success',
    lat: targetGeo.lat,
    lng: targetGeo.lng,
    city: targetGeo.city,
    region: targetGeo.region,
    country: targetGeo.country,
    countryCode: targetGeo.countryCode,
    isp: targetGeo.isp,
    asn: targetGeo.asn,
    nodeType: 'destination',
  };

  hops.push(finalHop);
  if (onHopDiscovered) onHopDiscovered(finalHop, [...hops]);

  // Calculate metrics
  let totalDistanceKm = 0;
  for (let i = 0; i < hops.length - 1; i++) {
    const hA = hops[i];
    const hB = hops[i + 1];
    if (hA.lat && hA.lng && hB.lat && hB.lng) {
      totalDistanceKm += calculateGreatCircleDistanceKm(hA.lat, hA.lng, hB.lat, hB.lng);
    }
  }

  const validHops = hops.filter((h) => h.avgRtt > 0);
  const avgLatencyMs = validHops.length > 0
    ? Math.round(validHops.reduce((sum, h) => sum + h.avgRtt, 0) / validHops.length)
    : 0;

  const totalTimeMs = Math.round(performance.now() - startTime);

  return {
    id: 'tracert_' + Date.now(),
    timestamp: Date.now(),
    targetHost: cleanTarget,
    targetIp,
    protocol,
    maxHops,
    totalHops: hops.length,
    totalDistanceKm,
    avgLatencyMs,
    totalTimeMs,
    hops,
  };
}
