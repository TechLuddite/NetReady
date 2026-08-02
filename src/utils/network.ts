import {
  NetworkConnectionInfo,
  PingResult,
  PingPoint,
  DnsQueryResult,
  DnsRecord,
  WebRtcResult,
  IceCandidateInfo,
  HttpProbeResult,
  WebSocketResult,
  SpeedTestResult,
  NetReadyScore,
  PortStatus,
  PortScanResult,
  MeasurementFailure,
} from '../types';

/**
 * Mean absolute difference between consecutive samples — the definition of
 * jitter used throughout NetReady.
 *
 * Returns null for fewer than two samples. This matters: the same calculation
 * used to be inlined in three places, each with a different invented fallback
 * (`0`, `2`, and `3`), so a test that produced one usable sample would report a
 * confident jitter figure derived from nothing.
 */
export function meanConsecutiveDelta(samples: readonly number[]): number | null {
  if (samples.length < 2) return null;
  let diffSum = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    diffSum += Math.abs(samples[i + 1] - samples[i]);
  }
  return Math.round(diffSum / (samples.length - 1));
}

/** Collision-resistant id. `Date.now()` alone produced duplicate React keys and
 *  made `deleteHistoryItem` remove two records at once. */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getNetworkConnectionInfo(): NetworkConnectionInfo {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

  return {
    isOnline: navigator.onLine,
    downlink: conn?.downlink,
    effectiveType: conn?.effectiveType,
    rtt: conn?.rtt,
    saveData: conn?.saveData,
    type: conn?.type,
  };
}

// Fast reliable public CORS endpoints & fallback local assets for ping/speed measurements
export const PING_TARGET_PRESETS = [
  { label: 'Cloudflare (1.1.1.1)', url: 'https://1.1.1.1/cdn-cgi/trace', name: 'Cloudflare' },
  { label: 'Google DNS (8.8.8.8)', url: 'https://dns.google/resolve?name=ping.test', name: 'Google DNS' },
  { label: 'Quad9 DNS (9.9.9.9)', url: 'https://dns.quad9.net:5053/dns-query?name=test', name: 'Quad9 DNS' },
  { label: 'OpenDNS', url: 'https://doh.opendns.com/dns-query?name=test', name: 'OpenDNS' },
  { label: 'Wikipedia CDN', url: 'https://en.wikipedia.org/static/images/project-logos/enwiki.png', name: 'Wikipedia' },
  { label: 'Local Server Asset', url: '/index.html', name: 'Local Origin' },
];

