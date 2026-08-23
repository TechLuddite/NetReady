# NetReady 🌐⚡

> **Browser-native network diagnostics — where every number tells you how it was measured.**

NetReady is a client-side network diagnostics suite that runs entirely in your browser using
standard Web APIs: `fetch`, WebSockets, `RTCPeerConnection`, the Performance Timeline, and
DNS-over-HTTPS. There is no backend, no account, and no build step between you and the results.

Its distinguishing rule: **NetReady never invents a number.** When a measurement fails, it reports
`—` and tells you why. Most speed tests will happily hand you a plausible figure derived from
nothing; this one won't.

That rule exists for a reason. An earlier generated version of this app fabricated results
whenever a measurement failed — convincingly enough that an offline machine still produced a full
report card and an A grade. [`docs/POSTMORTEM.md`](docs/POSTMORTEM.md) records what was wrong and
why it was hard to spot; [`CLAUDE.md`](CLAUDE.md) holds the rules that keep it from coming back.

---

## 🧠 The answer layer

Measurements are the easy half. The question people actually arrive with is **"is it me or the
internet?"**, and a grade does not answer it.

### 🩺 One-button triage

Walks a real decision tree — link → name resolution → interception → address families → four
unrelated content networks → throughput → behaviour under load — and returns a **verdict with
ranked probable causes and concrete fixes**, not a letter.

The reasoning is a data-driven rules engine in [`src/analysis/`](src/analysis/). Each rule declares
the metrics it consumes, a predicate, a verdict, an ordinal confidence and a remediation, and every
finding carries the measurements that produced it. That makes it **deterministic, instant, offline,
and auditable** — same evidence in, same answer out, with no model involved and no network request
needed to reason. `@google/genai` was removed from this project deliberately; nothing here calls an
API to think.

Two rules govern it, and both are tested:

- **A rule whose inputs were not measured does not fire.** It is skipped, and the gap is reported.
- **Silence is not a clean bill of health.** Fewer than three conclusive checks yields
  `indeterminate` — explicitly *not* "your network is fine". A run that measured nothing concludes
  nothing.

### 🎯 Bottleneck attribution

The dashboard headline now names the *binding constraint* rather than showing four flat bars:

> **Grade B — the binding constraint is bufferbloat, not bandwidth.** Latency rose from 18 ms idle
> to 80 ms under load, an increase of 62 ms.

It is computed by sensitivity analysis over the existing scoring function: each measured input is
lifted, one at a time, to a level past which it stops limiting the result, and whichever lift moves
the score furthest is the constraint. Those comparison values live inside the calculation and are
never reported as measurements — a test asserts they cannot leak into the output. Severe bufferbloat
overrides the ranking, because the numeric score does not model it and the user's experience does.

### 🌍 Dual-stack (IPv4 / IPv6) reachability

Calls hostnames that publish **only** an A record and hostnames that publish **only** an AAAA
record, two independent providers per family, then asks a dual-stack host which address it saw —
which reveals the family the browser actually prefers.

No IPv6 response is reported as *"no response"*, never as *"IPv6 is disabled"*: a browser cannot
distinguish an absent IPv6 path from two probe hosts being unreachable, and a family that was never
probed reads as `not checked` rather than as a failure — including in the CSV export.

### 🛰️ Captive portal & DNS hijack detection

The textbook `generate_204` redirect check needs a plaintext request, and a page served over HTTPS
may not make one. That limitation is reported (`mixed-content-blocked`) rather than worked around,
and the probe *does* run when NetReady is opened from a local `http` origin.

Over HTTPS the signature is different, and that is the useful insight: **a captive portal cannot
rewrite an HTTPS response without breaking the certificate chain, so it blocks instead.** So this
checks endpoints whose exact response is known in advance and reports which returned their own
content, which returned something else (interception with a trusted certificate), and which said
nothing at all while the browser still claimed to be online (the portal signature).

For DNS, it does the one test of the *system* resolver a web page can perform: reach one server two
ways — by name, which uses the resolver, and by literal IP, which does not. Literal answering while
the name does not is a broken or redirected resolver. Two DoH providers are also cross-checked, but
only on anycast names whose correct answer is identical worldwide; ordinary CDN hostnames disagree
by design and would manufacture findings out of geography.

---

## 🛠️ Tools

### 🚶 Walk & Test — *survey the building, not just the connection*

