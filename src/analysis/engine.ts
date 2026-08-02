import type { MeasurementFailure } from '../types';
import { RULES, THRESHOLDS } from './rules';
import type {
  Attribution,
  Confidence,
  Finding,
  Layer,
  Rule,
  Severity,
  TriageSnapshot,
  TriageStep,
  TriageStepStatus,
  TriageVerdict,
} from './types';

/**
 * The rules engine.
 *
 * Deterministic and offline by construction: same snapshot in, same verdict
 * out, with no clock, no randomness and no network. That is what makes the
 * answer auditable — a user can be shown the evidence, and a test can assert
 * the whole conclusion from a literal object.
 *
 * The engine's one real responsibility beyond running the rules is knowing the
 * difference between "checked and fine" and "did not check". Those must never
 * collapse into the same answer; a diagnostic that says "nothing wrong" because
 * it measured nothing is the same failure this codebase was rebuilt to remove.
 */

const CONFIDENCE_RANK: Record<Confidence, number> = {
  confirmed: 3,
  likely: 2,
  possible: 1,
};

const SEVERITY_RANK: Record<Severity, number> = {
  blocking: 3,
  degrading: 2,
  informational: 1,
};

/** Runs every rule. Order of the returned findings is the rule table's order;
 *  {@link rankFindings} imposes the presentation order. */
export function evaluateRules(snapshot: TriageSnapshot, rules: Rule[] = RULES): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    const hit = rule.evaluate(snapshot);
    if (hit === null) continue;
    findings.push({ ...hit, ruleId: rule.id, title: rule.title, layer: rule.layer });
  }
  return findings;
}

/**
 * Ranks findings for display.
 *
 * Severity leads confidence deliberately. Something that stops the connection
 * working is worth reading before something that merely slows it down, even
 * when the engine is less certain about it — a user chasing a dead connection
 * is not helped by a confirmed note about jitter sitting at the top.
 *
 * Ties break on the rule table's own order so the output is stable.
 */
export function rankFindings(findings: readonly Finding[], rules: Rule[] = RULES): Finding[] {
  const order = new Map(rules.map((r, i) => [r.id, i]));
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (conf !== 0) return conf;
    return (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0);
  });
}

/**
 * How many independent checks actually produced a usable answer.
 *
 * This is what separates "no fault found" from "we do not know". A run that
 * reached one endpoint and gave up has not cleared the network.
 */
export function countConclusiveChecks(s: TriageSnapshot): number {
  let n = 0;
  if (s.dns?.verdict != null) n++;
  if (s.portal?.verdict != null) n++;
  if (s.dualStack?.verdict != null) n++;
  if ((s.edge?.probes.length ?? 0) > 0) n++;
  if (s.speed?.downloadSpeed != null) n++;
  if (s.ping?.avgPing != null) n++;
  return n;
}

/** Below this, the engine says it does not know rather than saying it is fine. */
export const MIN_CHECKS_FOR_ALL_CLEAR = 3;

const HEADLINES: Record<Attribution, string> = {
  'this-device': 'It is this device.',
  'local-network': 'It is your local network, not the internet.',
  isp: 'It is the connection between you and the internet.',
  internet: 'It is out on the internet, past your provider.',
  destination: 'It is the service you are trying to reach, not your connection.',
  'no-fault-found': 'Nothing here is broken.',
  indeterminate: 'Not enough was measured to answer.',
};

const LAYER_NAMES: Record<Layer, string> = {
  'this-device': 'this device',
  'local-network': 'your local network',
  isp: 'your internet connection',
  internet: 'the wider internet',
  destination: 'the destination service',
};

/** Plain-language name for a layer, for use in prose. */
export function describeLayer(layer: Layer): string {
  return LAYER_NAMES[layer];
}

/**
 * Derives the decision-tree display from the snapshot.
 *
 * Deriving rather than recording means the tree cannot drift out of step with
 * the data behind it, and it can be tested from a literal snapshot. A step whose
 * input is missing is `skipped` with a reason — never left blank, which reads as
 * a pass.
 */