export async function executePingBatch(
  targetUrl: string,
  targetName: string,
  packetCount: number = 10,
  onPoint?: (point: PingPoint, currentPoints: PingPoint[]) => void,
  shouldStop?: () => boolean
): Promise<PingResult> {
  const points: PingPoint[] = [];
  const isContinuous = packetCount <= 0 || !isFinite(packetCount);

  let i = 1;
  while (true) {
    if (shouldStop && shouldStop()) break;
    if (!isContinuous && i > packetCount) break;

    const start = performance.now();
    try {
      // Add cache buster query param
      const cacheBuster = `?_cb=${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`;
      const fullUrl = targetUrl.includes('?')
        ? `${targetUrl}&_cb=${Date.now()}_${i}`
        : `${targetUrl}${cacheBuster}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      // `no-cors` keeps cross-origin probes from failing on CORS policy, but the
      // response is opaque: its status code is unreadable by construction, and it
      // resolves for a 404, a 500 or a captive-portal redirect just as happily as
      // for a 200. So this measures reachability and round-trip time only — it
      // deliberately makes no claim about the HTTP status.
      await fetch(fullUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Math.round(performance.now() - start);

      const pt: PingPoint = {
        sequence: i,
        time: duration,
        status: 'success',
        timestamp: Date.now(),
      };
      points.push(pt);
      if (onPoint) onPoint(pt, [...points]);
    } catch (err: any) {
      const pt: PingPoint = {
        sequence: i,
        time: -1,
        status: err.name === 'AbortError' ? 'timeout' : 'error',
        timestamp: Date.now(),
      };
      points.push(pt);
      if (onPoint) onPoint(pt, [...points]);
    }

    i++;

    if (shouldStop && shouldStop()) break;
    if (!isContinuous && i > packetCount) break;

    // Small delay between pings (120ms)
    await new Promise((res) => setTimeout(res, 120));
  }

  const validPoints = points.filter((p) => p.status === 'success' && p.time > 0);
  const sent = points.length;
  const received = validPoints.length;
  const packetLoss = sent > 0 ? Math.round(((sent - received) / sent) * 100) : 100;

  // A target that answered nothing has no round-trip time. Reporting 0 ms there
  // would read as "instantaneous" — the opposite of what happened.
  let minPing: number | null = null;
  let maxPing: number | null = null;
  let avgPing: number | null = null;
  let jitter: number | null = null;

  if (validPoints.length > 0) {
    const times = validPoints.map((p) => p.time);
    minPing = Math.min(...times);
    maxPing = Math.max(...times);
    const sum = times.reduce((a, b) => a + b, 0);
    avgPing = Math.round(sum / times.length);

    // Jitter is the mean difference between consecutive samples, so it is
    // undefined for a single sample. It stays null rather than becoming 0.
    jitter = meanConsecutiveDelta(times);
  }

  return {
    id: createId('ping'),
    timestamp: Date.now(),
    target: targetUrl,
    label: targetName,
    packetsSent: sent,
    packetsReceived: received,
    packetLoss,
    minPing,
    maxPing,
    avgPing,
    jitter,
    points,
  };
}

// ---------------------------------------------------------------------------
// Bandwidth speed test
//
// Every figure this produces is derived from bytes that actually moved. When a
// phase fails it reports null plus a reason, and the caller renders "—". The
// previous implementation substituted `navigator.connection.downlink || 25` for
// a failed download, `downloadSpeed * 0.4` for a failed upload, `18`/`3` for
// failed pings, and counted half of every un-sent upload chunk as transferred —
// so a machine with no connectivity at all still produced a full report card.
// ---------------------------------------------------------------------------

/** Cloudflare's public speed endpoints are the only browser-reachable backend
 *  NetReady uses: CORS-enabled, anycast, and no NetReady server involved. */
export type SpeedTestServerTarget = 'cloudflare';

export const SPEED_TEST_SERVER_NAME = 'Cloudflare Global Edge CDN';

const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down?bytes=25000000';
const UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const LATENCY_URL = 'https://speed.cloudflare.com/__down?bytes=0';

/** Transfer measured before the connection reaches steady state understates
 *  throughput. Bytes in this opening window are excluded from the final figure
 *  (but still shown live, so the meter does not sit at zero). */
const RAMP_UP_MS = 1000;
const DOWNLOAD_WINDOW_MS = 5000;
const UPLOAD_WINDOW_MS = 4000;
const LATENCY_SAMPLES = 6;

export interface SpeedTestProgressData {
  stage: 'idle' | 'ping' | 'download' | 'upload' | 'complete';
  downloadSpeed: number | null; // Mbps
  uploadSpeed: number | null; // Mbps
  ping: number | null; // ms
  jitter: number | null; // ms
  progress: number; // 0-100
  serverName: string;
  totalBytesDownloaded: number; // bytes
  totalBytesUploaded: number; // bytes
}

function mbps(bytes: number, elapsedMs: number): number | null {
  if (bytes <= 0 || elapsedMs <= 0) return null;
  return parseFloat(((bytes * 8) / ((elapsedMs / 1000) * 1_000_000)).toFixed(2));
}

export async function runSpeedTest(
  onProgress?: (data: SpeedTestProgressData) => void,
  signal?: AbortSignal,
): Promise<SpeedTestResult> {
  const failures: MeasurementFailure[] = [];
  const serverName = SPEED_TEST_SERVER_NAME;

  let downloadSpeed: number | null = null;
  let uploadSpeed: number | null = null;
  let ping: number | null = null;
  let jitter: number | null = null;
  let loadedPing: number | null = null;
  let totalBytesDownloaded = 0;
  let totalBytesUploaded = 0;

  const report = (stage: SpeedTestProgressData['stage'], progress: number) => {
    onProgress?.({
      stage,
      downloadSpeed,
      uploadSpeed,
      ping,
      jitter,
      progress,
      serverName,
      totalBytesDownloaded,
      totalBytesUploaded,
    });
  };

  if (!navigator.onLine) {
    failures.push({
      metric: 'all',
      reason: 'network-offline',
      detail: 'The browser reports no network connection, so nothing was measured.',
    });
    report('complete', 100);
    return {
      id: createId('speed'),
      timestamp: Date.now(),
      downloadSpeed: null,
      uploadSpeed: null,
      ping: null,
      jitter: null,
      loadedPing: null,
      bufferbloatScore: null,
      serverName,
      totalBytesDownloaded: 0,
      totalBytesUploaded: 0,
      failures,
    };
  }

  // --- 1. Idle latency -----------------------------------------------------
  report('ping', 5);

  const pingTimes: number[] = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    if (signal?.aborted) break;
    const start = performance.now();
    try {
      await fetch(`${LATENCY_URL}&_p=${Date.now()}_${i}`, { cache: 'no-store', signal });
      pingTimes.push(Math.round(performance.now() - start));
    } catch {
      /* a dropped sample is a dropped sample; it is not a latency figure */
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  if (pingTimes.length > 0) {
    ping = Math.round(pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length);
    jitter = meanConsecutiveDelta(pingTimes);
    if (jitter === null) {
      failures.push({
        metric: 'jitter',
        reason: 'insufficient-samples',
        detail: 'Only one latency sample succeeded. Jitter needs at least two.',
      });
    }
  } else {
    failures.push({
      metric: 'ping',
      reason: 'api-unreachable',
      detail: `No latency sample reached ${serverName}. It may be blocked on this network.`,
    });
    failures.push({
      metric: 'jitter',
      reason: 'insufficient-samples',
      detail: 'Jitter cannot be derived without latency samples.',
    });
  }

  // --- 2. Download ---------------------------------------------------------
  report('download', 20);

  const downloadStart = performance.now();
  let steadyStateBytes = 0;
  let steadyStateStart: number | null = null;
  let downloadActive = true;

  const accrue = (byteCount: number) => {
    totalBytesDownloaded += byteCount;
    const now = performance.now();
    if (now - downloadStart >= RAMP_UP_MS) {
      if (steadyStateStart === null) steadyStateStart = now;
      else steadyStateBytes += byteCount;
    }
  };

  const downloadWorkers = Array.from({ length: 3 }).map(async (_, workerIdx) => {
    while (downloadActive && performance.now() - downloadStart < DOWNLOAD_WINDOW_MS) {
      if (signal?.aborted) return;
      try {
        const res = await fetch(`${DOWNLOAD_URL}&_cb=${Date.now()}_${workerIdx}`, {
          cache: 'no-store',
          signal,
        });
        if (!res.body) {
          accrue((await res.blob()).size);
          continue;
        }
        const reader = res.body.getReader();
        while (downloadActive) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) accrue(value.length);
        }
        await reader.cancel().catch(() => {});
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });

  // Live meter only. The reported figure is computed from the steady-state
  // window below, not from this smoothed value.
  const meterInterval = setInterval(() => {
    const elapsed = performance.now() - downloadStart;
    downloadSpeed = mbps(totalBytesDownloaded, elapsed);
    report('download', Math.min(60, 20 + Math.round((elapsed / DOWNLOAD_WINDOW_MS) * 40)));
  }, 100);

  // Latency under load, sampled mid-transfer. This is what makes bufferbloat
  // visible: the gap between idle and loaded ping.
  let loadedPingTimer: ReturnType<typeof setTimeout> | undefined;
  const loadedPingDone = new Promise<void>((resolve) => {
    loadedPingTimer = setTimeout(async () => {
      const start = performance.now();
      try {
        await fetch(`${LATENCY_URL}&_loaded=${Date.now()}`, { cache: 'no-store', signal });
        loadedPing = Math.round(performance.now() - start);
      } catch {
        /* leave null — an unmeasured loaded ping must not become ping + 14 */
      }
      resolve();
    }, Math.floor(DOWNLOAD_WINDOW_MS / 2));
  });

  await new Promise((r) => setTimeout(r, DOWNLOAD_WINDOW_MS));
  downloadActive = false;
  clearInterval(meterInterval);
  if (loadedPingTimer !== undefined) clearTimeout(loadedPingTimer);
  await Promise.allSettled([...downloadWorkers, loadedPingDone]);

  const steadyElapsed = steadyStateStart === null ? 0 : performance.now() - steadyStateStart;
  downloadSpeed =
    mbps(steadyStateBytes, steadyElapsed) ??
    mbps(totalBytesDownloaded, performance.now() - downloadStart);

  if (downloadSpeed === null) {
    failures.push({
      metric: 'downloadSpeed',
      reason: totalBytesDownloaded === 0 ? 'api-unreachable' : 'insufficient-samples',
      detail:
        totalBytesDownloaded === 0
          ? `No bytes arrived from ${serverName}. The transfer was blocked or the network is down.`
          : 'The transfer was too short to produce a throughput figure.',
    });
  }

  // --- 3. Upload -----------------------------------------------------------
  report('upload', 65);

  const uploadStart = performance.now();
  const payload = new Uint8Array(2 * 1024 * 1024);
  let uploadActive = true;
  let uploadFailed = false;

  const uploadWorkers = Array.from({ length: 2 }).map(async () => {
    while (uploadActive && performance.now() - uploadStart < UPLOAD_WINDOW_MS) {
      if (signal?.aborted) return;
      try {
        const res = await fetch(UPLOAD_URL, {
          method: 'POST',
          body: payload,
          cache: 'no-store',
          signal,
        });
        if (!res.ok) throw new Error(`upload rejected: ${res.status}`);
        // Only bytes the server accepted are counted.
        totalBytesUploaded += payload.byteLength;
        uploadSpeed = mbps(totalBytesUploaded, performance.now() - uploadStart);
        report(
          'upload',
          Math.min(95, 65 + Math.round(((performance.now() - uploadStart) / UPLOAD_WINDOW_MS) * 30)),
        );
      } catch {
        uploadFailed = true;
        return;
      }
    }
  });

  await Promise.race([
    Promise.allSettled(uploadWorkers),
    new Promise((r) => setTimeout(r, UPLOAD_WINDOW_MS)),
  ]);
  uploadActive = false;
  await Promise.allSettled(uploadWorkers);

  // Throughput is aggregate bytes over the window, not the mean of each
  // worker's individual rate — averaging concurrent streams understated the
  // real figure by roughly the worker count.
  uploadSpeed = mbps(totalBytesUploaded, performance.now() - uploadStart);

  if (uploadSpeed === null) {
    failures.push({
      metric: 'uploadSpeed',
      reason: uploadFailed ? 'cors-blocked' : 'api-unreachable',
      detail: uploadFailed
        ? 'The upload was rejected before any bytes were accepted, so there is no upload figure.'
        : `No upload reached ${serverName}.`,
    });
  }

  // --- 4. Bufferbloat ------------------------------------------------------
  // Gradeable only when both idle and loaded latency were actually measured.
  let bufferbloatScore: SpeedTestResult['bufferbloatScore'] = null;
  if (ping !== null && loadedPing !== null) {
    const delta = Math.max(0, loadedPing - ping);
    if (delta > 150) bufferbloatScore = 'F';
    else if (delta > 90) bufferbloatScore = 'D';
    else if (delta > 50) bufferbloatScore = 'C';
    else if (delta > 25) bufferbloatScore = 'B';
    else if (delta > 10) bufferbloatScore = 'A';
    else bufferbloatScore = 'A+';
  } else {
    failures.push({
      metric: 'bufferbloatScore',
      reason: 'insufficient-samples',
      detail: 'Bufferbloat needs both an idle and a under-load latency sample.',
    });
  }

  report('complete', 100);

  return {
    id: createId('speed'),
    timestamp: Date.now(),
    downloadSpeed,
    uploadSpeed,
    ping,
    jitter,
    loadedPing,
    bufferbloatScore,
    serverName,
    totalBytesDownloaded: parseFloat((totalBytesDownloaded / (1024 * 1024)).toFixed(2)),
    totalBytesUploaded: parseFloat((totalBytesUploaded / (1024 * 1024)).toFixed(2)),
    failures: failures.length > 0 ? failures : undefined,
  };
}

// DoH DNS Query Tool
export async function queryDnsOverHttps(
  domain: string,
  type: string = 'A',
  provider: 'cloudflare' | 'google' = 'cloudflare'
): Promise<DnsQueryResult> {
  const startTime = performance.now();
  const cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  let url = '';
  let headers: Record<string, string> = {};

  if (provider === 'cloudflare') {
    url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=${encodeURIComponent(type)}`;
    headers = { Accept: 'application/dns-json' };
  } else {
    url = `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=${encodeURIComponent(type)}`;
  }

  try {
    const res = await fetch(url, { headers });
    const responseTimeMs = Math.round(performance.now() - startTime);
    const data = await res.json();

    const RECORD_TYPES: Record<number, string> = {
      1: 'A',
      28: 'AAAA',
      15: 'MX',
      16: 'TXT',
      2: 'NS',
      5: 'CNAME',
      257: 'CAA',
      33: 'SRV',
      6: 'SOA',
    };

    const STATUS_MAP: Record<number, string> = {
      0: 'NOERROR (Success)',
      1: 'FORMERR (Format Error)',
      2: 'SERVFAIL (Server Failure)',
      3: 'NXDOMAIN (Non-Existent Domain)',
      4: 'NOTIMP (Not Implemented)',
      5: 'REFUSED (Query Refused)',
    };

    const rawAnswers = data.Answer || data.Authority || [];
    const records: DnsRecord[] = rawAnswers.map((item: any) => ({
      name: item.name,
      type: item.type,
      typeName: RECORD_TYPES[item.type] || `TYPE-${item.type}`,
      TTL: item.TTL,
      data: item.data,
    }));

    return {
      id: 'dns_' + Date.now(),
      timestamp: Date.now(),
      domain: cleanDomain,
      recordType: type,
      provider,
      status: data.Status ?? 0,
      statusText: STATUS_MAP[data.Status] || 'STATUS-' + data.Status,
      responseTimeMs,
      records,
      rawJson: data,
    };
  } catch (err: any) {
    const responseTimeMs = Math.round(performance.now() - startTime);
    return {
      id: 'dns_' + Date.now(),
      timestamp: Date.now(),
      domain: cleanDomain,
      recordType: type,
      provider,
      status: 2,
      statusText: 'Query Failed: ' + (err.message || 'Network error'),
      responseTimeMs,
      records: [],
      rawJson: { error: err.message },
    };
  }
}

// WebRTC ICE Candidate & STUN Analyzer
export async function gatherWebRtcCandidates(
  stunServer: string = 'stun:stun.l.google.com:19302'
): Promise<WebRtcResult> {
  const startTime = performance.now();
  const candidates: IceCandidateInfo[] = [];
  const publicIpsSet = new Set<string>();
  const localIpsSet = new Set<string>();

  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let completed = false;

    const finalize = () => {
      if (completed) return;
      completed = true;
      if (pc) {
        pc.close();
        pc = null;
      }

      const gatheringTimeMs = Math.round(performance.now() - startTime);

      // NAT Type Inference based on candidates gathered
      let natTypeInference = 'Normal / Open Internet';
      const hasSrflx = candidates.some((c) => c.type === 'srflx');
      const hasRelay = candidates.some((c) => c.type === 'relay');
      const hasHost = candidates.some((c) => c.type === 'host');

      if (hasSrflx && hasHost) {
        natTypeInference = 'Port-Restricted Cone NAT / STUN Accessible';
      } else if (hasSrflx) {
        natTypeInference = 'Symmetric / STUN Reflexive NAT';
      } else if (hasRelay) {
        natTypeInference = 'Strict Firewall / TURN Relay Required';
      } else if (candidates.length === 0) {
        natTypeInference = 'STUN Blocked / WebRTC Disabled in Browser';
      }

      resolve({
        id: 'webrtc_' + Date.now(),
        timestamp: Date.now(),
        stunServer,
        candidates,
        publicIps: Array.from(publicIpsSet),
        localIps: Array.from(localIpsSet),
        gatheringTimeMs,
        natTypeInference,
      });
    };

    try {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: stunServer }],
      });

      // Dummy data channel to force ICE candidate gathering
      pc.createDataChannel('netready_probe');

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          // Gathering completed
          finalize();
          return;
        }

        const c = event.candidate;
        const candStr = c.candidate;

        // Parse candidate details
        // e.g. candidate:842163049 1 udp 16777215 192.168.1.50 54321 typ host ...
        const parts = candStr.split(' ');
        const protocol = (parts[2] || 'udp').toLowerCase() as 'udp' | 'tcp';
        const ip = parts[4] || '';
        const port = parseInt(parts[5], 10) || 0;
        const typeIndex = parts.indexOf('typ');
        const typeStr = typeIndex !== -1 ? parts[typeIndex + 1] : 'unknown';

        const type = (['host', 'srflx', 'relay', 'prflx'].includes(typeStr)
          ? typeStr
          : 'unknown') as IceCandidateInfo['type'];

        candidates.push({
          candidate: candStr,
          type,
          protocol,
          ip,
          port,
          priority: c.priority || undefined,
        });

        if (ip) {
          if (type === 'srflx') {
            publicIpsSet.add(ip);
          } else if (type === 'host') {
            localIpsSet.add(ip);
          }
        }
      };

      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => finalize());

      // Timeout after 4.5 seconds if gathering takes too long
      setTimeout(finalize, 4500);
    } catch {
      finalize();
    }
  });
}

