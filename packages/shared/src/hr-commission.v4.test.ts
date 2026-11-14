// The v4 engine additions — item-KPI quantity tiers and multi-ref rules (owner
// 2026-11-15). Their own file, like v3: the v1 and v3 suites keep pinning the
// behaviour earlier payouts were computed with, and a v4 rule with no tiers and
// one ref must still pay exactly that.

import { describe, expect, it } from 'vitest';
import {
  COMMISSION_ENGINE_VERSION,
  MAX_KPI_QTY_TIERS,
  firingFlags,
  kpiFlagKey,
  kpiRefsOf,
  kpiRuleBonusCenti,
  kpiTierAt,
  lineKpiCenti,
  qtyTiersError,
  sortedQtyTiers,
  unitKpiCenti,
  unitKpiExcludedCenti,
  type ItemKpiFlag,
  type KpiUnit,
} from './hr-commission';

/* The owner's own example: RM 40 a unit; more than 5 → RM 50; more than 10 → RM 60. */
const ladder: ItemKpiFlag = {
  flagType: 'product', ref: 'X', bonusCenti: 4_000,
  qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
};

describe('engine version', () => {
  it('is v4 — tiers change the arithmetic, so the stamp moves', () => {
    expect(COMMISSION_ENGINE_VERSION).toBe('v4');
  });
});

describe('quantity tiers — every unit pays the step the count reached', () => {
  it('pays the base up to and including the step, the step amount after it ("超过 5 个")', () => {
    expect(kpiTierAt(ladder, 5)).toEqual({ bonusCenti: 4_000, tier: null });
    expect(kpiTierAt(ladder, 6)).toEqual({ bonusCenti: 5_000, tier: { aboveQty: 5, bonusCenti: 5_000 } });
    expect(kpiTierAt(ladder, 10).bonusCenti).toBe(5_000);
    expect(kpiTierAt(ladder, 11).bonusCenti).toBe(6_000);
  });

  it('is ALL-UNITS: 12 sold pays 12 × RM 60, not 5 × 40 + 5 × 50 + 2 × 60', () => {
    // The owner's ruling (2026-11-15). The bracket reading would be RM 570.
    expect(kpiRuleBonusCenti(ladder, 12)).toBe(72_000);
    expect(kpiRuleBonusCenti(ladder, 6)).toBe(30_000);
    expect(kpiRuleBonusCenti(ladder, 5)).toBe(20_000);
  });

  it('pays nothing for no units, whatever the ladder', () => {
    expect(kpiRuleBonusCenti(ladder, 0)).toBe(0);
  });

  it('reads the steps in quantity order however they were stored', () => {
    const shuffled: ItemKpiFlag = { ...ladder, qtyTiers: [...ladder.qtyTiers!].reverse() };
    expect(kpiRuleBonusCenti(shuffled, 12)).toBe(72_000);
    expect(kpiRuleBonusCenti(shuffled, 7)).toBe(35_000);
  });

  it('a rule without tiers pays exactly what v3 paid — qty × amount', () => {
    const flat: ItemKpiFlag = { flagType: 'fabric', ref: 'D', bonusCenti: 5_000 };
    expect(kpiRuleBonusCenti(flat, 1)).toBe(5_000);
    expect(kpiRuleBonusCenti(flat, 40)).toBe(200_000);
    expect(kpiRuleBonusCenti({ ...flat, qtyTiers: [] }, 40)).toBe(200_000);
  });

  it('drops a malformed stored step rather than letting it move a payout', () => {
    expect(sortedQtyTiers([
      { aboveQty: 0, bonusCenti: 9_000 },
      { aboveQty: 2.5, bonusCenti: 9_000 },
      { aboveQty: 3, bonusCenti: -1 },
      { aboveQty: 4, bonusCenti: 5_000 },
    ])).toEqual([{ aboveQty: 4, bonusCenti: 5_000 }]);
    expect(sortedQtyTiers(undefined)).toEqual([]);
    expect(sortedQtyTiers(null)).toEqual([]);
  });
});

