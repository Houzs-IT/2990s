// ----------------------------------------------------------------------------
// The KPI item editor's form, kept pure: the draft it edits, what it would
// save, what is wrong with it, and the worked examples it shows.
//
// Every figure the preview prints comes from the ENGINE's own functions
// (kpiTierAt / kpiRuleBonusCenti), not a second copy of the arithmetic — the
// example on the form and the payout on the Commission tab cannot disagree.
// ----------------------------------------------------------------------------

import {
  MAX_KPI_QTY_TIERS, kpiRuleBonusCenti, kpiTierAt, qtyTiersError,
  type HrFlagType, type KpiQtyTier,
} from '@2990s/shared/hr-commission';
import { rmToSen, senToRm } from '../../lib/commission-format';
import type { CommissionKpiItem } from '../../lib/commission-api';
import { ruleCovering, type KpiTargetOption } from '../../lib/kpi-rule-targets';

export { MAX_KPI_QTY_TIERS };

/** One tier row as typed. Strings, because "" and "5." are legitimate
 *  half-typed states a number would rewrite under the caret. */
export interface TierDraft { key: number; aboveQty: string; bonusRm: string }

export interface KpiRuleDraft {
  flagType: HrFlagType;
  /** The picked target — create only; an existing rule's target is fixed. */
  target: KpiTargetOption | null;
  bonusRm: string;
  tiers: TierDraft[];
  /** YYYY-MM-DD, or '' for every order ever. */
  effectiveFrom: string;
  countsAsRevenue: boolean;
}

let tierKey = 0;
export const newTierDraft = (aboveQty = '', bonusRm = ''): TierDraft =>
  ({ key: ++tierKey, aboveQty, bonusRm });

/** The first day of the CURRENT Malaysian month. A new rule starts there by
 *  default: no payout period has ever been closed, so a rule with no start
 *  date would also pay every month already gone (the 0226 story). */
export const firstOfMonthMY = (now: number = Date.now()): string => {
  const my = new Date(now + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

const rmText = (centi: number): string => String(senToRm(centi));

export const emptyDraft = (flagType: HrFlagType = 'fabric', now?: number): KpiRuleDraft => ({
  flagType,
  target: null,
  bonusRm: '',
  tiers: [],
  effectiveFrom: firstOfMonthMY(now),
  countsAsRevenue: false,
});

export const draftFromRule = (rule: CommissionKpiItem): KpiRuleDraft => ({
  flagType: rule.flagType,
  target: null,
  bonusRm: rmText(rule.bonusCenti),
  tiers: (rule.qtyTiers ?? []).map((t) => newTierDraft(String(t.aboveQty), rmText(t.bonusCenti))),
  effectiveFrom: rule.effectiveFrom ?? '',
  countsAsRevenue: rule.countsAsRevenue,
});

/** The amounts as the wire wants them. NaN survives where a field cannot be
 *  read, so `draftProblems` can say which. */
export const parseAmounts = (d: Pick<KpiRuleDraft, 'bonusRm' | 'tiers'>): {
  bonusCenti: number; qtyTiers: KpiQtyTier[];
} => ({
  bonusCenti: d.bonusRm.trim() === '' ? NaN : rmToSen(Number(d.bonusRm)),
  qtyTiers: d.tiers.map((t) => ({
    aboveQty: t.aboveQty.trim() === '' ? NaN : Number(t.aboveQty),
    bonusCenti: t.bonusRm.trim() === '' ? NaN : rmToSen(Number(t.bonusRm)),
  })),
});

export interface DraftProblems {
  target?: string;
  duplicate?: string;
  amount?: string;
  tiers?: string;
}

/** Everything that stops a save, by field. `rules` is the live list, so the
 *  duplicate check sees what the table sees. */
export const draftProblems = (
  d: KpiRuleDraft,
  ctx: { mode: 'create' | 'edit'; rules: readonly CommissionKpiItem[]; editingId?: string; nameOf: (r: CommissionKpiItem) => string },
): DraftProblems => {
  const p: DraftProblems = {};
  if (ctx.mode === 'create') {
    if (!d.target) {
      p.target = 'Pick what this KPI item pays on.';
    } else {
      const clash = ruleCovering(d.target, ctx.rules, ctx.editingId);
      if (clash) {
        p.duplicate = `${ctx.nameOf(clash)} already has an active rule. Two rules on the same thing would both pay — edit that one instead, or turn it off first.`;
      }
    }
  }
  const { bonusCenti, qtyTiers } = parseAmounts(d);
  if (!Number.isFinite(bonusCenti) || bonusCenti <= 0) {
    p.amount = 'Enter the amount earned for each unit sold — a KPI item paying RM 0 earns nothing.';
  } else if (qtyTiers.length > 0) {
    if (qtyTiers.some((t) => !Number.isFinite(t.aboveQty) || !Number.isFinite(t.bonusCenti))) {
      p.tiers = 'Fill in both numbers on every tier, or remove the empty one.';
    } else {
      const wrong = qtyTiersError(bonusCenti, qtyTiers);
      if (wrong) p.tiers = wrong;
    }
  }
  return p;
};

export const hasProblems = (p: DraftProblems): boolean => Object.keys(p).length > 0;

export interface PreviewRow {
  qty: number;
  eachCenti: number;
  totalCenti: number;
  /** The step this count reached, or null for the base amount. */
  aboveQty: number | null;
}

/**
 * Worked examples for the form: each step's edge, from both sides — the last
 * count still on the amount below, then the first count on the step — so the
 * jump all-units makes is on screen before anyone is paid by it. A rule
 * without tiers shows one unit and ten.
 */
export const previewRows = (bonusCenti: number, qtyTiers: readonly KpiQtyTier[]): PreviewRow[] => {
  const rule = { bonusCenti, qtyTiers: [...qtyTiers] };
  const steps = [...qtyTiers].sort((a, b) => a.aboveQty - b.aboveQty);
  const counts = steps.length === 0
    ? [1, 10]
    : [...new Set(steps.flatMap((t) => [t.aboveQty, t.aboveQty + 1]))].sort((a, b) => a - b);
  return counts.map((qty) => {
    const { bonusCenti: eachCenti, tier } = kpiTierAt(rule, qty);
    return { qty, eachCenti, totalCenti: kpiRuleBonusCenti(rule, qty), aboveQty: tier?.aboveQty ?? null };
  });
};