// HTTP Probe
export async function probeHttpEndpoint(url: string): Promise<HttpProbeResult> {
  const startTime = performance.now();
  let fullUrl = url.trim();
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    fullUrl = 'https://' + fullUrl;
  }

  try {
    const res = await fetch(fullUrl, { method: 'GET', mode: 'cors' });
    const responseTimeMs = Math.round(performance.now() - startTime);

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      id: 'http_' + Date.now(),
      timestamp: Date.now(),
      url: fullUrl,
      status: res.status,
      statusText: res.statusText,
      responseTimeMs,
      corsAllowed: true,
      isOk: res.ok,
      headers,
    };
  } catch (err: any) {
    const responseTimeMs = Math.round(performance.now() - startTime);
    return {
      id: 'http_' + Date.now(),
      timestamp: Date.now(),
      url: fullUrl,
      responseTimeMs,
      corsAllowed: false,
      isOk: false,
      error: err.message || 'CORS policy blocked or server unreachable',
    };
  }
}

// WebSocket Tester
export async function testWebSocket(
  wsUrl: string = 'wss://echo.websocket.org'
): Promise<WebSocketResult> {
  const startTime = performance.now();
  const pings: number[] = [];

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let handshakeTimeMs = 0;
    let messagesSent = 0;
    let messagesReceived = 0;

    const cleanup = (status: 'connected' | 'error' | 'closed') => {
      if (ws) {
        ws.close();
        ws = null;
      }
      const avgPingMs =
        pings.length > 0 ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : 0;

      resolve({
        id: 'ws_' + Date.now(),
        timestamp: Date.now(),
        url: wsUrl,
        handshakeTimeMs,
        pings,
        avgPingMs,
        status,
        messagesSent,
        messagesReceived,
      });
    };

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        handshakeTimeMs = Math.round(performance.now() - startTime);

        // Send 3 ping echo packets
        const sendEcho = (seq: number) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const msgStart = performance.now();
          const payload = JSON.stringify({ ping: seq, time: msgStart });
          ws.send(payload);
          messagesSent++;

          const onMsg = () => {
            const rtt = Math.round(performance.now() - msgStart);
            pings.push(rtt);
            messagesReceived++;
            ws?.removeEventListener('message', onMsg);

            if (seq < 3) {
              setTimeout(() => sendEcho(seq + 1), 150);
            } else {
              cleanup('connected');
            }
          };

          ws.addEventListener('message', onMsg);
        };

        sendEcho(1);
      };

      ws.onerror = () => {
        cleanup('error');
      };

      setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
          cleanup(pings.length > 0 ? 'connected' : 'error');
        }
      }, 4000);
    } catch {
      cleanup('error');
    }
  });
}

