# Postmortem: a diagnostics tool that invented its own results

NetReady's first version was generated in Google AI Studio. It ran, it looked
professional, it had an animated map and live charts, and it produced confident
numbers. Those numbers were substantially fabricated, and the project owner did not
notice until a full line-by-line review much later.

This document records what was wrong and — more usefully — *why it was hard to see*. It
is kept in the repo because the failure modes are general. Any generated codebase can
have them, and the same review habits catch them.

---

## The headline

**An offline machine produced a complete speed test and an A grade.**

Every phase had a fallback that substituted a plausible value when measurement failed:

| Location | On failure, reported |
|---|---|
| `network.ts:360` | `navigator.connection.downlink \|\| 25` Mbps |
| `network.ts:412` | Upload = `max(2.5, download × 0.45)`, plus half of every un-sent chunk counted as transferred |
| `network.ts:445` | Upload = `download × 0.4` |
| `network.ts:449` | Loaded ping = `ping + 14` — which then *graded bufferbloat* |
| `network.ts:241` | Ping = `18` ms, jitter = `3` ms |
| `network.ts:818` | Score defaulted to `dl=30, ul=10, lat=35, jit=5` |

None of these was flagged in the UI. They flowed into `localStorage` and into exported
CSV reports — the artefact you would hand to an ISP.

The scoring function had a second, subtler bug: it used `||` rather than `??`, so a
genuine measured **0 Mbps** was silently rewritten as **30 Mbps**. The failure case and
the "worst possible real result" case were indistinguishable.

## The traceroute did not traceroute

`tracert.ts` generated the entire middle of every route with `Math.random()`: hop IPs in
`162.219.x.x` (a real, allocated block), hostnames and ISPs cycled from a hardcoded
"transit backbone" table, interpolated coordinates, and a simulated 6% packet-loss rate
so the output would look realistically imperfect.

A browser cannot send ICMP packets or set an IP TTL, so this was never going to work.
The correct response was to say so. Instead the UI rendered a CLI-styled terminal stream
reading `Tracing route to X over a maximum of 20 hops`, and exported the invented hops
to CSV with columns headed "Hop IP" and "Hop ISP / ASN".

Related: when the GeoIP providers failed, lookups returned hardcoded Washington DC or
San Francisco coordinates — and **every private address resolved to San Francisco**, so
users saw their own LAN gateway pinned in California.

## Why review did not catch it

Four reasons, all worth internalising.

**1. The failure paths were invisible in normal use.** On a working connection the app
is broadly correct. Fabrication only appears when something fails, which is exactly when
nobody is watching closely — and exactly when a diagnostic tool matters most.

**2. `any` disabled the type checker at the critical boundary.** `HistoryItem.data` was
typed `any`, so the CSV exporter could read `downloadMbps`, `sent`, `queryTimeMs` and
`r.ttl` — **six field names that did not exist** — and compile cleanly. Every value fell
through to `''`, producing structurally valid CSVs with entirely empty data columns. A
silent, total failure of the export feature.

**3. `@types/react` was missing from `package.json` entirely.** The whole React surface
was implicitly `any`. Adding the package and enabling `strict` produced **zero errors**,
which means the type safety had been available all along and simply switched off.

**4. Presentation outran substance.** The animated map, the live charts and the confident
copy ("microsecond latency analysis", "Verified Location", "Zero Server Telemetry") all
signalled rigour. The gap between how trustworthy the app *looked* and how trustworthy it
*was* is the actual lesson here.

## Also found

- **DOM XSS.** Leaflet's `divIcon({html})` and `bindPopup()` are `innerHTML` sinks, fed
  the user's raw typed hostname and unvalidated third-party GeoIP strings.
- **CSV formula injection.** Quotes were escaped, `=`/`+`/`-`/`@` were not. A hostname of
  `=cmd|'/c calc'!A1` reached Excel as a live formula.
- **The privacy statement was false.** It promised no IP addresses, scan targets or
  domain names were transmitted, while the browser sent them to twelve third parties.
  True of the project's own servers — of which there are none — but that is not what the
  sentence said.
- **Dead code presented as features.** A three-way speed-test server selector whose
  "Auto-Detect Best" option never compared anything and whose "App Server" option pointed
  at a backend absent from the static build. A subnet auto-detector that fell back to a
  hardcoded `192.168.1.50` and labelled it "Detected Interface". A settings module with
  zero call sites.
- **A fallback probe path that could never run.** The port scanner captured one `start`
  timestamp before all three probe strategies, so every fallback saw its predecessor's
  elapsed time and could only ever return `filtered`.

## What changed

The full fix is in [PR #1](https://github.com/TechLuddite/NetReady/pull/1) and
[PR #2](https://github.com/TechLuddite/NetReady/pull/2). In short:

- Every fabrication removed. Failed measurements are `null` with a typed reason, rendered
  as `—` plus an explanation.
- `strict` mode on, `HistoryItem.data` narrowed at every boundary, ESLint and Vitest
  added, CI gated on all three.
- XSS and CSV injection fixed.
- Privacy copy rewritten to enumerate every third party and what it receives.
- The traceroute replaced by the **Edge Path Explorer**, which measures what a browser
  genuinely can: real DNS/TCP/TLS/TTFB phase timings, the CDN edge that answered, HTTP/3
  negotiation as evidence of UDP blocking, and a speed-of-light distance bound. The old
  route model is retained, clearly labelled simulated, so existing history still renders.

## Transferable lessons

1. **Judge generated code by its failure paths, not its happy path.** Ask "what does this
   print when the network is down?" for every metric.
2. **`any` is where bugs hide from the compiler.** Especially at serialisation
   boundaries. `strict` mode cost nothing here and would have caught the export bug.
3. **Check that declared dependencies are actually used and required ones are present.**
   This project shipped `@google/genai`, `motion` and `dotenv` unused, while missing
   `@types/react`.
4. **A fallback that produces a plausible value is worse than an error.** Errors get
   noticed. Plausible values get trusted, saved and exported.
5. **Run the thing in a browser.** Static review missed a default `A+` bufferbloat grade
   shown before any test ran, and a bare `0` rendered in the navbar.
6. **Impressive presentation is not evidence of correctness** — and for generated code,
   the two are close to uncorrelated.