describe('qtyTiersError — what the API refuses and the form explains', () => {
  it('accepts the owner\'s ladder, and no tiers at all', () => {
    expect(qtyTiersError(4_000, ladder.qtyTiers!)).toBeNull();
    expect(qtyTiersError(4_000, [])).toBeNull();
  });

  it('refuses a step that pays no more than the one below it', () => {
    expect(qtyTiersError(4_000, [{ aboveQty: 5, bonusCenti: 4_000 }])).toMatch(/must pay more/);
    expect(qtyTiersError(4_000, [{ aboveQty: 5, bonusCenti: 500 }])).toMatch(/must pay more/); // the "5 for 50" typo
    expect(qtyTiersError(4_000, [
      { aboveQty: 5, bonusCenti: 6_000 }, { aboveQty: 10, bonusCenti: 5_000 },
    ])).toMatch(/more than 10/);
  });

  it('judges the steps in quantity order, not the order they were typed', () => {
    expect(qtyTiersError(4_000, [
      { aboveQty: 10, bonusCenti: 6_000 }, { aboveQty: 5, bonusCenti: 5_000 },
    ])).toBeNull();
  });

  it('refuses two steps at the same quantity', () => {
    expect(qtyTiersError(4_000, [
      { aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 5, bonusCenti: 6_000 },
    ])).toMatch(/both start after 5/);
  });

  it('refuses a non-whole or zero quantity, and a zero amount', () => {
    expect(qtyTiersError(4_000, [{ aboveQty: 0, bonusCenti: 5_000 }])).toMatch(/whole number/);
    expect(qtyTiersError(4_000, [{ aboveQty: 1.5, bonusCenti: 5_000 }])).toMatch(/whole number/);
    expect(qtyTiersError(4_000, [{ aboveQty: 3, bonusCenti: 0 }])).toMatch(/above RM 0/);
  });

  it('caps the ladder', () => {
    const many = Array.from({ length: MAX_KPI_QTY_TIERS + 1 }, (_, i) => ({
      aboveQty: (i + 1) * 5, bonusCenti: 5_000 + i * 1_000,
    }));
    expect(qtyTiersError(4_000, many)).toMatch(/at most/);
    expect(qtyTiersError(4_000, many.slice(0, MAX_KPI_QTY_TIERS))).toBeNull();
  });
});

describe('multi-ref rules — one named fabric series over several library ids', () => {
  const unit = (fabricId: string | null, over: Partial<KpiUnit> = {}): KpiUnit => ({
    itemCodes: ['SOFA-1A'], qty: 1, category: 'SOFA', fabricId, specialCodes: [],
    lineTotalCenti: 300_000, fabricAddonUnitCenti: 12_500, specialSurchargeUnitCenti: 0, ...over,
  });
  const monza: ItemKpiFlag = {
    id: 'rule-monza', flagType: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-FL'], bonusCenti: 5_000,
  };

  it('fires on every library id in the series, and on nothing else', () => {
    expect(firingFlags(unit('MONZA-HL'), [monza])).toEqual([monza]);
    expect(firingFlags(unit('MONZA-FL'), [monza])).toEqual([monza]);
    // the series KEY is not itself a library id an order can carry
    expect(firingFlags(unit('MONZA'), [monza])).toEqual([]);
    expect(firingFlags(unit('EM'), [monza])).toEqual([]);
    expect(firingFlags(unit(null), [monza])).toEqual([]);
  });

  it('a rule without refs still matches on ref — every v3 row', () => {
    const legacy: ItemKpiFlag = { flagType: 'fabric', ref: 'BROWNIE', bonusCenti: 25_000 };
    expect(kpiRefsOf(legacy)).toEqual(['BROWNIE']);
    expect(kpiRefsOf({ ...legacy, refs: [] })).toEqual(['BROWNIE']);
    expect(firingFlags(unit('BROWNIE'), [legacy])).toEqual([legacy]);
  });

  it('excludes the fabric add-on and pays the base exactly as a one-ref rule does', () => {
    const u = unit('MONZA-FL', { qty: 2 });
    expect(unitKpiCenti(u, [monza])).toBe(10_000);
    expect(unitKpiExcludedCenti(u, [monza])).toBe(25_000);
  });

  it('a product rule over several SKUs still beats a category rule on any of them', () => {
    const product: ItemKpiFlag = { flagType: 'product', ref: 'A', refs: ['A', 'B'], bonusCenti: 10_000 };
    const category: ItemKpiFlag = { flagType: 'category', ref: 'SOFA', bonusCenti: 3_000 };
    expect(firingFlags(unit(null, { itemCodes: ['B'] }), [product, category])).toEqual([product]);
    expect(firingFlags(unit(null, { itemCodes: ['C'] }), [product, category])).toEqual([category]);
  });

  it('special and line-level matching read refs too', () => {
    const special: ItemKpiFlag = { flagType: 'special', ref: 'LATEX', refs: ['LATEX', 'LATEX-2'], bonusCenti: 5_000 };
    expect(firingFlags(unit(null, { specialCodes: ['LATEX-2'] }), [special])).toEqual([special]);
    expect(lineKpiCenti({ itemCode: 'Z', qty: 3, fabricId: 'MONZA-FL', specialCodes: [] }, [monza])).toBe(15_000);
  });

  it('counts a rule under its id, or its type and ref when it has none', () => {
    expect(kpiFlagKey(monza)).toBe('rule-monza');
    expect(kpiFlagKey({ flagType: 'fabric', ref: 'D' })).toBe('fabric:D');
  });
});