const clampScore = (n: number) => Math.max(10, Math.min(100, Math.round(n)));

/**
 * NetReady readiness score.
 *
 * Returns null when nothing has been measured. Each category is scored only if
 * the measurements it depends on exist; the rest come back null and are named
 * in `missingInputs`. The previous version defaulted its inputs to
 * `dl=30, ul=10, lat=35, jit=5`, so it produced a confident letter grade for a
 * user who had never run a test — and, because it used `||` rather than `??`,
 * silently rewrote a genuine 0 Mbps result as 30 Mbps.
 */
export function calculateNetReadyScore(
  speed?: SpeedTestResult | null,
  pingRes?: PingResult | null,
): NetReadyScore | null {
  const dl = speed?.downloadSpeed ?? null;
  const ul = speed?.uploadSpeed ?? null;
  const lat = pingRes?.avgPing ?? speed?.ping ?? null;
  const jit = pingRes?.jitter ?? speed?.jitter ?? null;

  const missingInputs: string[] = [];
  if (dl === null) missingInputs.push('download speed');
  if (ul === null) missingInputs.push('upload speed');
  if (lat === null) missingInputs.push('latency');
  if (jit === null) missingInputs.push('jitter');

  // Gaming and VoIP are latency-bound; both need jitter as well.
  const gamingScore =
    lat !== null && jit !== null ? clampScore(110 - lat * 0.6 - jit * 2) : null;
  const voipScore =
    lat !== null && jit !== null
      ? clampScore(115 - lat * 0.5 - jit * 3 + (ul !== null && ul > 5 ? 10 : 0))
      : null;
  const streamingScore =
    dl !== null ? clampScore((dl / 30) * 80 + (lat !== null && lat < 50 ? 20 : 0)) : null;
  const browsingScore =
    dl !== null && lat !== null ? clampScore((dl / 15) * 60 + (100 - lat * 0.4)) : null;
  const downloadScore = dl !== null ? clampScore((dl / 100) * 100) : null;

  const scored = [gamingScore, streamingScore, voipScore, browsingScore].filter(
    (s): s is number => s !== null,
  );
  if (scored.length === 0) return null;

  const overallScore = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);

  let grade: NetReadyScore['grade'];
  if (overallScore >= 92) grade = 'A+';
  else if (overallScore >= 82) grade = 'A';
  else if (overallScore >= 70) grade = 'B';
  else if (overallScore >= 55) grade = 'C';
  else if (overallScore >= 40) grade = 'D';
  else grade = 'F';

  // Only describe what was actually measured.
  const details: string[] = [];
  if (lat !== null) {
    details.push(
      lat <= 25
        ? `Latency is ${lat} ms — low enough for real-time competitive gaming.`
        : `Latency is ${lat} ms, typical for standard broadband or Wi-Fi.`,
    );
  }
  if (jit !== null) {
    details.push(
      jit <= 5
        ? `Jitter is ${jit} ms, low enough for smooth voice and video calls.`
        : `Jitter is ${jit} ms, which can cause audible stuttering on calls.`,
    );
  }
  if (dl !== null) {
    details.push(
      dl >= 25
        ? `Download bandwidth (${dl} Mbps) supports multiple 4K streams.`
        : `Download bandwidth (${dl} Mbps) suits HD video and general browsing.`,
    );
  }
  if (speed?.bufferbloatScore && ['C', 'D', 'F'].includes(speed.bufferbloatScore)) {
    details.push(
      `Latency rises sharply under load (bufferbloat grade ${speed.bufferbloatScore}). ` +
        'This affects calls and gaming more than raw bandwidth does.',
    );
  }
  if (missingInputs.length > 0) {
    details.push(
      `Scored without ${missingInputs.join(', ')} — those measurements did not complete.`,
    );
  }

  return {
    overallScore,
    grade,
    gamingScore,
    streamingScore,
    voipScore,
    browsingScore,
    downloadScore,
    details,
    missingInputs,
  };
}

