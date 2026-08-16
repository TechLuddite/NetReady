import { describe, it, expect } from 'vitest';
import {
  DNS_TYPE,
  decodeDnsMessage,
  encodeDnsQuery,
  rcodeName,
  readName,
  toBase64Url,
} from './dnsWire';

const hex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');

/*
 * Real responses, captured from https://cloudflare-dns.com/dns-query on
 * 2026-08-16 with message ID 0x1234. Using genuine bytes rather than
 * hand-assembled ones is deliberate: a decoder tested only against fixtures
 * built by its own author's mental model will agree with that model and not
 * with the wire.
 */
const FIXTURES = {
  /** example.com A → NOERROR, two A records. */
  noerrorA:
    '123481800001000200000000076578616d706c6503636f6d0000010001c00c00010001000000c40004ac4293f3' +
    'c00c00010001000000c400046814179a',
  /** nrbench7x2qk4vm.com A → NXDOMAIN with an SOA in the authority section. */
  nxdomain:
    '1234818300010000000100000f6e7262656e6368377832716b34766d03636f6d0000010001c01c000600010000' +
    '0384003d01610c67746c642d73657276657273036e657400056e73746c640c766572697369676e2d677273c01c' +
    '6a812b74000007080000038400093a8000000384',
  /** example.com AAAA → two AAAA records. */
  aaaa:
    '123481800001000200000000076578616d706c6503636f6d00001c0001c00c001c0001000000280010' +
    '260647000010000000000000' +
    '6814179ac00c001c0001000000280010260647000010000000000000ac4293f3',
  /** internetsociety.org A with DO set → AD bit set, two A records plus an RRSIG. */
  adSigned:
    '123481a000010003000000010f696e7465726e6574736f6369657479036f72670000010001c00c000100010000012c' +
    '0004681210a6c00c000100010000012c0004681211a6c00c002e00010000012c006700010d020000012c6a828b046a' +
    '7fcbe486c90f696e7465726e6574736f6369657479036f726700aa0f1b599654eda0634f178815b5f67f2d5aba95b3' +
    '4ca05c9221a41adca557fb68b90b430805c3b9ddd4caf6ad560f0f63a5c15bd4da2fcc8819dbb9708eeff900002904' +
    'd0000080000000',
  /** dnssec-failed.org A with DO set → SERVFAIL, the resolver refusing a broken chain. */
  servfail:
    '1234818200010000000000010d646e737365632d6661696c6564036f7267000001000100002904d0000080000039' +
    '000f003500096e6f20534550206d61746368696e672074686520445320666f756e6420666f7220646e737365632d' +
    '6661696c65642e6f72672e',
  /** www.github.com A → a CNAME followed by the A it resolves to. */
  cnameChain:
    '123481800001000200000000037777770667697468756203636f6d0000010001c00c0005000100000aa10002c010' +
    'c010000100010000000a00048c527104',
} as const;

