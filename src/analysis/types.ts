import type {
  CaptivePortalResult,
  DnsIntegrityResult,
  DualStackResult,
  EdgePathResult,
  MeasurementFailure,
  PingResult,
  SpeedTestResult,
} from '../types';

/**
 * The answer layer's vocabulary.
 *
 * Everything here is deterministic and offline. There is no model, no API call
 * and no scoring heuristic hidden behind a friendly sentence: a finding exists
 * because a named predicate over named measurements returned true, and it
 * carries the measurements that made it true. If the inputs a rule needs were
 * not measured, the rule does not fire — it is skipped, and the gap is reported.
 */

/**
 * Where in the path a finding places the fault.
 *
 * Ordered from the user outwards, which is also the order in which a person can
 * actually do something about it.
 */
export type Layer =
  /** The browser or this machine. */
  | 'this-device'
  /** Wi-Fi, cabling, the router, anything up to the demarcation point. */
  | 'local-network'
  /** The access network: the ISP link and whatever it is subscribed to. */
  | 'isp'
  /** The public internet between the ISP and the destination. */
  | 'internet'
  /** The specific service being reached. */
  | 'destination';

/**
 * How firmly the evidence supports the finding.
 *
 * Deliberately ordinal rather than a percentage. A number like "83% confident"
 * would be exactly the kind of invented figure this project exists to keep out:
 * there is no calculation behind it. These three levels each have a stated
 * meaning, and every rule declares which one it is claiming.
 *
 * - `confirmed` — the measurement *is* the finding. Nothing is inferred.
 * - `likely`    — the observed pattern has one dominant cause, but a browser
 *                 cannot see the cause directly.
 * - `possible`  — consistent with the finding, and with other explanations too.
 */
export type Confidence = 'confirmed' | 'likely' | 'possible';

/** How much the finding matters, independent of how sure we are of it. */
export type Severity = 'blocking' | 'degrading' | 'informational';

/** A measurement that supports a finding, quoted rather than summarised. */
export interface Evidence {
  /** Dotted path into the snapshot, e.g. `speed.loadedPing`. Matches the rule's
   *  declared `consumes`, so a claim can always be traced to its inputs. */
  metric: string;
  /** The observed value in words. Only ever describes something measured. */
  observation: string;
}

/** What a rule returns when it fires. */
export interface RuleHit {
  confidence: Confidence;
  severity: Severity;
  /** One sentence stating what is wrong, in plain language. */
  verdict: string;
  /** Concrete actions, most useful first. */
  remediation: string[];
  evidence: Evidence[];
}

export interface Finding extends RuleHit {
  ruleId: string;
  title: string;
  layer: Layer;
}

/**
 * A rule.
 *
 * `consumes` is not decoration. It is the declared contract of what the rule
 * reads, it is rendered in the UI so a user can see why a rule did or did not
 * apply, and it is checked by a test against the evidence each rule actually
 * cites.
 */
export interface Rule {
  id: string;
  title: string;
  layer: Layer;
  consumes: string[];
  /** Null when the rule does not apply, or when its inputs were not measured.
   *  A rule must never substitute a value for an absent input. */
  evaluate: (snapshot: TriageSnapshot) => RuleHit | null;
}

export type TriageStepId =
  | 'browser-online'
  | 'lan-gateway'
  | 'dns'
  | 'captive-portal'
  | 'dual-stack'
  | 'cdn-reach'
  | 'bandwidth'
  | 'bufferbloat';

export type TriageStepStatus =
  | 'pending'
  | 'running'
  | 'pass'
  | 'fail'
  /** Ran, but the result does not support a conclusion either way. */
  | 'inconclusive'
  /** Did not run. `note` says why — never left to look like a pass. */
  | 'skipped';

export interface TriageStep {
  id: TriageStepId;
  label: string;
  /** What this step can actually establish, shown next to the result. */
  question: string;
  status: TriageStepStatus;
  note: string | null;
}

/**
 * Everything one triage run observed.
 *
 * Every field is nullable and null means "not measured". Rules read this
 * structure and nothing else, which is what makes them testable without a
 * network and auditable after the fact.
 */
export interface TriageSnapshot {
  startedAt: number;
  browserOnline: boolean;
  /** `location.protocol`, which decides whether plaintext probes are possible. */
  pageProtocol: string;
  dns: DnsIntegrityResult | null;
  portal: CaptivePortalResult | null;
  dualStack: DualStackResult | null;
  /** Reachability and phase timings across four independent CDNs, plus the
   *  HTTP/3 evidence. Produced by the Edge Path Explorer, reused whole. */
  edge: EdgePathResult | null;
  speed: SpeedTestResult | null;
  ping: PingResult | null;
}

export type Attribution =
  | Layer
  /** Checks ran and none of them found a fault. */
  | 'no-fault-found'
  /** Too little was measured to attribute anything. Distinct from "fine". */
  | 'indeterminate';

export interface TriageVerdict {
  id: string;
  timestamp: number;
  attribution: Attribution;
  /** The one-line answer to "is it me or the internet?". */
  headline: string;
  /** A short paragraph explaining the headline. */
  summary: string;
  /** Ranked, most actionable first. */
  findings: Finding[];
  steps: TriageStep[];
  /** Everything the run could not determine, and why. */
  failures: MeasurementFailure[];
  snapshot: TriageSnapshot;
  totalTimeMs: number;
}
