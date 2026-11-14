import { describe, expect, it } from 'vitest';
import type { CommissionKpiItem } from '../../lib/commission-api';
import type { KpiTargetOption } from '../../lib/kpi-rule-targets';
import {
  draftFromRule, draftProblems, emptyDraft, firstOfMonthMY, hasProblems, newTierDraft,
  parseAmounts, previewRows, type KpiRuleDraft,
} from './kpi-rule-form';

const EMBRACE: KpiTargetOption = {
  flagType: 'fabric', ref: 'EM', refs: ['EM'], label: 'EMBRACE', detail: 'EM · 13 colours', search: 'embrace em',
};
const rule = (over: Partial<CommissionKpiItem> = {}): CommissionKpiItem => ({
  id: 'r1', flagType: 'fabric', ref: 'BROWNIE', refs: [], label: 'BROWNIE',
  bonusCenti: 25_000, qtyTiers: [], countsAsRevenue: false, effectiveFrom: '2026-10-01', active: true,
  ...over,
});
const ctx = (rules: CommissionKpiItem[] = []) =>
  ({ mode: 'create' as const, rules, nameOf: (r: CommissionKpiItem) => r.label });

const draft = (over: Partial<KpiRuleDraft> = {}): KpiRuleDraft =>
  ({ ...emptyDraft('fabric', Date.UTC(2026, 10, 15)), target: EMBRACE, bonusRm: '40', ...over });

describe('firstOfMonthMY', () => {
  it('is the first of the Malaysian month, even in the UTC evening before it', () => {
    expect(firstOfMonthMY(Date.UTC(2026, 10, 15, 3))).toBe('2026-11-01');
    // 31 Oct 17:00 UTC is already 1 Nov 01:00 in Malaysia
    expect(firstOfMonthMY(Date.UTC(2026, 9, 31, 17))).toBe('2026-11-01');
  });
  it('is where a new rule starts by default', () => {
    expect(emptyDraft('fabric', Date.UTC(2026, 10, 15)).effectiveFrom).toBe('2026-11-01');
  });
});

describe('draftProblems', () => {
  it('a complete rule with the owner\'s ladder is fine', () => {
    const d = draft({ tiers: [newTierDraft('5', '50'), newTierDraft('10', '60')] });
    expect(draftProblems(d, ctx())).toEqual({});
    expect(parseAmounts(d)).toEqual({
      bonusCenti: 4_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
    });
  });

  it('asks for a target and an amount', () => {
    const p = draftProblems(draft({ target: null, bonusRm: '' }), ctx());
    expect(p.target).toMatch(/Pick what/);
    expect(p.amount).toMatch(/RM 0 earns nothing/);
    expect(draftProblems(draft({ bonusRm: '0' }), ctx()).amount).toBeDefined();
  });

  it('refuses a half-filled tier, and a tier paying no more than the step below', () => {
    expect(draftProblems(draft({ tiers: [newTierDraft('5', '')] }), ctx()).tiers).toMatch(/both numbers/);
    expect(draftProblems(draft({ tiers: [newTierDraft('5', '5')] }), ctx()).tiers).toMatch(/must pay more/);
  });

  it('refuses a second active rule on the same series — rules stack, so both would pay', () => {
    const p = draftProblems(draft(), ctx([rule({ id: 'x', ref: 'EM', label: 'EMBRACE' })]));
    expect(p.duplicate).toMatch(/EMBRACE already has an active rule/);
    expect(hasProblems(p)).toBe(true);
    // a switched-off one does not block
    expect(draftProblems(draft(), ctx([rule({ ref: 'EM', active: false })])).duplicate).toBeUndefined();
  });

  it('an edit never asks for a target', () => {
    const p = draftProblems({ ...draftFromRule(rule()), target: null }, { mode: 'edit', rules: [rule()], editingId: 'r1', nameOf: () => '' });
    expect(p).toEqual({});
  });
});

describe('draftFromRule', () => {
  it('reads a stored rule back into the form, in ringgit', () => {
    const d = draftFromRule(rule({ bonusCenti: 12_550, qtyTiers: [{ aboveQty: 5, bonusCenti: 15_000 }], effectiveFrom: null }));
    expect(d.bonusRm).toBe('125.5');
    expect(d.tiers.map((t) => [t.aboveQty, t.bonusRm])).toEqual([['5', '150']]);
    expect(d.effectiveFrom).toBe('');
  });
});

describe('previewRows — worked examples from the engine\'s own functions', () => {
  it('shows each step from both sides, so the all-units jump is visible', () => {
    expect(previewRows(4_000, [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }])).toEqual([
      { qty: 5, eachCenti: 4_000, totalCenti: 20_000, aboveQty: null },
      { qty: 6, eachCenti: 5_000, totalCenti: 30_000, aboveQty: 5 },
      { qty: 10, eachCenti: 5_000, totalCenti: 50_000, aboveQty: 5 },
      { qty: 11, eachCenti: 6_000, totalCenti: 66_000, aboveQty: 10 },
    ]);
  });
  it('a flat rule shows one unit and ten', () => {
    expect(previewRows(12_500, []).map((r) => [r.qty, r.totalCenti])).toEqual([[1, 12_500], [10, 125_000]]);
  });
});