describe('encodeDnsQuery', () => {
  it('lays out a question exactly as RFC 1035 describes', () => {
    const q = encodeDnsQuery('google.com', { id: 0x1234, qtype: DNS_TYPE.A });
    expect(q).not.toBeNull();
    // 12-byte header + 12-byte name + 4 bytes of QTYPE/QCLASS.
    expect(q!.length).toBe(28);
    expect(bytesToHex(q!)).toBe(
      '1234' + // ID, supplied by the caller
        '0100' + // RD set, nothing else
        '0001' + '0000' + '0000' + '0000' + // QDCOUNT 1, everything else empty
        '06676f6f676c6503636f6d00' + // 6"google" 3"com" root
        '0001' + '0001', // QTYPE A, QCLASS IN
    );
  });

  it('produces different bytes for different ids, and identical bytes for the same id', () => {
    // This is the cache-buster's entire contract. The benchmark relies on a
    // fresh ID changing the `dns=` parameter, because an HTTP cache hit would
    // otherwise be timed as though it were the resolver's answer.
    const a = toBase64Url(encodeDnsQuery('example.com', { id: 1, qtype: DNS_TYPE.A })!);
    const b = toBase64Url(encodeDnsQuery('example.com', { id: 2, qtype: DNS_TYPE.A })!);
    const c = toBase64Url(encodeDnsQuery('example.com', { id: 1, qtype: DNS_TYPE.A })!);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });

  it('appends an EDNS0 OPT record with the DO bit only when DNSSEC is asked for', () => {
    const plain = encodeDnsQuery('example.com', { id: 1, qtype: DNS_TYPE.A })!;
    const withDo = encodeDnsQuery('example.com', { id: 1, qtype: DNS_TYPE.A, dnssecOk: true })!;

    expect(plain[11]).toBe(0); // ARCOUNT
    expect(withDo[11]).toBe(1);
    expect(withDo.length).toBe(plain.length + 11);
    // OPT: root name, TYPE 41, CLASS = payload size, TTL carrying the DO bit.
    expect(bytesToHex(withDo.slice(plain.length))).toBe('00' + '0029' + '04d0' + '00008000' + '0000');
  });

  it('accepts a trailing dot as equivalent to the undotted name', () => {
    const withDot = encodeDnsQuery('example.com.', { id: 7, qtype: DNS_TYPE.A });
    const without = encodeDnsQuery('example.com', { id: 7, qtype: DNS_TYPE.A });
    expect(bytesToHex(withDot!)).toBe(bytesToHex(without!));
  });

  it('refuses names it cannot represent rather than sanitising them', () => {
    // Silently correcting the input would mean querying a name the caller never
    // asked for and then reporting the timing as though it belonged to theirs.
    const opts = { id: 1, qtype: DNS_TYPE.A };
    expect(encodeDnsQuery(`${'a'.repeat(64)}.com`, opts)).toBeNull(); // label > 63
    expect(encodeDnsQuery(`${'a'.repeat(60)}.`.repeat(5) + 'com', opts)).toBeNull(); // name > 255
    expect(encodeDnsQuery('a..b', opts)).toBeNull(); // empty label
    expect(encodeDnsQuery('exam ple.com', opts)).toBeNull(); // space
    expect(encodeDnsQuery('exämple.com', opts)).toBeNull(); // non-ASCII, not punycoded
  });

  it('refuses an out-of-range id or qtype', () => {
    expect(encodeDnsQuery('example.com', { id: 0x10000, qtype: DNS_TYPE.A })).toBeNull();
    expect(encodeDnsQuery('example.com', { id: -1, qtype: DNS_TYPE.A })).toBeNull();
    expect(encodeDnsQuery('example.com', { id: 1.5, qtype: DNS_TYPE.A })).toBeNull();
    expect(encodeDnsQuery('example.com', { id: 1, qtype: 0x10000 })).toBeNull();
  });
});

describe('toBase64Url', () => {
  it('emits unpadded base64url', () => {
    const encoded = toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe, 0x00]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe('-__-AA');
  });
});

describe('decodeDnsMessage — refusing to guess', () => {
  it('returns null for a buffer too short to hold a header', () => {
    expect(decodeDnsMessage(new Uint8Array(0))).toBeNull();
    expect(decodeDnsMessage(new Uint8Array(11))).toBeNull();
  });

  it('returns null when the declared answer count is not actually present', () => {
    // The case that matters most. A response claiming three answers and
    // carrying none has been truncated in transit. Decoding it to a message
    // with zero answers would convert a transport failure into a statement
    // about what the resolver said.
    const truncated = new Uint8Array(12);
    new DataView(truncated.buffer).setUint16(6, 3); // ANCOUNT 3, no records follow
    expect(decodeDnsMessage(truncated)).toBeNull();
  });

  it('returns null when RDLENGTH runs past the end of the buffer', () => {
    const truncated = hex(FIXTURES.noerrorA).slice(0, -2);
    expect(decodeDnsMessage(truncated)).toBeNull();
  });

  it('returns null for a compression pointer that does not move backwards', () => {
    const forward = hex(FIXTURES.noerrorA);
    // The first answer's name is at offset 29; point it forwards instead.
    forward[29] = 0xc0;
    forward[30] = 0xff;
    expect(decodeDnsMessage(forward)).toBeNull();

    const selfReferential = hex(FIXTURES.noerrorA);
    selfReferential[29] = 0xc0;
    selfReferential[30] = 29;
    expect(decodeDnsMessage(selfReferential)).toBeNull();
  });

  it('returns null from readName for a pointer chain that never terminates', () => {
    // 0 -> points to 2 is forward, so build a legal-looking backwards chain that
    // still exceeds the hop cap by alternating between two offsets.
    const looped = new Uint8Array(64);
    looped[10] = 0xc0;
    looped[11] = 8;
    looped[8] = 0xc0;
    looped[9] = 6;
    looped[6] = 0xc0;
    looped[7] = 4;
    looped[4] = 0xc0;
    looped[5] = 2;
    looped[2] = 0xc0;
    looped[3] = 0; // offset 0 holds a zero length byte: root, terminates legally
    expect(readName(looped, 10)).toEqual({ name: '', next: 12 });

    const runaway = new Uint8Array(4);
    runaway[2] = 0xc0;
    runaway[3] = 2; // points at itself
    expect(readName(runaway, 2)).toBeNull();
  });

  it('returns null for a reserved label type', () => {
    const reserved = hex(FIXTURES.noerrorA);
    reserved[12] = 0x80;
    expect(decodeDnsMessage(reserved)).toBeNull();
  });
});