// Port Scanner Engine (Server TCP Sockets + Browser Probes)
export interface PortDefinition {
  port: number;
  service: string;
  description: string;
  category: 'web' | 'database' | 'admin' | 'mail' | 'dev' | 'common';
}

export const COMMON_PORTS: PortDefinition[] = [
  { port: 21, service: 'FTP', description: 'File Transfer Protocol', category: 'admin' },
  { port: 22, service: 'SSH', description: 'Secure Shell / SFTP Remote Admin', category: 'admin' },
  { port: 23, service: 'Telnet', description: 'Unencrypted Remote Terminal', category: 'admin' },
  { port: 25, service: 'SMTP', description: 'Simple Mail Transfer Protocol', category: 'mail' },
  { port: 53, service: 'DNS', description: 'Domain Name System', category: 'common' },
  { port: 80, service: 'HTTP', description: 'Hypertext Transfer Protocol (Web)', category: 'web' },
  { port: 110, service: 'POP3', description: 'Post Office Protocol v3', category: 'mail' },
  { port: 143, service: 'IMAP', description: 'Internet Message Access Protocol', category: 'mail' },
  { port: 443, service: 'HTTPS', description: 'HTTP Secure (SSL/TLS Web)', category: 'web' },
  { port: 465, service: 'SMTPS', description: 'SMTP over SSL', category: 'mail' },
  { port: 587, service: 'Submission', description: 'Mail Submission Agent', category: 'mail' },
  { port: 993, service: 'IMAPS', description: 'IMAP over SSL', category: 'mail' },
  { port: 995, service: 'POP3S', description: 'POP3 over SSL', category: 'mail' },
  { port: 1433, service: 'MSSQL', description: 'Microsoft SQL Server', category: 'database' },
  { port: 1521, service: 'Oracle DB', description: 'Oracle Database', category: 'database' },
  { port: 3000, service: 'Dev Web Server', description: 'Standard Local Development Web Server', category: 'dev' },
  { port: 3306, service: 'MySQL', description: 'MySQL / MariaDB Database', category: 'database' },
  { port: 3389, service: 'RDP', description: 'Remote Desktop Protocol', category: 'admin' },
  { port: 5000, service: 'Flask / Express', description: 'Development Web Server', category: 'dev' },
  { port: 5432, service: 'PostgreSQL', description: 'PostgreSQL Database Engine', category: 'database' },
  { port: 5900, service: 'VNC', description: 'Virtual Network Computing', category: 'admin' },
  { port: 6379, service: 'Redis', description: 'Redis In-Memory Key-Value Store', category: 'database' },
  { port: 8000, service: 'HTTP-Alt', description: 'Alternative HTTP Port', category: 'dev' },
  { port: 8080, service: 'HTTP-Proxy / TomCat', description: 'Alternative Web / Proxy Port', category: 'web' },
  { port: 8443, service: 'HTTPS-Alt', description: 'Alternative HTTPS Port', category: 'web' },
  { port: 9200, service: 'Elasticsearch', description: 'Elasticsearch REST API', category: 'database' },
  { port: 27017, service: 'MongoDB', description: 'MongoDB NoSQL Database', category: 'database' },
];

