import { describe, it, expect, afterEach } from 'vitest';
import { UtmAttributionTracker } from '../../src/growth/utm-attribution-tracker.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('UtmAttributionTracker.parseUtmFromUrl', () => {
  it('should extract all UTM params from URL', () => {
    const utm = UtmAttributionTracker.parseUtmFromUrl(
      'https://cashclaw.cc/signup?utm_source=twitter&utm_medium=cpc&utm_campaign=launch-2026&utm_content=hero&utm_term=polymarket',
    );
    expect(utm.source).toBe('twitter');
    expect(utm.medium).toBe('cpc');
    expect(utm.campaign).toBe('launch-2026');
    expect(utm.content).toBe('hero');
    expect(utm.term).toBe('polymarket');
  });

  it('should return nulls for missing params', () => {
    const utm = UtmAttributionTracker.parseUtmFromUrl('https://cashclaw.cc/signup');
    expect(utm.source).toBeNull();
    expect(utm.medium).toBeNull();
    expect(utm.campaign).toBeNull();
  });

  it('should handle partial UTM params', () => {
    const utm = UtmAttributionTracker.parseUtmFromUrl('https://cashclaw.cc/?utm_source=google');
    expect(utm.source).toBe('google');
    expect(utm.medium).toBeNull();
  });

  it('should handle invalid URLs gracefully', () => {
    const utm = UtmAttributionTracker.parseUtmFromUrl('not-a-url');
    expect(utm.source).toBeNull();
  });
});

describe('UtmAttributionTracker with SQLite', () => {
  let tmpDir: string;
  let tracker: UtmAttributionTracker;

  afterEach(() => {
    tracker?.destroy();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeTracker(): UtmAttributionTracker {
    tmpDir = mkdtempSync(join(tmpdir(), 'utm-test-'));
    return new UtmAttributionTracker(join(tmpDir, 'utm.db'));
  }

  it('should record and query source breakdown', () => {
    tracker = makeTracker();
    tracker.recordAttribution('u1', { source: 'twitter', medium: 'organic', campaign: null, content: null, term: null });
    tracker.recordAttribution('u2', { source: 'twitter', medium: 'cpc', campaign: null, content: null, term: null });
    tracker.recordAttribution('u3', { source: 'google', medium: 'cpc', campaign: null, content: null, term: null });

    const breakdown = tracker.getSourceBreakdown();
    expect(breakdown['twitter']).toBe(2);
    expect(breakdown['google']).toBe(1);
  });

  it('should record and query campaign breakdown', () => {
    tracker = makeTracker();
    tracker.recordAttribution('u1', { source: 'twitter', medium: null, campaign: 'launch-2026', content: null, term: null });
    tracker.recordAttribution('u2', { source: 'google', medium: null, campaign: 'launch-2026', content: null, term: null });

    const breakdown = tracker.getCampaignBreakdown();
    expect(breakdown['launch-2026']).toBe(2);
  });

  it('should track referral vs organic signups', () => {
    tracker = makeTracker();
    tracker.recordAttribution('u1', { source: null, medium: null, campaign: null, content: null, term: null }, 'REF123');
    tracker.recordAttribution('u2', { source: 'google', medium: null, campaign: null, content: null, term: null });
    tracker.recordAttribution('u3', { source: null, medium: null, campaign: null, content: null, term: null }, 'REF456');

    const result = tracker.getReferralVsOrganic();
    expect(result.referral).toBe(2);
    expect(result.organic).toBe(1);
  });

  it('should work without SQLite (in-memory only)', () => {
    tracker = new UtmAttributionTracker();
    // Should not throw
    tracker.recordAttribution('u1', { source: 'test', medium: null, campaign: null, content: null, term: null });
    expect(tracker.getSourceBreakdown()).toEqual({});
  });
});