Ten destinations people actually depend on — Google, YouTube, Netflix, Facebook and Amazon on the
consumer side; Microsoft 365, Teams, Zoom, Salesforce and Slack on the business side — probed round
after round while you walk the building. Name the spot you are standing in, wait for a few rounds,
move, name the next one. The result is a **per-spot comparison**: which corner of the office loses
Teams, where the round trips double, which dead spot is a dead spot for everything and which is
only bad for one destination.

The repeated-probe idea is [Richard Astbury's Azure Speed Test](https://richorama.github.io/AzureSpeedTest2/),
which times a fixed list of regions until the table stops moving. This one expects you to move
instead.

What the numbers are, stated permanently on screen rather than in a footnote:

- **Each figure is a full HTTPS request round trip, not a ping.** No raw sockets means no ICMP and
  no lower-level timing. TLS on a new connection and the destination's own front-end are inside
  every number.
- **The requests are `no-cors`, so the response is opaque.** A completed probe proves the edge
  answered and how long it took. A 200, a 403 and a login redirect are indistinguishable from here,
  and the tool claims nothing about which it got.
- **These are front doors, not backends.** Netflix playback, Teams call audio and Zoom media run
  over paths a browser cannot address, so a green row does not promise a smooth call.
- **Unanswered is not "down", and it is not packet loss.** A timeout, a refused connection, a failed
  lookup and being out of range look identical to a browser. The column is called *Answered*.
- **All ten fire at once each round**, which gives them the same instant — and makes them compete
  on a constrained link. Compare rows and spots to each other, not a single figure to a spec sheet.

Each destination's first probe pays for DNS, TCP and TLS, so it is counted but kept out of the
timing statistics. Spots are compared by the **median of each destination's own median**, over only
the destinations that produced a median at *every* spot — pooling raw samples instead would make the
figure lurch when a destination dropped out, reporting a change in which destinations answered as
though it were a change in latency.

### 1. ⚡ Speed & Bandwidth
Streams real data over three concurrent connections against the Cloudflare edge, measuring
throughput from bytes that actually moved. Reports download, upload, idle latency, jitter, latency
under load, and a bufferbloat grade. A ramp-up window is excluded so the figure reflects steady
state rather than TCP slow start.

### 2. 🎯 Ping & Jitter
Round-trip time, jitter and packet loss across six public endpoints or a custom host, with a
continuous mode. Note this is *application-layer* timing over HTTPS, not ICMP — it includes TLS and
server handling, so it reads slightly higher than a system `ping`.

### 3. 📡 Local Port Scanner *(beta)*
Probes hosts, subnets (`192.168.1.0/24`) and ranges (`10.0.0.1-20`) for reachable services using
`fetch`, image and WebSocket probes. Port state is **inferred from connection timing**, not from a
TCP handshake the browser will not expose — treat results as indicative, not authoritative. Around
70 ports (21, 22, 23, 25, 110, 143, 465, 587, 993, 995 among them) are blocked outright by browser
security policy and are reported as such rather than silently skipped.

### 4. 🔒 DNS-over-HTTPS Resolver
`A`, `AAAA`, `MX`, `TXT`, `NS`, `CNAME`, `CAA`, `SRV` and `SOA` records via Cloudflare or Google,
with response codes, TTLs and the raw JSON payload.

### 4b. ⏱️ DNS Resolver Benchmark

Times seven public DNS-over-HTTPS resolvers three ways — a name already in the resolver's cache, a
random label under a popular domain that forces it out to an authoritative server, and a random
`.com` name that forces a `.com` TLD consultation — plus whether each returns `NXDOMAIN` for names
that do not exist, and whether each validates DNSSEC.

The three-way split is [Steve Gibson's](https://www.grc.com/dns/benchmark.htm), and the reason it
matters is his: a resolver can be instant from cache and badly connected to everything else, so
measuring only one of those tells you neither.

What a browser cannot do, and the tool says so permanently on screen rather than approximating:

- **Your own resolver is not in the table and cannot be.** No raw sockets, no UDP/53, no way to
  learn the address your system is using. For that, use Steve's native tool.
- **Every figure includes the HTTPS round trip.** No DoH endpoint sends `Timing-Allow-Origin`, so
  the DNS/TCP/TLS breakdown is unreadable — re-checked each run rather than asserted.
- **Ten well-known providers** (OpenDNS, AdGuard, Mullvad, NextDNS, Cisco Umbrella, Yandex,
  LibreDNS, CIRA, Wikimedia, Digitale Gesellschaft) send no CORS header, so a browser cannot read
  their answers at all. They are listed with no figures rather than omitted.
- **A failed request is not the resolver's fault.** The column is called *Answered*, never
  *Reliability*: over HTTPS a lost query, a TLS failure, a blocking extension and a CORS rejection
  are indistinguishable.

A "fastest" resolver is named only when its observed range does not overlap the runner-up's;
otherwise the conclusion is that this run does not separate them. Queries run one at a time and
cycle between resolvers, so a burst of other traffic does not land on whichever went first.

### 5. 🌐 WebRTC ICE Analyzer
Discovers public and local ICE candidates via STUN and infers NAT topology. Modern browsers return
mDNS `.local` candidates instead of real LAN addresses, so local-interface discovery frequently
finds nothing — NetReady says so rather than guessing.

### 6. 🧮 Subnet & CIDR Calculator
Network and broadcast addresses, usable host ranges, netmasks, wildcard masks, binary
representations, and subnet partitioning. Handles `/31` per RFC 3021 and `/32`. Fully offline.

### 7. 🔍 MAC / OUI Vendor Lookup
Decodes IEEE OUIs against a bundled offline database, plus unicast/multicast and
globally-unique/locally-administered bits. Fully offline. A partial MAC is reported as a prefix, not
padded out into a complete address.

### 8. 🛡️ HTTP Probe
Status code, response time, CORS reachability, and the response headers the browser is permitted to
read. Note that cross-origin `fetch` can only see CORS-safelisted headers unless the server sets
`Access-Control-Expose-Headers`, so security headers like `HSTS`, `CSP` and `X-Frame-Options` are
usually **not** visible from a browser regardless of whether the server sends them.

### 9. 🔌 WebSocket Tester
Handshake timing and application-layer echo round-trips over `ws://` and `wss://`.

### 10. 🧭 GeoIP & ISP Inspector
Geolocation, ISP, ASN and proxy/VPN signals for an IP or domain, via third-party lookup providers.

### 11. 📊 Live Traffic Monitor
Real-time throughput and latency from the browser's own Performance Timeline.

### 12. 🧭 Edge Path Explorer
Everything a browser can genuinely observe about the path to a host:

- **Connection phase breakdown** — real DNS → TCP → TLS → time-to-first-byte → transfer timings
  from the Performance Timeline. Cross-origin phases require a `Timing-Allow-Origin` header, and
  handshake phases only exist on a connection's *first* request; both conditions are detected and
  reported rather than shown as zeros.
- **Which CDN edge answered**, by IATA code, resolved against a bundled airport table to a real
  coordinate. An unknown code is flagged, not guessed.
- **HTTP/3 negotiation** — if every h3-capable origin falls back to HTTP/2, that is direct evidence
  UDP/443 is blocked upstream by a firewall or middlebox.
- **Latency horizon** — light travels ~200 km/ms in fibre, so a round trip puts a hard ceiling on
  how far away a server can be. Drawn as a constraint circle: the endpoint is somewhere inside it.
  This is a proof, not an estimate — queuing delay only loosens the bound.

### 13. 🗺️ Route Model *(simulated — read this)*
Resolves a target, looks up its real location, and draws a plausible great-circle path to it.

**The intermediate hops are generated, not measured.** Browsers cannot send ICMP packets or set an
IP TTL, so no web page can perform a real traceroute. The first and last hops are grounded in a real
DNS resolution and a real geolocation lookup; everything between them is illustrative. Exports mark
these records as simulated. Use the Edge Path Explorer above for measurements you can rely on.

### 14. 💾 History & Export
Results persist in `localStorage`. Search, filter, inspect raw JSON, and export per-tool CSVs, a
master summary, or a bundled ZIP with a manifest.

---

## 🚀 Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # static bundle in dist/
npm run preview
npm run check    # typecheck + lint + tests
```

There is no server component. `npm run build` emits static files that can be hosted anywhere.

---

## 🔒 Privacy

NetReady has **no backend**. Nothing is sent to, stored on, or logged by any server the project
operates, because there isn't one. Results live in your browser's `localStorage` and clearing site
data erases them completely.

That is not the same as "nothing leaves your browser". A network diagnostic cannot measure a network
without touching it, so the following go directly from your browser to third parties:

| Provider | Receives |
|---|---|
| `speed.cloudflare.com` | Your IP, plus tens of MB of transfer, during a speed test |
| `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com` | Your IP, as Edge Path Explorer probe targets (a few KB each) |
| `cloudflare-dns.com`, `dns.google` | Every domain you resolve, over encrypted DoH |
| `cloudflare-dns.com`, `dns.google`, `dns.quad9.net`, `dns10.quad9.net`, `freedns.controld.com`, `doh.sb`, `public.dns.iij.jp` | Your IP and every name the DNS benchmark queries — ~20 each, most randomly generated, which identifies the run to each provider |
| `dnssec-failed.org`, `internetsociety.org` | Not contacted; their names are the DNSSEC test pair sent to the resolvers above |
| `ipwho.is`, `ipapi.co`, `freeipapi.com` | Your public IP on opening the GeoIP tool, and every IP or domain you look up |
| `1.1.1.1`, `one.one.one.one`, `dns.quad9.net`, `doh.opendns.com`, `en.wikipedia.org` | Your IP, as latency probe targets, and as the two halves of the resolver test |
| `ipv4.icanhazip.com`, `ipv6.icanhazip.com`, `api4.ipify.org`, `api6.ipify.org` | Your IP, during the dual-stack check — each answers on one address family only |
| `cp.cloudflare.com` | Your IP, during the captive-portal check, and only when NetReady is opened over plain `http` |
| `www.google.com`, `www.youtube.com`, `www.netflix.com`, `www.facebook.com`, `www.amazon.com`, `outlook.office365.com`, `teams.microsoft.com`, `zoom.us`, `login.salesforce.com`, `slack.com` | Your IP, once per round for the length of a Walk & Test run — roughly 200 requests each over ten minutes. One HEAD for a small public file, no cookies sent |
| `stun.l.google.com` and other STUN servers | Your public IP, and potentially local addresses |
| `httpbin.org` | Your IP, only when you press "Trigger Network Spike" on the live traffic monitor |
| `basemaps.cartocdn.com`, `openstreetmap.org` | Map areas you view, revealing an approximate target location |
| Hosts you enter | Direct connections from your browser — that is what a probe *is* |

The CIDR calculator, MAC/OUI lookup, history browser and every export contact nobody at all.

**Authorized use only.** Port scanning and network probing should only be run against networks,
devices and hosts you own or have explicit permission to test.

---

## 🔄 Quality gates

- `npm run typecheck` — TypeScript in `strict` mode, zero errors.
- `npm run lint` — ESLint with `react-hooks`, zero errors.
- `npm run test` — Vitest. Coverage focuses on the pure logic where silent failures hide: CSV
  generation, CIDR math, OUI decoding, the rules engine and bottleneck attribution, and the rule
  that a failed measurement can never produce a number. The single most important assertion in the
  suite is that an empty snapshot fires no rule at all.

CI runs all three on every push and pull request; deployment is gated on them passing.

---

## 👏 Acknowledgments

The DNS Resolver Benchmark exists because of **Steve Gibson's**
[GRC DNS Benchmark](https://www.grc.com/dns/benchmark.htm), which has been measuring nameservers
properly — over UDP, against their actual IP addresses — since 2010. The cached / uncached /
"dotcom" separation, the NXDOMAIN-redirection check and the plain-English conclusions are all his
design; NetReady reproduces what a browser honestly can and says plainly where it cannot follow.

Walk & Test borrows its shape from **Richard Astbury's**
[Azure Speed Test](https://richorama.github.io/AzureSpeedTest2/), which probes a fixed list of
destinations over and over and lets the table settle rather than reporting one number and stopping.

[Lucide](https://lucide.dev/) · [Tailwind CSS](https://tailwindcss.com/) ·
[Vite](https://vitejs.dev/) · [React](https://react.dev/) · [Leaflet](https://leafletjs.com/) ·
[Recharts](https://recharts.org/) · [Cloudflare](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/)
and [Google Public DNS](https://developers.google.com/speed/public-dns) ·
[OpenStreetMap](https://www.openstreetmap.org/copyright) & [CARTO](https://carto.com/attributions) ·
the [IEEE OUI registry](https://standards.ieee.org/products-programs/regauth/oui/).

---

## 🛡️ License

MIT — see [LICENSE](LICENSE). Use it, fork it, ship it commercially; just keep the
copyright notice.

All runtime dependencies are permissively licensed (MIT, BSD-2-Clause, ISC), so nothing
here imposes copyleft obligations downstream.
