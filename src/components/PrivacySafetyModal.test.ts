import { describe, expect, it } from 'vitest';
import { THIRD_PARTY_DISCLOSURES } from './PrivacySafetyModal';
import { WALK_TARGETS } from '../utils/walkTest';
import { FAMILY_ENDPOINTS } from '../utils/dualStack';

/**
 * The disclosure list is a contract with the user, and the rule is that a new
 * probe endpoint gets disclosed in the same commit that adds it.
 *
 * A rule enforced by discipline alone is a rule that eventually slips, and it
 * did: swapping Facebook for Atlassian in `WALK_TARGETS` updated the README
 * table and left the in-app modal naming a host the browser no longer contacts
 * while omitting one it now does. Nothing failed, because prose does not
 * typecheck. These tests are the thing that fails instead.
 *
 * They deliberately check both directions. A missing host understates what
 * leaves the browser, which is the serious one. A stale host overstates it,
 * which is the kind of error that quietly erodes the list's credibility until
 * nobody reads it.
 */

const allDisclosedText = THIRD_PARTY_DISCLOSURES.map((d) => `${d.host} ${d.receives}`).join('\n');
const allDisclosedHosts = THIRD_PARTY_DISCLOSURES.map((d) => d.host).join(', ');

describe('THIRD_PARTY_DISCLOSURES', () => {
  it('names every host Walk & Test probes', () => {
    for (const target of WALK_TARGETS) {
      expect(allDisclosedHosts, `${target.host} is probed but not disclosed`).toContain(
        target.host,
      );
    }
  });

  it('does not name a Walk & Test host that was removed from the target list', () => {
    // Meta domains were dropped because blocklists made them a false alarm. If
    // the disclosure still claims the browser contacts them, the list is
    // describing an app that no longer exists.
    const dropped = ['www.facebook.com', 'www.instagram.com'];
    for (const host of dropped) {
      expect(allDisclosedHosts, `${host} is disclosed but no longer probed`).not.toContain(host);
    }
  });

  it('names every dual-stack probe host', () => {
    for (const endpoint of FAMILY_ENDPOINTS) {
      expect(allDisclosedHosts, `${endpoint.host} is probed but not disclosed`).toContain(
        endpoint.host,
      );
    }
  });

  it('gives every row a host and a description of what that host receives', () => {
    for (const row of THIRD_PARTY_DISCLOSURES) {
      expect(row.host.trim().length).toBeGreaterThan(0);
      // A row that names a host without saying what it gets is decoration.
      expect(row.receives.trim().length).toBeGreaterThan(20);
    }
  });

  it('says what the walk sends, not just who it sends it to', () => {
    // The specifics a reader needs to judge the trade: how often, how much, and
    // whether they are identifiable while it happens.
    expect(allDisclosedText).toContain('Walk & Test');
    expect(allDisclosedText).toMatch(/no cookies|credentials/i);
  });
});
