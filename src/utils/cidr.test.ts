import { describe, it, expect } from 'vitest';
import { calculateCidr, generateSubnets } from './cidr';

describe('calculateCidr', () => {
  it('computes a /24', () => {
    const r = calculateCidr('192.168.1.10', 24);
    expect(r).not.toBeNull();
    expect(r!.networkAddress).toBe('192.168.1.0');
    expect(r!.broadcastAddress).toBe('192.168.1.255');
    expect(r!.netmask).toBe('255.255.255.0');
    expect(r!.wildcard).toBe('0.0.0.255');
    expect(r!.firstUsableIp).toBe('192.168.1.1');
    expect(r!.lastUsableIp).toBe('192.168.1.254');
    expect(r!.totalHosts).toBe(256);
    expect(r!.usableHosts).toBe(254);
    expect(r!.isPrivate).toBe(true);
  });

  it('handles a /31 point-to-point link per RFC 3021', () => {
    // Both addresses are usable on a /31; there is no network/broadcast pair.
    const r = calculateCidr('10.0.0.0', 31);
    expect(r!.usableHosts).toBe(2);
    expect(r!.firstUsableIp).toBe('10.0.0.0');
    expect(r!.lastUsableIp).toBe('10.0.0.1');
  });

  it('handles a /32 single host', () => {
    const r = calculateCidr('10.0.0.7', 32);
    expect(r!.totalHosts).toBe(1);
    expect(r!.usableHosts).toBe(1);
    expect(r!.firstUsableIp).toBe('10.0.0.7');
    expect(r!.lastUsableIp).toBe('10.0.0.7');
  });

  it('computes a /16', () => {
    const r = calculateCidr('172.16.5.4', 16);
    expect(r!.networkAddress).toBe('172.16.0.0');
    expect(r!.broadcastAddress).toBe('172.16.255.255');
    expect(r!.usableHosts).toBe(65534);
    expect(r!.isPrivate).toBe(true);
  });

  it('identifies public address space', () => {
    expect(calculateCidr('8.8.8.8', 24)!.isPrivate).toBe(false);
  });

  it('rejects malformed addresses', () => {
    expect(calculateCidr('not-an-ip', 24)).toBeNull();
    expect(calculateCidr('999.1.1.1', 24)).toBeNull();
    expect(calculateCidr('192.168.1', 24)).toBeNull();
    expect(calculateCidr('', 24)).toBeNull();
  });

  it('clamps an out-of-range prefix instead of throwing', () => {
    expect(calculateCidr('192.168.1.1', 33)!.prefix).toBe(32);
    expect(calculateCidr('192.168.1.1', -5)!.prefix).toBe(0);
  });

  it('produces 32 binary digits plus separators', () => {
    const r = calculateCidr('192.168.1.1', 24);
    expect(r!.binaryIp.replace(/\./g, '')).toHaveLength(32);
    expect(r!.binaryNetmask.replace(/\./g, '')).toHaveLength(32);
  });
});

describe('generateSubnets', () => {
  it('splits a /24 into four /26 blocks', () => {
    const subnets = generateSubnets('192.168.1.0', 24, 26);
    expect(subnets).toHaveLength(4);
    expect(subnets[0].networkAddress).toBe('192.168.1.0');
    expect(subnets[3].networkAddress).toBe('192.168.1.192');
  });

  it('returns nothing when the new prefix is not longer', () => {
    expect(generateSubnets('192.168.1.0', 24, 24)).toHaveLength(0);
    expect(generateSubnets('192.168.1.0', 24, 16)).toHaveLength(0);
  });

  it('caps output rather than enumerating an unbounded split', () => {
    expect(generateSubnets('10.0.0.0', 8, 32).length).toBeLessThanOrEqual(64);
  });
});
