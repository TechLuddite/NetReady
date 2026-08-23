# Removed: Live Traffic Monitor

Removed from the dashboard on 23 August 2026. This file is the reference record, so
nobody has to go digging through history to find out what it was or why it went.

The code is in git. Last commit that contained it:

```
git show 77305e2:src/components/TrafficMonitor.tsx
```

## What it was

A panel embedded in the dashboard, below the readiness score, that watched the browser's
own resource timeline and charted it live. It contacted nothing on its own except when a
button was pressed.

**How it worked.** A `PerformanceObserver` subscribed to `resource` entries, so every
request the page made for any reason — a speed test transfer, a DNS-over-HTTPS query, a
map tile, a favicon — landed in a buffer as it completed. On a one-second tick the buffer
was drained and aggregated into a `TrafficSample`, and the last 30 samples were kept as a
sliding window.

**What it showed.**

| Element | Content |
|---|---|
| Four KPI tiles | Throughput (Kbps), average latency over the last 5s, requests captured this session, total bytes transferred |
| Throughput sparkline | Kbps per second, 30-second window, cyan area chart |
| Latency sparkline | Average and peak ms per second, 30-second window, two series |
| Resource table | The most recent requests: name, initiator type, duration, transfer size |
| Filter chips | Narrowed the table by initiator type (fetch, img, script, …) |
| Pause / resume | Stopped the aggregation tick, not just the rendering |
| Trigger Network Spike | Made a handful of requests to `httpbin.org` so the sparklines had something real to draw on an idle page |
| Clear | Emptied the buffer and the window |

**What it measured honestly.** Everything it drew came from real Resource Timing entries.
`duration` is readable cross-origin without `Timing-Allow-Origin`, so the latency figures
were genuine even for opaque responses — unlike the phase breakdown, which is not
readable and which this panel never claimed to show. `transferSize` is zeroed for opaque
responses, so the byte totals undercounted cross-origin traffic and the panel did not
say so. That was its one soft edge.

**A bug it once had, worth remembering.** The average latency tile rendered `0 ms` when
no request had completed in the window, because the mean was computed with a `|| 1`
denominator dividing a sum of zeros. That is the exact failure mode `CLAUDE.md` exists to
prevent, and it was caught by an offline browser run rather than by review. Fixed at the
time to render `—` with a reason.

## Why it was removed

It was passive. It observed whatever traffic the page happened to generate, which meant
its numbers described NetReady's own activity rather than the network. On an idle tab it
showed nothing at all, and the honest fix for that — a button that manufactured traffic
so the graph had a shape — is a fair description of the problem: the panel needed to be
fed to look useful.

Walk & Test does the active version of the same idea properly. It probes a fixed list of
destinations on a schedule, so the series means something specific, is comparable between
runs and between places, and is saved. Keeping both would have meant two live-updating
latency charts on adjacent screens measuring different things under similar-looking
labels, and the passive one is the weaker of the two.

## What went with it

- `src/components/TrafficMonitor.tsx`, and its `CapturedResource` and `TrafficSample`
  types, which nothing else imported.
- The `httpbin.org` disclosure row that described the Trigger Network Spike button.
  `httpbin.org` is still reachable from the app, as one of the HTTP Probe's one-click
  sample targets, so the row was rewritten rather than deleted: it now names all four
  sample targets and says they are only contacted on a button press. The disclosure list
  is a contract, so it has to stay exactly as wide as the app's actual reach — no wider,
  and no narrower.

## If it comes back

Two things would be worth fixing first. Report `transferSize` as absent rather than zero
for opaque responses, since an undercount presented as a total is a quiet inaccuracy. And
drop the traffic-generating button: if a panel needs synthetic load to be worth looking
at, the panel is answering a question nobody asked.
