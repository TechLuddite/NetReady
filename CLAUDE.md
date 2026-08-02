# NetReady — working notes for AI agents

Read this before changing measurement code. It exists because an earlier generated
version of this app shipped invented numbers that looked entirely convincing, and the
project owner only found out during a line-by-line review months later. The rules below
are the ones that would have prevented it.

## What this project is

A browser-only network diagnostics suite. No backend, no account, no build-time secrets.
Everything runs client-side; `npm run build` emits static files for GitHub Pages.

**Stack:** React 19, TypeScript (`strict`), Vite 6, Tailwind v4, Leaflet, Recharts,
Vitest. `npm run check` = typecheck + lint + tests, and CI gates deployment on it.

---

## The one rule that matters

> **Never substitute a value for a measurement that failed.**

If something could not be measured, it is `null`, and the UI renders `—` with a reason.
Not zero, not a typical value, not an extrapolation from a different metric.

This is not a style preference. A diagnostic tool that invents numbers is worse than no
tool, because the user acts on the invention. An offline machine used to produce a
complete speed test and an A grade from this codebase.

### In practice

- Failed measurements are `number | null`. `strictNullChecks` then forces every display
  site to handle absence — that is the enforcement mechanism, so do not weaken it.
- Use `??`, never `||`, when defaulting anything numeric. `||` rewrites a genuine `0`.
- Attach a `MeasurementFailure` (`{ metric, reason, detail }`) so the UI can say *why*.
  Render it with `<FailureNotice>` and values with `<MetricValue>`.
- `<MetricValue>` deliberately has **no** `fallback` prop. Do not add one.
- Derived statistics need enough samples to exist. Jitter from one sample is not a small
  number, it is no number — see `meanConsecutiveDelta`, which returns `null` below n=2.

### Before you commit

```
grep -rnE '\|\|\s*[0-9]|\?\?\s*[1-9]' src/utils/ src/components/
grep -rn 'Math.random' src/utils/
```

The first should return only genuine coefficients in formulas. The second should return
only ID generation and cache-busters — `createId()` and `_cb=`/`_nr=` query params.

---

## Know what a browser genuinely cannot do

Half the original bugs came from simulating a capability rather than reporting its
absence. A browser **cannot**:

| Not possible | Why | What to do instead |
|---|---|---|
| Traceroute | No raw sockets, no IP TTL control | `EdgePathExplorer` — measure the endpoints precisely |
| Read a cross-origin HTTP status | `no-cors` responses are opaque by construction | Report reachability and timing only |
| Read cross-origin phase timings | Needs `Timing-Allow-Origin` | Detect and report `timing-allow-origin-missing` |
| See handshake timings on a reused connection | Spec collapses them onto `fetchStart` | Detect and report `connection-reused` |
| Prove a TCP port is open | Connection failures are deliberately hidden | Timing heuristic, labelled as such |
| Read the LAN IP via WebRTC | Modern browsers return mDNS `.local` candidates | Say so; ask the user to enter it |
| Read security headers cross-origin | Not CORS-safelisted | Say the browser cannot see them |

When you hit one of these, **say so in the UI**. The honesty is a feature — it is the
thing this tool has that mainstream speed tests do not.

---

## Traps specific to this codebase

- **`HistoryItem.data` is loosely typed.** This is how six CSV field-name mismatches
  (`downloadMbps` vs `downloadSpeed`, `sent` vs `packetsSent`, …) shipped invisibly and
  produced exports with entirely empty columns. Cast to a concrete `Partial<T>` at the
  boundary and let tsc check it. Every CSV generator has a test — keep it that way.
- **Leaflet `divIcon({html})` and `bindPopup(html)` are `innerHTML` sinks.** They were
  fed raw user hostnames and third-party GeoIP strings, which was live XSS. Build DOM
  nodes and set `textContent`. See `buildHopPopup` / `buildPopup`.
- **CSV needs formula-injection escaping**, not just quoting. `escapeCsv` prefixes
  `=`, `+`, `-`, `@`, tab and CR. Always use it; never hand-roll quoting.
- **Third parties must stay disclosed.** `THIRD_PARTY_DISCLOSURES` in
  `PrivacySafetyModal.tsx` and the README table are the contract with the user. If you
  add a probe endpoint, add it there in the same commit.
- **Silent truncation is a lie by omission.** A `/16` expands to 65,534 hosts and only
  256 are scanned. `describeTargetExpansion` surfaces that. Do the same for any new cap.
- **`{value && <X/>}` renders a bare `0`** when `value` is `0`. Use an explicit
  comparison. This shipped in the navbar.

---

## Conventions

- Comments explain *why*, especially where the non-obvious choice is deliberate. Several
  comments in `network.ts` and `edgePath.ts` record what a line used to do wrong; leave
  them, they are the guardrail.
- Tests go next to the code as `*.test.ts`. Prioritise pure logic where failures are
  silent — parsers, formatters, classifiers, anything feeding an export.
- Prefer widening an existing honest abstraction over adding a parallel one.
- UI copy should be plain and specific. Avoid inflated language; the app previously
  described a `localStorage` write as "Browser Persistence Online".

## Verification

Run `npm run check`. For anything touching measurement or rendering, also drive the real
app — `npm run build && npm run preview`, then Playwright against `127.0.0.1:4173`
(Chromium at `/opt/pw-browsers/chromium`).

**The regression test that matters most:** go offline in DevTools and run every tool.
Every metric must read `—` with a reason. A number appearing anywhere is a P0.

Browser checks have repeatedly caught what static review missed — a default `A+`
bufferbloat grade, a stray `0` in the navbar, a measured value only reachable through a
map popup. Do not skip them.