export function deriveSteps(s: TriageSnapshot): TriageStep[] {
  const step = (
    id: TriageStep['id'],
    label: string,
    question: string,
    status: TriageStepStatus,
    note: string | null,
  ): TriageStep => ({ id, label, question, status, note });

  const steps: TriageStep[] = [];

  steps.push(
    step(
      'browser-online',
      'Browser reports a link',
      'Does this machine have a network interface at all?',
      s.browserOnline ? 'pass' : 'fail',
      s.browserOnline
        ? 'navigator.onLine is true. This means a link exists, not that it reaches anything.'
        : 'navigator.onLine is false. No further check can mean anything until this changes.',
    ),
  );

  // A browser cannot discover the default gateway. WebRTC used to leak local
  // addresses; every current browser returns an mDNS `.local` candidate
  // instead. And a page served over https: may not open a plaintext connection
  // to a device with no certificate, which is every home router. Saying so is
  // the honest result — the alternative is a probe that always fails and gets
  // read as "the gateway is down".
  steps.push(
    step(
      'lan-gateway',
      'LAN gateway reachable',
      'Is the router answering?',
      'skipped',
      s.pageProtocol === 'https:'
        ? 'A browser cannot read this machine’s gateway address (modern browsers return an mDNS ' +
          '.local candidate instead), and a page served over HTTPS may not open a plaintext ' +
          'connection to a device without a certificate. Use the Port Scanner with your gateway ' +
          'address to check it directly.'
        : 'A browser cannot read this machine’s gateway address, so there is nothing to probe ' +
          'automatically. Enter it in the Port Scanner to check it directly.',
    ),
  );

  steps.push(
    step(
      'dns',
      'Names resolve',
      'Does this network turn hostnames into addresses?',
      s.dns === null
        ? 'skipped'
        : s.dns.verdict === 'resolver-working'
          ? 'pass'
          : s.dns.verdict === null
            ? 'inconclusive'
            : 'fail',
      s.dns === null ? 'The DNS check did not run.' : s.dns.explanation,
    ),
  );

  steps.push(
    step(
      'captive-portal',
      'No portal or interception',
      'Is anything standing between this browser and the endpoints it asked for?',
      s.portal === null
        ? 'skipped'
        : s.portal.verdict === 'no-interception-detected'
          ? 'pass'
          : s.portal.verdict === null || s.portal.verdict === 'mixed'
            ? 'inconclusive'
            : 'fail',
      s.portal === null ? 'The interception check did not run.' : s.portal.explanation,
    ),
  );

  steps.push(
    step(
      'dual-stack',
      'IPv4 and IPv6',
      'Which address families work from here?',
      s.dualStack === null
        ? 'skipped'
        : s.dualStack.verdict === 'dual-stack'
          ? 'pass'
          : s.dualStack.verdict === 'neither-family-answered'
            ? 'fail'
            : 'inconclusive',
      s.dualStack === null ? 'The dual-stack check did not run.' : s.dualStack.explanation,
    ),
  );

  const probes = s.edge?.probes ?? [];
  const failedProbes = probes.filter((p) => p.availability === 'request-failed').length;
  steps.push(
    step(
      'cdn-reach',
      'Independent providers answer',
      'Can several unrelated content networks be reached?',
      probes.length === 0
        ? 'skipped'
        : failedProbes === probes.length
          ? 'fail'
          : failedProbes > 0
            ? 'inconclusive'
            : 'pass',
      probes.length === 0
        ? 'No provider was probed.'
        : `${probes.length - failedProbes} of ${probes.length} providers answered.`,
    ),
  );

  const download = s.speed?.downloadSpeed ?? null;
  steps.push(
    step(
      'bandwidth',
      'Throughput measured',
      'How much did the link actually carry?',
      s.speed === null ? 'skipped' : download === null ? 'inconclusive' : 'pass',
      s.speed === null
        ? 'The bandwidth test did not run.'
        : download === null
          ? 'No bytes could be timed, so there is no throughput figure — not a figure of zero.'
          : `${download} Mbps down${
              s.speed.uploadSpeed === null ? '' : `, ${s.speed.uploadSpeed} Mbps up`
            }.`,
    ),
  );

  const idle = s.speed?.ping ?? null;
  const loaded = s.speed?.loadedPing ?? null;
  steps.push(
    step(
      'bufferbloat',
      'Latency holds under load',
      'Does the connection stay responsive while it is busy?',
      s.speed === null
        ? 'skipped'
        : idle === null || loaded === null
          ? 'inconclusive'
          : loaded - idle >= THRESHOLDS.bufferbloatDeltaMs
            ? 'fail'
            : 'pass',
      s.speed === null
        ? 'The bandwidth test did not run, so there was no load to measure under.'
        : idle === null || loaded === null
          ? 'Bufferbloat needs both an idle and an under-load latency sample; one of them is missing.'
          : `${idle} ms idle, ${loaded} ms under load (${
              loaded - idle >= 0 ? '+' : ''
            }${Math.round(loaded - idle)} ms).`,
    ),
  );

  return steps;
}

function summarise(
  attribution: Attribution,
  findings: readonly Finding[],
  conclusive: number,
): string {
  if (attribution === 'indeterminate') {
    return (
      `Only ${conclusive} check${conclusive === 1 ? '' : 's'} produced a usable result, which is ` +
      `fewer than the ${MIN_CHECKS_FOR_ALL_CLEAR} needed before this tool will call a network ` +
      'healthy. The steps below show what ran and what did not. Nothing here says the connection ' +
      'is fine, and nothing says it is broken.'
    );
  }

  if (attribution === 'no-fault-found') {
    return (
      `${conclusive} independent checks completed and none of the ${RULES.length} rules matched. ` +
      'That covers name resolution, interception, address families, several unrelated providers ' +
      'and the link itself. It does not cover anything that was skipped — see the steps below.'
    );
  }

  const top = findings[0];
  const others = findings.length - 1;
  return (
    `${top.verdict} ` +
    (others > 0
      ? `${others} further finding${others === 1 ? '' : 's'} ${others === 1 ? 'is' : 'are'} listed below, ranked by how much ${others === 1 ? 'it' : 'they'} ${others === 1 ? 'matters' : 'matter'}.`
      : 'No other rule matched.')
  );
}

/**
 * Builds the verdict from a snapshot.
 *
 * `now` and `id` are injected rather than generated so the whole function is
 * pure and a test can assert on the complete object.
 */
export function buildVerdict(
  snapshot: TriageSnapshot,
  options: { id: string; now: number; totalTimeMs: number; failures?: MeasurementFailure[] },
): TriageVerdict {
  const findings = rankFindings(evaluateRules(snapshot));
  const conclusive = countConclusiveChecks(snapshot);

  let attribution: Attribution;
  if (findings.length > 0) {
    attribution = findings[0].layer;
  } else if (conclusive >= MIN_CHECKS_FOR_ALL_CLEAR) {
    attribution = 'no-fault-found';
  } else {
    attribution = 'indeterminate';
  }

  return {
    id: options.id,
    timestamp: options.now,
    attribution,
    headline: HEADLINES[attribution],
    summary: summarise(attribution, findings, conclusive),
    findings,
    steps: deriveSteps(snapshot),
    failures: options.failures ?? [],
    snapshot,
    totalTimeMs: options.totalTimeMs,
  };
}