/** Hard cap on expanded scan targets, applied to CIDR blocks, dashed ranges and
 *  comma lists alike. Surfaced via {@link describeTargetExpansion} so the UI can
 *  say what was dropped — silently scanning 256 of 65,534 hosts and reporting
 *  "no open ports" is a misleading result, not a fast one. */
export const MAX_SCAN_HOSTS = 256;

/** How many addresses a target expression covers, before the cap. */
export function countTargetHosts(input: string): number {
  const raw = input.trim();
  if (!raw) return 1;

  if (raw.includes(',')) {
    return raw.split(',').reduce((sum, part) => sum + countTargetHosts(part), 0);
  }

  if (raw.includes('/')) {
    const [, prefixStr] = raw.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (!isNaN(prefix) && prefix >= 16 && prefix <= 32) {
      const total = Math.pow(2, 32 - prefix);
      return prefix < 31 ? Math.max(1, total - 2) : total;
    }
  }

  if (raw.includes('-')) {
    const [startStr, endRaw] = raw.split('-');
    let endStr = (endRaw ?? '').trim();
    if (endStr && !endStr.includes('.')) {
      const octets = startStr.trim().split('.');
      if (octets.length === 4) endStr = `${octets[0]}.${octets[1]}.${octets[2]}.${endStr}`;
    }
    const toNum = (ip: string) =>
      ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
    const start = toNum(startStr.trim());
    const end = toNum(endStr);
    if (start > 0 && end >= start) return end - start + 1;
  }

  return 1;
}

/** Null when nothing was dropped; otherwise a sentence naming the shortfall. */
export function describeTargetExpansion(input: string): string | null {
  const requested = countTargetHosts(input);
  if (requested <= MAX_SCAN_HOSTS) return null;
  return (
    `${input.trim()} covers ${requested.toLocaleString()} addresses. NetReady scans the first ` +
    `${MAX_SCAN_HOSTS} only — narrow the range to cover the rest.`
  );
}

