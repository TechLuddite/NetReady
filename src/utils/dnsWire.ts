/**
 * Minimal DNS wireformat codec (RFC 1035) for DNS-over-HTTPS (RFC 8484).
 *
 * This module is deliberately pure: no network, no clock, no randomness, no
 * DOM. The message ID is supplied by the caller rather than generated here,
 * which is what lets every branch below be tested from a fixed byte array.
 *
 * The governing rule is the project's: a message that does not parse cleanly
 * returns `null`, never a partial decode. A half-read response would let a
 * caller conclude "the resolver returned no answers" from a buffer that was
 * merely cut short — which is the same class of mistake as inventing a number.
 */

export const DNS_TYPE = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  AAAA: 28,
  OPT: 41,
} as const;

const DNS_CLASS_IN = 1;

/** Maximum compression-pointer hops before a chain is treated as malformed. */
const MAX_POINTER_HOPS = 16;

/** Names longer than this cannot be represented on the wire (RFC 1035 §2.3.4). */
const MAX_WIRE_NAME_BYTES = 255;
const MAX_LABEL_BYTES = 63;

const RCODE_NAMES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

/** Names an RCODE. Unknown codes are rendered as `RCODE-<n>` rather than being
 *  mapped onto the nearest known one — an unrecognised code is information. */
export function rcodeName(rcode: number): string {
  return RCODE_NAMES[rcode] ?? `RCODE-${rcode}`;
}

export interface EncodeOptions {
  /** 16-bit message ID, supplied by the caller. See `randomMessageId` in
   *  `dnsBenchmark.ts` for why the benchmark randomises it. */
  id: number;
  qtype: number;
  /** Append an EDNS0 OPT record with the DO bit set, asking the resolver to
   *  perform DNSSEC validation (RFC 4035 §4.9.3). */
  dnssecOk?: boolean;
  /** Advertised UDP payload size, carried in the OPT record's CLASS field. */
  udpPayloadSize?: number;
}

/**
 * Encodes a single-question query.
 *
 * Returns `null` — never a truncated or silently corrected message — for any
 * name that cannot be represented: an empty label, a label over 63 bytes, a
 * wire name over 255 bytes, or a byte outside the permitted set. Sanitising the
 * input instead would mean querying a name the caller did not ask for and
 * reporting the timing as though it had.
 */
export function encodeDnsQuery(name: string, options: EncodeOptions): Uint8Array | null {
  const encodedName = encodeName(name);
  if (encodedName === null) return null;

  const { id, qtype, dnssecOk = false, udpPayloadSize = 1232 } = options;
  if (!Number.isInteger(id) || id < 0 || id > 0xffff) return null;
  if (!Number.isInteger(qtype) || qtype < 0 || qtype > 0xffff) return null;

  const optLength = dnssecOk ? 11 : 0;
  const out = new Uint8Array(12 + encodedName.length + 4 + optLength);
  const view = new DataView(out.buffer);

  view.setUint16(0, id);
  // RD (recursion desired). These are stub-resolver queries: we are asking the
  // resolver to do the work, which is the thing being measured.
  view.setUint16(2, 0x0100);
  view.setUint16(4, 1); // QDCOUNT
  view.setUint16(6, 0); // ANCOUNT
  view.setUint16(8, 0); // NSCOUNT
  view.setUint16(10, dnssecOk ? 1 : 0); // ARCOUNT

  out.set(encodedName, 12);
  let offset = 12 + encodedName.length;
  view.setUint16(offset, qtype);
  view.setUint16(offset + 2, DNS_CLASS_IN);
  offset += 4;

  if (dnssecOk) {
    out[offset] = 0x00; // root NAME
    view.setUint16(offset + 1, DNS_TYPE.OPT);
    view.setUint16(offset + 3, udpPayloadSize);
    // TTL field of an OPT record is extended-rcode(8) | version(8) | flags(16).
    // 0x00008000 sets the DO bit with everything else zero.
    view.setUint32(offset + 5, 0x00008000);
    view.setUint16(offset + 9, 0); // RDLENGTH
  }

  return out;
}

function encodeName(name: string): Uint8Array | null {
  const trimmed = name.endsWith('.') ? name.slice(0, -1) : name;
  if (trimmed.length === 0) return new Uint8Array([0]); // root

  const labels = trimmed.split('.');
  const parts: number[] = [];

  for (const labelText of labels) {
    if (labelText.length === 0) return null; // empty label, e.g. 'a..b'
    const bytes: number[] = [];
    for (const char of labelText) {
      const code = char.codePointAt(0);
      // ASCII letters, digits, hyphen and underscore only. Anything else —
      // including a space or a non-ASCII character — is refused rather than
      // percent-escaped or punycoded, because guessing at the caller's intent
      // would mean measuring a different name than the one requested.
      if (
        code === undefined ||
        !(
          (code >= 0x30 && code <= 0x39) ||
          (code >= 0x41 && code <= 0x5a) ||
          (code >= 0x61 && code <= 0x7a) ||
          code === 0x2d ||
          code === 0x5f
        )
      ) {
        return null;
      }
      bytes.push(code);
    }
    if (bytes.length > MAX_LABEL_BYTES) return null;
    parts.push(bytes.length, ...bytes);
  }

  parts.push(0);
  if (parts.length > MAX_WIRE_NAME_BYTES) return null;
  return new Uint8Array(parts);
}

