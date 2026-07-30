import { CidrResult } from '../types';

function ipToLong(ip: string): number {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

function longToIp(long: number): string {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255,
  ].join('.');
}

function longToBinary(long: number): string {
  const bin = (long >>> 0).toString(2).padStart(32, '0');
  return `${bin.slice(0, 8)}.${bin.slice(8, 16)}.${bin.slice(16, 24)}.${bin.slice(24, 32)}`;
}

export function calculateCidr(ipInput: string, prefixInput: number): CidrResult | null {
  const cleanIp = ipInput.trim();
  const prefix = Math.max(0, Math.min(32, prefixInput));

  const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  if (!ipRegex.test(cleanIp)) {
    return null;
  }

  const ipLong = ipToLong(cleanIp);
  const maskLong = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const wildcardLong = ~maskLong >>> 0;

  const networkLong = (ipLong & maskLong) >>> 0;
  const broadcastLong = (networkLong | wildcardLong) >>> 0;

  let firstUsableLong = networkLong;
  let lastUsableLong = broadcastLong;
  let usableHosts = 0;
  const totalHosts = Math.pow(2, 32 - prefix);

  if (prefix === 32) {
    firstUsableLong = networkLong;
    lastUsableLong = networkLong;
    usableHosts = 1;
  } else if (prefix === 31) {
    firstUsableLong = networkLong;
    lastUsableLong = broadcastLong;
    usableHosts = 2; // RFC 3021 Point-to-Point
  } else {
    firstUsableLong = (networkLong + 1) >>> 0;
    lastUsableLong = (broadcastLong - 1) >>> 0;
    usableHosts = Math.max(0, totalHosts - 2);
  }

  const netmask = longToIp(maskLong);
  const wildcard = longToIp(wildcardLong);
  const networkAddress = longToIp(networkLong);
  const broadcastAddress = longToIp(broadcastLong);
  const firstUsableIp = longToIp(firstUsableLong);
  const lastUsableIp = longToIp(lastUsableLong);

  // Private IP check (RFC 1918) & Loopback / Link-Local
  const octets = cleanIp.split('.').map(Number);
  let isPrivate = false;

  if (octets[0] === 10) isPrivate = true; // 10.0.0.0/8
  else if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) isPrivate = true; // 172.16.0.0/12
  else if (octets[0] === 192 && octets[1] === 168) isPrivate = true; // 192.168.0.0/16
  else if (octets[0] === 127) isPrivate = true; // Loopback 127.0.0.0/8
  else if (octets[0] === 169 && octets[1] === 254) isPrivate = true; // Link-local

  // IP Class
  let ipClass = 'Unknown';
  if (octets[0] >= 1 && octets[0] <= 126) ipClass = 'Class A';
  else if (octets[0] === 127) ipClass = 'Class A (Loopback)';
  else if (octets[0] >= 128 && octets[0] <= 191) ipClass = 'Class B';
  else if (octets[0] >= 192 && octets[0] <= 223) ipClass = 'Class C';
  else if (octets[0] >= 224 && octets[0] <= 239) ipClass = 'Class D (Multicast)';
  else if (octets[0] >= 240 && octets[0] <= 255) ipClass = 'Class E (Experimental)';

  return {
    ip: cleanIp,
    prefix,
    netmask,
    wildcard,
    networkAddress,
    broadcastAddress,
    firstUsableIp,
    lastUsableIp,
    totalHosts,
    usableHosts,
    ipClass,
    isPrivate,
    binaryIp: longToBinary(ipLong),
    binaryNetmask: longToBinary(maskLong),
  };
}

export function generateSubnets(networkIp: string, currentPrefix: number, newPrefix: number) {
  if (newPrefix <= currentPrefix || newPrefix > 32) return [];
  const baseCidr = calculateCidr(networkIp, currentPrefix);
  if (!baseCidr) return [];

  const networkLong = ipToLong(baseCidr.networkAddress);
  const subnetCount = Math.pow(2, newPrefix - currentPrefix);
  const subnetSize = Math.pow(2, 32 - newPrefix);

  const results = [];
  const maxToReturn = Math.min(subnetCount, 64); // cap UI to 64 subnets max

  for (let i = 0; i < maxToReturn; i++) {
    const subNetLong = (networkLong + i * subnetSize) >>> 0;
    const subCidr = calculateCidr(longToIp(subNetLong), newPrefix);
    if (subCidr) {
      results.push({
        subnetIndex: i + 1,
        ...subCidr,
      });
    }
  }

  return results;
}
