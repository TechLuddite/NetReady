/** Browser scans are bounded, but oversized selections must never be silently truncated. */
export const MAX_SCAN_PORTS = 1000;

/** Parse a complete selection or reject it; no partial scans or substitute defaults. */
export function parsePortSelection(input: string): number[] {
  if (!input.trim()) throw new Error('Enter at least one port or port range.');

  const ports = new Set<number>();
  for (const raw of input.split(',')) {
    const part = raw.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid port selection "${part}". Use ports or ranges separated by commas.`);

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > 65535 || start > end) {
      throw new Error(`Invalid port selection "${part}". Ports must be 1–65535 and ranges must be in ascending order.`);
    }
    if (end - start + 1 > MAX_SCAN_PORTS) {
      throw new Error(`Select at most ${MAX_SCAN_PORTS} distinct ports per scan. This range is too large; no ports were selected.`);
    }
    for (let port = start; port <= end; port++) {
      ports.add(port);
      if (ports.size > MAX_SCAN_PORTS) {
        throw new Error(`Select at most ${MAX_SCAN_PORTS} distinct ports per scan. This selection is too large; no ports were selected.`);
      }
    }
  }
  return [...ports].sort((a, b) => a - b);
}
