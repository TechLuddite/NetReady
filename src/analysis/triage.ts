import type { MeasurementFailure, PingResult, SpeedTestResult } from '../types';
import { createId, executePingBatch, runSpeedTest } from '../utils/network';
import { exploreEdgePath } from '../utils/edgePath';
import { checkCaptivePortal, checkDnsIntegrity } from '../utils/captivePortal';
import { checkDualStack } from '../utils/dualStack';
import { buildVerdict } from './engine';
import { createSnapshot } from './snapshot';
import type { TriageSnapshot, TriageStepId, TriageVerdict } from './types';

/**
 * The one-button triage run.
 *
 * This file gathers evidence and nothing else. It runs the decision tree in
 * order, stops early when a step makes everything after it meaningless, and
 * hands the result to {@link buildVerdict}, which does all the reasoning. The
 * split is deliberate: measurement touches the network and cannot be unit
 * tested; reasoning is pure and is tested exhaustively.
 *
 * Ordering matters. Cheap and decisive checks come first, so a user with no
 * link at all gets an answer in milliseconds rather than after a 25 MB
 * download. And when an early step shows the path out is broken, the later
 * steps are *skipped and reported as skipped* rather than run to produce
 * failures that would look like independent findings.
 */

export interface TriageProgress {
  stepId: TriageStepId;
  label: string;
  /** Live sub-step text from the underlying probe, when it has any. */
  detail: string | null;
}

export interface TriageOptions {
  /** Latency and loss target. Cloudflare's anycast trace endpoint, the same one
   *  the dashboard audit uses. */
  pingUrl?: string;
  pingLabel?: string;
  packetCount?: number;
  onProgress?: (progress: TriageProgress) => void;
  signal?: AbortSignal;
}

const DEFAULT_PING_URL = 'https://1.1.1.1/cdn-cgi/trace';
const DEFAULT_PING_LABEL = 'Cloudflare (1.1.1.1)';
const DEFAULT_PACKET_COUNT = 8;

/**
 * Runs the tree and returns a verdict.
 *
 * Never throws for a network reason: a failed probe is evidence, and the
 * verdict is built from whatever was gathered. It can still reject if the
 * caller aborts.
 */
export async function runTriage(options: TriageOptions = {}): Promise<TriageVerdict> {
  const {
    pingUrl = DEFAULT_PING_URL,
    pingLabel = DEFAULT_PING_LABEL,
    packetCount = DEFAULT_PACKET_COUNT,
    onProgress,
    signal,
  } = options;

  const started = performance.now();
  const failures: MeasurementFailure[] = [];
  const report = (stepId: TriageStepId, label: string, detail: string | null = null) =>
    onProgress?.({ stepId, label, detail });

  const snapshot: TriageSnapshot = createSnapshot({
    startedAt: Date.now(),
    browserOnline: navigator.onLine,
    pageProtocol: typeof location === 'undefined' ? 'https:' : location.protocol,
  });

  const finish = (): TriageVerdict =>
    buildVerdict(snapshot, {
      id: createId('triage'),
      now: Date.now(),
      totalTimeMs: Math.round(performance.now() - started),
      failures,
    });

  report('browser-online', 'Checking for a network link');
  if (!snapshot.browserOnline) {
    // Everything downstream would fail for the same single reason. Running it
    // anyway would produce five failures that read like five problems.
    failures.push({
      metric: 'triage',
      reason: 'network-offline',
      detail:
        'The browser reports no network connection, so the remaining checks were not run. They ' +
        'would all have failed for the same reason, which is not five findings — it is one.',
    });
    return finish();
  }

  report('lan-gateway', 'Local gateway');

  report('dns', 'Testing name resolution');
  snapshot.dns = await checkDnsIntegrity(
    (detail) => report('dns', 'Testing name resolution', detail),
    signal,
  );
  failures.push(...snapshot.dns.failures);

  report('captive-portal', 'Looking for a captive portal or interception');
  snapshot.portal = await checkCaptivePortal(
    (detail) => report('captive-portal', 'Looking for a captive portal or interception', detail),
    signal,
  );
  failures.push(...snapshot.portal.failures);

  report('dual-stack', 'Testing IPv4 and IPv6');
  snapshot.dualStack = await checkDualStack(
    (detail) => report('dual-stack', 'Testing IPv4 and IPv6', detail),
    signal,
  );
  failures.push(...snapshot.dualStack.failures);

  report('cdn-reach', 'Reaching four independent content networks');
  snapshot.edge = await exploreEdgePath(
    undefined,
    (detail) => report('cdn-reach', 'Reaching four independent content networks', detail),
    signal,
  );
  failures.push(...snapshot.edge.failures);

  // Bandwidth is the expensive step — tens of megabytes and about ten seconds.
  // It is worth that only if something out there is answering at all. When no
  // provider responded, the answer is already known and running it would move
  // a lot of data to re-learn it.
  const anyProviderAnswered = snapshot.edge.probes.some((p) => p.availability !== 'request-failed');
  if (!anyProviderAnswered) {
    failures.push({
      metric: 'bandwidth',
      reason: 'not-attempted',
      detail:
        'No content network answered, so the bandwidth test was skipped rather than run to ' +
        'produce a guaranteed failure. There is no throughput figure — not a figure of zero.',
    });
    return finish();
  }

  report('bandwidth', 'Measuring latency and loss');
  const pingResult: PingResult = await executePingBatch(pingUrl, pingLabel, packetCount);
  snapshot.ping = pingResult;

  report('bandwidth', 'Measuring throughput');
  const speedResult: SpeedTestResult = await runSpeedTest(
    (progress) => report('bandwidth', 'Measuring throughput', progress.stage),
    signal,
  );
  snapshot.speed = speedResult;
  failures.push(...(speedResult.failures ?? []));

  report('bufferbloat', 'Comparing idle and loaded latency');

  return finish();
}

/** One-line summary for the history log. Uses only measured values. */
export function summariseVerdict(verdict: TriageVerdict): string {
  const top = verdict.findings[0];
  const passed = verdict.steps.filter((s) => s.status === 'pass').length;
  const total = verdict.steps.length;
  return top
    ? `${top.title} (${top.confidence}) | ${passed}/${total} checks passed`
    : `${verdict.headline} | ${passed}/${total} checks passed`;
}
