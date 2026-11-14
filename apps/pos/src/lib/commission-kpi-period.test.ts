import { describe, expect, it } from 'vitest';
import type { ItemKpiFlag, KpiUnit } from '@2990s/shared/hr-commission';
import { settleKpiTallies, tallyKpiUnits, type KpiTallies } from './commission-kpi-units';

/* The v4 period pass (owner 2026-11-15): units are counted per salesperson and
   rule across the WHOLE period, then each rule is settled once on its count —
   every unit at the amount the count reached. These pin what that changes and
   what it must not. */

const unit = (over: Partial<KpiUnit> = {}): KpiUnit => ({
  itemCodes: ['ANNSA-3S'], qty: 1, category: 'SOFA', fabricId: 'EM', specialCodes: [],
  lineTotalCenti: 300_000, fabricAddonUnitCenti: 12_500, specialSurchargeUnitCenti: 0, ...over,
});

/* RM 40, more than 5 → RM 50, more than 10 → RM 60. */
const tiered: ItemKpiFlag = {
  id: 'r-embrace', flagType: 'fabric', ref: 'EM', bonusCenti: 4_000,
  qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
};
const label = (f: ItemKpiFlag) => f.ref;

const settle = (tallies: KpiTallies, staff: string) => settleKpiTallies(tallies.get(staff), label);

describe('tally then settle', () => {
  it('a tier is judged on the whole period, not on the order that crossed it', () => {
    const t: KpiTallies = new Map();
    // three orders of 4 — no single order passes 5 or 10; the period has 12
    for (const doc of ['2990-SO-2611-001', '2990-SO-2611-002', '2990-SO-2611-003']) {
      tallyKpiUnits(t, 'amy', doc, [unit({ qty: 4 })], [tiered]);
    }
    const { bonusCenti, detail } = settle(t, 'amy');
    expect(bonusCenti).toBe(72_000); // 12 × RM 60
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({
      qty: 12, bonusCenti: 6_000, lineCenti: 72_000,
      tier: { aboveQty: 10, baseBonusCenti: 4_000 },
    });
    // each order is priced at the period's amount, and they sum to the line
    expect(detail[0]!.orders).toEqual([
      { docNo: '2990-SO-2611-003', qty: 4, lineCenti: 24_000 },
      { docNo: '2990-SO-2611-002', qty: 4, lineCenti: 24_000 },
      { docNo: '2990-SO-2611-001', qty: 4, lineCenti: 24_000 },
    ]);
  });

  it('counts each salesperson on their own', () => {
    const t: KpiTallies = new Map();
    tallyKpiUnits(t, 'amy', 'A', [unit({ qty: 6 })], [tiered]);
    tallyKpiUnits(t, 'ben', 'B', [unit({ qty: 5 })], [tiered]);
    expect(settle(t, 'amy').bonusCenti).toBe(30_000); // 6 × RM 50
    expect(settle(t, 'ben').bonusCenti).toBe(20_000); // 5 × RM 40 — not more than 5
    expect(settle(t, 'ben').detail[0]!.tier).toBeNull();
  });

  it('counts a series over several library ids as ONE rule', () => {
    const monza: ItemKpiFlag = {
      id: 'r-monza', flagType: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-FL'], bonusCenti: 4_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }],
    };
    const t: KpiTallies = new Map();
    tallyKpiUnits(t, 'amy', 'A', [unit({ fabricId: 'MONZA-HL', qty: 5 }), unit({ fabricId: 'MONZA-FL' })], [monza]);
    // 5 + 1 = 6 MONZA sofas → the tier, on all six
    expect(settle(t, 'amy').bonusCenti).toBe(30_000);
  });

  it('a split sofa is one unit, and counts once', () => {
    const t: KpiTallies = new Map();
    // buildKpiUnits already collapsed the modules: one unit of qty 1
    tallyKpiUnits(t, 'amy', 'A', [unit({ itemCodes: ['ANNSA-1A(LHF)', 'ANNSA-CNR', 'ANNSA-1B(RHF)'] })], [tiered]);
    expect(settle(t, 'amy').detail[0]!.qty).toBe(1);
  });

  it('a category rule beaten by a product rule counts nothing toward its tier', () => {
    const product: ItemKpiFlag = { id: 'p', flagType: 'product', ref: 'ANNSA-3S', bonusCenti: 10_000 };
    const category: ItemKpiFlag = {
      id: 'c', flagType: 'category', ref: 'SOFA', bonusCenti: 1_000,
      qtyTiers: [{ aboveQty: 1, bonusCenti: 2_000 }],
    };
    const t: KpiTallies = new Map();
    tallyKpiUnits(t, 'amy', 'A', [unit({ qty: 2 }), unit({ itemCodes: ['BLATT-1S'] })], [product, category]);
    const { detail } = settle(t, 'amy');
    const cat = detail.find((d) => d.label === 'SOFA')!;
    // only the BLATT unit counts for the category: 1, not more than 1 → base
    expect(cat).toMatchObject({ qty: 1, bonusCenti: 1_000, lineCenti: 1_000 });
    expect(detail.find((d) => d.label === 'ANNSA-3S')).toMatchObject({ qty: 2, lineCenti: 20_000 });
  });

  it('without tiers it pays exactly the v3 per-unit sum', () => {
    const flat: ItemKpiFlag = { id: 'd', flagType: 'fabric', ref: 'D', bonusCenti: 5_000 };
    const t: KpiTallies = new Map();
    tallyKpiUnits(t, 'amy', 'A', [unit({ fabricId: 'D', qty: 2 }), unit({ fabricId: 'D' })], [flat]);
    tallyKpiUnits(t, 'amy', 'B', [unit({ fabricId: 'D', qty: 4 })], [flat]);
    expect(settle(t, 'amy')).toMatchObject({ bonusCenti: 35_000, detail: [{ qty: 7, bonusCenti: 5_000, tier: null }] });
  });

  it('a unit of no quantity counts nothing, and a salesperson with nothing settles to RM 0', () => {
    const t: KpiTallies = new Map();
    tallyKpiUnits(t, 'amy', 'A', [unit({ qty: 0 })], [tiered]);
    expect(settle(t, 'amy')).toEqual({ bonusCenti: 0, detail: [] });
    expect(settle(t, 'nobody')).toEqual({ bonusCenti: 0, detail: [] });
  });
});
