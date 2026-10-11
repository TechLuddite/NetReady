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