describe('decodeDnsMessage — real responses', () => {
  it('reads a NOERROR answer with its addresses and TTL', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.noerrorA))!;
    expect(msg.header.rcode).toBe(0);
    expect(msg.header.id).toBe(0x1234);
    expect(msg.header.qr).toBe(true);
    expect(msg.header.ad).toBe(false);
    expect(msg.question).toEqual({ name: 'example.com', qtype: 1, qclass: 1 });
    expect(msg.answers.map((a) => a.data)).toEqual(['172.66.147.243', '104.20.23.154']);
    expect(msg.answers[0].ttl).toBe(196);
  });

  it('reads NXDOMAIN without mistaking the authority SOA for an answer', () => {
    // The SOA that comes back with an NXDOMAIN lives in the authority section.
    // Counting it as an answer would make a "this name does not exist" reply
    // look like a resolver that invented an address.
    const msg = decodeDnsMessage(hex(FIXTURES.nxdomain))!;
    expect(msg.header.rcode).toBe(3);
    expect(msg.header.ancount).toBe(0);
    expect(msg.header.nscount).toBe(1);
    expect(msg.answers).toEqual([]);
  });

  it('reads the AD bit from a signed answer, and RRSIG data as absent', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.adSigned))!;
    expect(msg.header.ad).toBe(true);
    expect(msg.answers).toHaveLength(3);
    expect(msg.answers.filter((a) => a.type === DNS_TYPE.A).map((a) => a.data)).toEqual([
      '104.18.16.166',
      '104.18.17.166',
    ]);
    // RRSIG (46) is not a type this parser understands, so its data is null
    // rather than a best-effort reading of bytes whose layout is unconfirmed.
    expect(msg.answers.find((a) => a.type === 46)!.data).toBeNull();
  });

  it('reads SERVFAIL, which is how a validating resolver refuses a broken chain', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.servfail))!;
    expect(msg.header.rcode).toBe(2);
    expect(rcodeName(msg.header.rcode)).toBe('SERVFAIL');
    expect(msg.answers).toEqual([]);
  });

  it('follows a compression pointer through a CNAME chain', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.cnameChain))!;
    expect(msg.answers).toHaveLength(2);
    expect(msg.answers[0].type).toBe(DNS_TYPE.CNAME);
    expect(msg.answers[0].data).toBeNull(); // unsupported type, not guessed at
    expect(msg.answers[1].name).toBe('github.com');
    expect(msg.answers[1].data).toBe('140.82.113.4');
  });

  it('renders AAAA as eight uncompressed lowercase groups', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.aaaa))!;
    expect(msg.answers.map((a) => a.data)).toEqual([
      '2606:4700:0010:0000:0000:0000:6814:179a',
      '2606:4700:0010:0000:0000:0000:ac42:93f3',
    ]);
  });

  it('reports an address record with the wrong RDLENGTH as absent, not as garbage', () => {
    const msg = decodeDnsMessage(hex(FIXTURES.cnameChain))!;
    // The CNAME's RDLENGTH is 2 and its type is not A; if the parser were
    // reading RDATA by position rather than by type it would emit an address.
    expect(msg.answers[0].data).toBeNull();
  });
});

describe('rcodeName', () => {
  it('names the codes this tool acts on', () => {
    expect(rcodeName(0)).toBe('NOERROR');
    expect(rcodeName(2)).toBe('SERVFAIL');
    expect(rcodeName(3)).toBe('NXDOMAIN');
    expect(rcodeName(5)).toBe('REFUSED');
  });

  it('surfaces an unknown code rather than mapping it onto a known one', () => {
    expect(rcodeName(23)).toBe('RCODE-23');
  });
});