export function parseTargetHosts(input: string): string[] {
  const raw = input.trim();
  if (!raw) return ['127.0.0.1'];

  // Handle comma separated values
  if (raw.includes(',')) {
    const list: string[] = [];
    for (const part of raw.split(',')) {
      list.push(...parseTargetHosts(part));
    }
    return Array.from(new Set(list)).slice(0, MAX_SCAN_HOSTS);
  }

  // Handle CIDR subnets e.g. 192.168.1.0/24 or 10.0.0.0/28
  if (raw.includes('/')) {
    const [ipPart, prefixStr] = raw.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (!isNaN(prefix) && prefix >= 16 && prefix <= 32) {
      const ipToNum = (ip: string) =>
        ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      const numToIp = (num: number) =>
        [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');

      const cleanIp = ipPart.trim();
      const maskLong = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      const ipLong = ipToNum(cleanIp);
      const networkLong = (ipLong & maskLong) >>> 0;
      const broadcastLong = (networkLong | (~maskLong >>> 0)) >>> 0;

      let firstLong = networkLong;
      let lastLong = broadcastLong;
      if (prefix < 31) {
        firstLong = networkLong + 1;
        lastLong = broadcastLong - 1;
      }

      const count = Math.min(MAX_SCAN_HOSTS, Math.max(1, lastLong - firstLong + 1));
      const ips: string[] = [];
      for (let i = 0; i < count; i++) {
        ips.push(numToIp(firstLong + i));
      }
      return ips;
    }
  }

  // Handle Range e.g. 192.168.1.1-192.168.1.20 or 192.168.1.1-20
  if (raw.includes('-') && !raw.includes('nmap.org')) {
    const parts = raw.split('-');
    const startStr = parts[0].trim();
    let endStr = parts[1].trim();

    if (!endStr.includes('.')) {
      const octets = startStr.split('.');
      if (octets.length === 4) {
        endStr = `${octets[0]}.${octets[1]}.${octets[2]}.${endStr}`;
      }
    }

    const ipToNum = (ip: string) =>
      ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    const numToIp = (num: number) =>
      [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');

    const start = ipToNum(startStr);
    const end = ipToNum(endStr);
    if (start > 0 && end >= start) {
      const count = Math.min(MAX_SCAN_HOSTS, end - start + 1);
      const ips: string[] = [];
      for (let i = 0; i < count; i++) {
        ips.push(numToIp(start + i));
      }
      return ips;
    }
  }

  const clean = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return [clean];
}

// Chrome & Firefox Restricted Ports (Blocked by browser security policy ERR_UNSAFE_PORT)
const RESTRICTED_PORTS = [
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 563, 587,
  601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
];

export async function scanSinglePort(
  host: string,
  port: number,
  timeoutMs: number = 800
): Promise<PortStatus> {
  const cleanHost = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const foundDef = COMMON_PORTS.find((p) => p.port === port);
  const service = foundDef?.service || `Port ${port}`;
  const description = foundDef?.description || `Custom Port ${port}`;

  const isWeb =
    [80, 443, 3000, 5000, 8000, 8080, 8443, 8001, 8081, 8888, 9000].includes(port) ||
    service.toLowerCase().includes('http');
  const protocol: 'http' | 'https' = port === 443 || port === 8443 ? 'https' : 'http';

  // If port is restricted by browser policy, classify as filtered (browser restricted)
  if (RESTRICTED_PORTS.includes(port)) {
    return {
      host: cleanHost,
      port,
      status: 'filtered',
      latencyMs: 0,
      service: `${service} (Browser Restricted)`,
      description: `${description} - Probing restricted by browser security policy.`,
      isWeb,
      protocol,
    };
  }

  // Wall clock for the whole probe chain, reported as `latencyMs`.
  const overallStart = performance.now();

  try {
    const probeWithFetch = async (proto: 'http' | 'https'): Promise<'open' | 'closed' | 'filtered'> => {
      // Each probe times itself. Previously all three shared a single `start`
      // captured before the chain began, so any fallback probe saw the elapsed
      // time of its predecessor too and could only ever return 'filtered' —
      // making the entire fallback path dead code.
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `${proto}://${cleanHost}:${port}/?_cb=${Math.random().toString(36).slice(2)}`;
        await fetch(url, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timer);
        return 'open';
      } catch (err: unknown) {
        clearTimeout(timer);
        const elapsed = performance.now() - start;

        if ((err instanceof Error && err.name === 'AbortError') || elapsed >= timeoutMs - 50) {
          return 'filtered';
        }

        // If fetch failed on HTTPS port in 20ms-500ms (SSL cert error or HTTP/SSL protocol mismatch), the port is OPEN
        if (proto === 'https' && elapsed >= 20 && elapsed < 500) {
          return 'open';
        }

        // Fast rejection (<30ms) indicates TCP RST returned by a live host with closed port
        if (elapsed < 30) {
          return 'closed';
        }

        return 'filtered';
      }
    };

    const probeWithImage = (proto: 'http' | 'https'): Promise<'open' | 'closed' | 'filtered'> => {
      return new Promise((resolve) => {
        const start = performance.now();
        let resolved = false;
        const img = new Image();
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            img.src = '';
            resolve('filtered');
          }
        }, timeoutMs);

        const finish = (s: 'open' | 'closed' | 'filtered') => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            img.src = '';
            resolve(s);
          }
        };

        img.onload = () => finish('open');
        img.onerror = () => {
          const elapsed = performance.now() - start;
          if (elapsed >= timeoutMs - 50) {
            finish('filtered');
          } else if (proto === 'https' && elapsed >= 20 && elapsed < 500) {
            finish('open');
          } else if (elapsed < 30) {
            finish('closed');
          } else {
            finish('filtered');
          }
        };

        try {
          img.src = `${proto}://${cleanHost}:${port}/favicon.ico?_cb=${Math.random().toString(36).slice(2)}`;
        } catch {
          finish('filtered');
        }
      });
    };

    const probeWithWs = (): Promise<'open' | 'closed' | 'filtered'> => {
      return new Promise((resolve) => {
        const start = performance.now();
        let ws: WebSocket | null = null;
        let timer: any = null;

        const finish = (s: 'open' | 'closed' | 'filtered') => {
          if (timer) clearTimeout(timer);
          if (ws) {
            try {
              ws.close();
            } catch {
              /* already closing */
            }
            ws = null;
          }
          resolve(s);
        };

        timer = setTimeout(() => finish('filtered'), timeoutMs);

        try {
          ws = new WebSocket(`ws://${cleanHost}:${port}`);
          ws.onopen = () => finish('open');
          ws.onerror = () => {
            const elapsed = performance.now() - start;
            if (elapsed >= timeoutMs - 50) {
              finish('filtered');
            } else if (elapsed < 30) {
              finish('closed');
            } else {
              finish('filtered');
            }
          };
        } catch {
          finish('filtered');
        }
      });
    };

    let status: 'open' | 'closed' | 'filtered' = 'filtered';

    if ([80, 443, 3000, 5000, 8000, 8080, 8443, 8001, 8081, 8888, 9000].includes(port)) {
      status = await probeWithFetch(protocol);
      if (status === 'filtered') {
        status = await probeWithImage(protocol);
      }
    } else {
      status = await probeWithWs();
      if (status === 'filtered') {
        status = await probeWithFetch('http');
      }
    }

    const latencyMs = Math.round(performance.now() - overallStart);

    return {
      host: cleanHost,
      port,
      status,
      latencyMs,
      service,
      description,
      isWeb,
      protocol,
    };
  } catch {
    const latencyMs = Math.round(performance.now() - overallStart);
    return {
      host: cleanHost,
      port,
      status: 'filtered',
      latencyMs,
      service,
      description: `${description} - Probing error caught safely in browser engine`,
      isWeb,
      protocol,
    };
  }
}