/** RFC 8484 §6 unpadded base64url, for the `?dns=` query parameter. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface DnsHeader {
  id: number;
  qr: boolean;
  opcode: number;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  /** Authenticated Data. The resolver *claims* it DNSSEC-validated this answer.
   *  A browser cannot verify the chain itself, so this is reported as a claim
   *  and never as proof. */
  ad: boolean;
  cd: boolean;
  rcode: number;
  qdcount: number;
  ancount: number;
  nscount: number;
  arcount: number;
}

export interface DnsResourceRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  /** Presentation form, for A and AAAA only. `null` for every other type: this
   *  parser does not guess at RDATA it does not understand, and an empty string
   *  would be indistinguishable from a record that genuinely carried nothing. */
  data: string | null;
}

export interface DnsMessage {
  header: DnsHeader;
  question: { name: string; qtype: number; qclass: number } | null;
  answers: DnsResourceRecord[];
}

/**
 * Reads a (possibly compressed) name.
 *
 * Pointers must move strictly backwards and the number of hops is capped, so a
 * self-referential or circular pointer returns `null` instead of hanging the
 * caller. `next` is the offset just past the name in the *original* position,
 * which is not the same as where the name's bytes ended once a pointer is
 * followed.
 */
export function readName(
  bytes: Uint8Array,
  offset: number,
): { name: string; next: number } | null {
  const labels: string[] = [];
  let cursor = offset;
  let next: number | null = null;
  let hops = 0;
  let consumed = 0;

  for (;;) {
    if (cursor < 0 || cursor >= bytes.length) return null;
    const length = bytes[cursor];

    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= bytes.length) return null;
      const target = ((length & 0x3f) << 8) | bytes[cursor + 1];
      // Strictly backwards: a forward or self-referential pointer is malformed,
      // and following one is how a decoder ends up in an infinite loop.
      if (target >= cursor) return null;
      if (++hops > MAX_POINTER_HOPS) return null;
      if (next === null) next = cursor + 2;
      cursor = target;
      continue;
    }

    if ((length & 0xc0) !== 0) return null; // reserved label type

    if (length === 0) {
      if (next === null) next = cursor + 1;
      return { name: labels.join('.'), next };
    }

    const start = cursor + 1;
    const end = start + length;
    if (end > bytes.length) return null;
    if (length > MAX_LABEL_BYTES) return null;

    consumed += length + 1;
    if (consumed > MAX_WIRE_NAME_BYTES) return null;

    let label = '';
    for (let i = start; i < end; i++) label += String.fromCharCode(bytes[i]);
    labels.push(label);
    cursor = end;
  }
}

/**
 * Decodes a wireformat response.
 *
 * Returns `null` for anything shorter than the 12-byte header, or whose
 * question and answer sections do not parse cleanly to their declared counts.
 * The declared-count check is the important one: a response claiming three
 * answers but carrying none is truncated, and reporting it as a message with
 * zero answers would turn a transport failure into a statement about DNS.
 */
export function decodeDnsMessage(bytes: Uint8Array): DnsMessage | null {
  if (bytes.length < 12) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint16(2);
  const header: DnsHeader = {
    id: view.getUint16(0),
    qr: (flags & 0x8000) !== 0,
    opcode: (flags >> 11) & 0x0f,
    aa: (flags & 0x0400) !== 0,
    tc: (flags & 0x0200) !== 0,
    rd: (flags & 0x0100) !== 0,
    ra: (flags & 0x0080) !== 0,
    ad: (flags & 0x0020) !== 0,
    cd: (flags & 0x0010) !== 0,
    rcode: flags & 0x000f,
    qdcount: view.getUint16(4),
    ancount: view.getUint16(6),
    nscount: view.getUint16(8),
    arcount: view.getUint16(10),
  };

  let offset = 12;
  let question: DnsMessage['question'] = null;

  for (let i = 0; i < header.qdcount; i++) {
    const read = readName(bytes, offset);
    if (read === null) return null;
    offset = read.next;
    if (offset + 4 > bytes.length) return null;
    if (i === 0) {
      question = {
        name: read.name,
        qtype: view.getUint16(offset),
        qclass: view.getUint16(offset + 2),
      };
    }
    offset += 4;
  }

  const answers: DnsResourceRecord[] = [];
  for (let i = 0; i < header.ancount; i++) {
    const read = readName(bytes, offset);
    if (read === null) return null;
    offset = read.next;
    if (offset + 10 > bytes.length) return null;

    const type = view.getUint16(offset);
    const recordClass = view.getUint16(offset + 2);
    const ttl = view.getUint32(offset + 4);
    const rdLength = view.getUint16(offset + 8);
    offset += 10;

    if (offset + rdLength > bytes.length) return null;
    answers.push({
      name: read.name,
      type,
      class: recordClass,
      ttl,
      data: readRdata(bytes, offset, rdLength, type),
    });
    offset += rdLength;
  }

  return { header, question, answers };
}

/** Renders RDATA for the two address types. Everything else — and any address
 *  record whose RDLENGTH is wrong for its type — yields `null` rather than a
 *  best-effort reading of bytes whose layout we cannot confirm. */
function readRdata(
  bytes: Uint8Array,
  offset: number,
  rdLength: number,
  type: number,
): string | null {
  if (type === DNS_TYPE.A) {
    if (rdLength !== 4) return null;
    return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
  }

  if (type === DNS_TYPE.AAAA) {
    if (rdLength !== 16) return null;
    // Eight full lowercase groups, with no `::` compression. Unambiguous and
    // trivially correct; a partial RFC 5952 implementation would produce
    // strings that compare unequal to themselves depending on the input.
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push((((bytes[offset + i] << 8) | bytes[offset + i + 1]) >>> 0).toString(16).padStart(4, '0'));
    }
    return groups.join(':');
  }

  return null;
}