export async function isHostAlive(host: string, timeoutMs: number = 700): Promise<boolean> {
  const cleanHost = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  
  // Try fast concurrent probes across HTTP (80), HTTPS (443), and Web Socket / HTTP (8080)
  const probe80 = scanSinglePort(cleanHost, 80, timeoutMs);
  const probe443 = scanSinglePort(cleanHost, 443, timeoutMs);
  const probe8080 = scanSinglePort(cleanHost, 8080, timeoutMs);

  const results = await Promise.all([probe80, probe443, probe8080]);
  return results.some((r) => r.status === 'open' || r.status === 'closed');
}

export async function scanPortList(
  targetHost: string,
  ports: number[],
  onProgress?: (scannedCount: number, total: number, lastResult: PortStatus, phase?: 'discovery' | 'scanning') => void,
  enableHostDiscovery: boolean = true
): Promise<PortScanResult> {
  const startTime = performance.now();
  const hosts = parseTargetHosts(targetHost);

  const resultsMap: PortStatus[] = [];
  let openCount = 0;
  let closedCount = 0;
  let filteredCount = 0;

  let hostsToScan = hosts;

  // Perform Host Discovery pre-check if scanning multiple hosts or enabled
  if (enableHostDiscovery && hosts.length > 1) {
    const aliveHosts: string[] = [];
    const discoveryConcurrency = 12;

    for (let i = 0; i < hosts.length; i += discoveryConcurrency) {
      const chunk = hosts.slice(i, i + discoveryConcurrency);
      const chunkAlive = await Promise.all(
        chunk.map(async (h) => {
          const alive = await isHostAlive(h, 600);
          return { host: h, alive };
        })
      );

      for (const item of chunkAlive) {
        if (item.alive) {
          aliveHosts.push(item.host);
        } else {
          // Pre-populate offline hosts' ports as filtered to save time
          for (const p of ports) {
            resultsMap.push({
              host: item.host,
              port: p,
              status: 'filtered',
              latencyMs: 0,
              service: COMMON_PORTS.find((cp) => cp.port === p)?.service || `Port ${p}`,
              description: 'Host unreachable during discovery pre-check',
              isWeb: [80, 443, 3000, 5000, 8000, 8080, 8443, 8001, 8081, 8888, 9000].includes(p),
              protocol: p === 443 || p === 8443 ? 'https' : 'http',
            });
            filteredCount++;
          }
        }
      }

      if (onProgress) {
        const dummyResult: PortStatus = {
          host: chunk[chunk.length - 1],
          port: 0,
          status: 'filtered',
          latencyMs: 0,
          service: 'Host Discovery',
          description: 'Ping & Multi-probe Host Discovery',
          isWeb: false,
          protocol: 'http',
        };
        onProgress(Math.min(i + discoveryConcurrency, hosts.length), hosts.length, dummyResult, 'discovery');
      }
    }

    hostsToScan = aliveHosts;
  }

  // Probe ports on live hosts
  const probes: { host: string; port: number }[] = [];
  for (const h of hostsToScan) {
    for (const p of ports) {
      probes.push({ host: h, port: p });
    }
  }

  const totalProbesCount = hosts.length * ports.length;
  let processedCount = resultsMap.length;
  const concurrency = 6;

  for (let i = 0; i < probes.length; i += concurrency) {
    const chunk = probes.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item) => scanSinglePort(item.host, item.port))
    );

    for (const res of chunkResults) {
      resultsMap.push(res);

      if (res.status === 'open') openCount++;
      else if (res.status === 'closed') closedCount++;
      else filteredCount++;

      processedCount++;
      if (onProgress) {
        onProgress(processedCount, totalProbesCount, res, 'scanning');
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);
  const uniqueOpenHosts = new Set(resultsMap.filter((r) => r.status === 'open').map((r) => r.host));

  return {
    id: 'portscan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    targetHost,
    scannedHosts: hosts,
    scannedPorts: ports,
    openPortsCount: openCount,
    closedPortsCount: closedCount,
    filteredPortsCount: filteredCount,
    discoveredHostsCount: uniqueOpenHosts.size,
    ports: resultsMap,
    scanDurationMs: durationMs,
    scanEngine: 'browser',
  };
}
