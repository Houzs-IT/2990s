// ----------------------------------------------------------------------------
// Turn a Sales Order's item lines into item-KPI "units" — the shape the
// commission engine reads to decide which rules fire, what bonus is earned, and
// how much (if anything) leaves the goods a percentage is paid on.
//
// PURE. No network, no React. The fetching lives in commission-kpi-queries.ts.
//
// ── WHAT A "UNIT" IS, AND WHY IT IS NOT A LINE ──────────────────────────────
// One purchased item. A POS sofa build is persisted as several per-module SO
// lines (so-sofa-split) that all carry the same fabric, and its fabric-tier
// add-on is ONE flat per-build figure spread across them. So module lines of one
// build collapse back into a single unit, keyed on `variants.buildKey`: the
// bonus and the exclusion each count ONCE per built sofa, not once per module.
// Getting this wrong pays an N-module sofa N times, which is the bug PR #693
// fixed on the server side.
//
// ── 🔴 THE UNIT TRAP ────────────────────────────────────────────────────────
// Three money sources meet here and they do NOT agree:
//
//   · SO line totals          — INTEGER CENTI (`total_sen` / `total_centi`)
//   · special-order surcharge — INTEGER CENTI (`special_order_price_sen`)
//   · the fabric-tier add-on  — WHOLE RINGGIT. `fabricTierAddon()` returns MYR,
//                               and every POS sell-time caller folds it straight
//                               into a whole-ringgit price
//                               (Configurator.tsx: `sofaFabricDelta`).
//
// KpiUnit wants centi throughout. The conversion is therefore REAL, it is ×100,
// and it is a silent 100× error on a payroll figure if it is missed or applied
// twice. It happens in exactly one place — `myrToCenti` — which exists as a
// named, tested function for that reason and must not be inlined.
// ----------------------------------------------------------------------------

import {
  firingFlags, kpiFlagKey, kpiTierAt, type ItemKpiFlag, type KpiUnit,
} from '@2990s/shared/hr-commission';

/** Whole ringgit → integer centi. The ONE place the fabric-tier add-on crosses
 *  from the sell-time vocabulary into the payroll one. */
export const myrToCenti = (myr: number): number => Math.round(myr * 100);

/** The rules in force for one SO: a rule with a start date applies only to an
 *  SO dated on or after it; no start date = it always applied (migration 0226).
 *  Applied before BOTH the bonus and the exclusion, so they cannot disagree. */
export const flagsInForce = <F extends { effectiveFrom: string | null }>(flags: F[], soDate: string | null): F[] =>
  flags.filter((f) => !f.effectiveFrom || (!!soDate && soDate.slice(0, 10) >= f.effectiveFrom));

/** One SO item line, already normalised out of either backend's spelling. */
export interface CommissionLine {
  itemCode: string;
  qty: number;
  /** Line total, qty-inclusive and post-discount, in centi. */
  totalCenti: number;
  /** Special-order surcharge on this line, in centi (0 when none). Read from
   *  the line, never recomputed — it is a stored column. */
  specialSurchargeCenti: number;
  /** 'service' lines never earn commission and are never KPI units. */
  itemGroup: string | null;
  /** Groups a split sofa's module lines. Absent on every non-sofa line. */
  buildKey: string | null;
  fabricId: string | null;
  /** Special-order add-on codes carried on the line. */
  specialCodes: string[];
  /** The compartment code this module occupies, for the per-compartment
   *  fabric-tier override. Null on non-sofa lines. */
  compartmentCode: string | null;
}

/** Everything the caller must resolve from the catalogue before units can be
 *  built. Injected rather than fetched so this module stays pure and testable. */
export interface UnitContext {
  /** UPPERCASE product category ('SOFA' / 'BEDFRAME' / …), or null when the SKU
   *  could not be resolved. A category rule then simply does not fire, rather
   *  than guessing and paying a bonus nobody configured. */
  categoryOf: (itemCode: string) => string | null;
  /**
   * The per-ITEM fabric-tier add-on this unit was charged, in WHOLE RINGGIT —
   * the same figure and the same shared `fabricTierAddon` the POS used when it
   * sold the thing, so the reported add-on cannot drift from the billed one.
   *
   * Return `null` for "cannot resolve". That is NOT zero: zero means "no add-on
   * was charged", and a payroll screen must not confuse the two. An unresolved
   * add-on is reported to the caller and the unit is left un-excluded rather
   * than silently under-excluded.
   */
  fabricAddonMyr: (u: {
    itemCodes: string[];
    category: string | null;
    fabricId: string;
    compartments: string[];
  }) => number | null;
}

export interface BuiltUnits {
  units: KpiUnit[];
  /** Units whose fabric add-on could not be resolved. Surfaced, never swallowed:
   *  each one is a goods exclusion that did not happen. */
  unresolvedFabric: string[];
}

const norm = (v: unknown): string => String(v ?? '').trim();

/**
 * Build the KPI units for ONE Sales Order.
 *
 * `fabricAddonMyr` is only consulted for units that actually carry a fabric, so
 * a period with no fabric rules configured costs nothing extra.
 */
export const buildKpiUnits = (
  lines: CommissionLine[],
  ctx: UnitContext,
): BuiltUnits => {
  /* Group by build. A line with no buildKey is its own unit — using the item
     code as the key would wrongly merge two separate purchases of the same SKU
     on one order, so each gets a unique synthetic key. */
  const groups = new Map<string, CommissionLine[]>();
  lines.forEach((l, i) => {
    // A service line is not a purchased item: it is not in the goods buckets the
    // percentage runs on, so excluding it would REDUCE goods that never held it.
    if ((l.itemGroup ?? '').toLowerCase() === 'service') return;
    const key = l.buildKey ? `build:${l.buildKey}` : `line:${i}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  });

  const units: KpiUnit[] = [];
  const unresolvedFabric: string[] = [];

  for (const group of groups.values()) {
    /* A build's qty is uniform across its module lines (so-sofa-split writes the
       same qty on each), so take it once. MAX rather than [0] so a hand-edited
       line cannot silently shrink the build. */
    const qty = Math.max(...group.map((l) => l.qty || 0), 0);
    const itemCodes = [...new Set(group.map((l) => norm(l.itemCode)).filter(Boolean))];
    const lineTotalCenti = group.reduce((s, l) => s + l.totalCenti, 0);
    /* The surcharge is PER ITEM, and it is the same on every module line of one
       build (it is charged on the build). Summing across modules would multiply
       it — take the max, which equals the value on any one line. */
    const specialSurchargeUnitCenti = Math.max(...group.map((l) => l.specialSurchargeCenti || 0), 0);
    const specialCodes = [...new Set(group.flatMap((l) => l.specialCodes).map(norm).filter(Boolean))];
    const fabricId = group.map((l) => l.fabricId).find((f) => !!f) ?? null;
    /* Category comes from any module's SKU — every module of one build belongs to
       the same product. First resolvable wins. */
    const category = itemCodes.map((c) => ctx.categoryOf(c)).find((v) => v != null) ?? null;

    let fabricAddonUnitCenti = 0;
    if (fabricId) {
      const compartments = group
        .map((l) => norm(l.compartmentCode))
        .filter(Boolean);
      const myr = ctx.fabricAddonMyr({ itemCodes, category, fabricId, compartments });
      if (myr === null) {
        // Reported, not guessed. Leaving it at 0 means the unit is not excluded,
        // which OVER-pays rather than under-pays — the safer direction — but the
        // caller must still be told.
        unresolvedFabric.push(itemCodes[0] ?? '(unknown item)');
      } else {
        fabricAddonUnitCenti = myrToCenti(myr);
      }
    }

    units.push({
      itemCodes,
      qty,
      category,
      fabricId,
      specialCodes,
      lineTotalCenti,
      fabricAddonUnitCenti,
      specialSurchargeUnitCenti,
    });
  }

  return { units, unresolvedFabric };
};

/* ── the period pass: count, then settle (v4 — owner 2026-11-15) ──────────────
   A quantity tier depends on EVERY unit one salesperson sold under one rule in
   the period, so a bonus can no longer be summed unit by unit. The units are
   counted first — per salesperson, per rule, per order — and each rule is then
   settled once, on its count: every unit at the amount the count reached
   (all-units, the owner's ruling). With no tiers this is exactly the old
   per-unit sum, qty × amount. */

/** One rule's KPI line for one salesperson: what it paid and which orders it
 *  came from. Owner 2026-08-31: "我要它的 dropdown 这一边可以看到 Sales Order
 *  Number，这样我知道它是哪一个 Sales Order" — "12 × RM 50" is not checkable
 *  until you can see WHICH twelve. */
export interface CommissionKpiDetail {
  label: string;
  qty: number;
  /** Per-unit amount actually paid: the rule's base, or the quantity tier its
   *  `qty` reached — which then pays every one of those units. */
  bonusCenti: number;
  lineCenti: number;
  /** Set when a quantity tier lifted the amount: the step reached, and the
   *  base it replaced. Absent / null on a rule paying its base. */
  tier?: { aboveQty: number; baseBonusCenti: number } | null;
  /** The orders that earned it, newest doc_no first. */
  orders: Array<{ docNo: string; qty: number; lineCenti: number }>;
}

/** One rule's units for one salesperson across the period — the count its
 *  quantity tiers are judged on. */
export interface KpiRuleTally {
  flag: ItemKpiFlag;
  qty: number;
  /** doc_no → the units that order contributed. */
  orders: Map<string, number>;
}

/** staff id → rule key (kpiFlagKey) → tally. */
export type KpiTallies = Map<string, Map<string, KpiRuleTally>>;

/** Count one order's units into the tallies: every unit under every rule that
 *  FIRES on it — after precedence, so a category rule a product rule beat
 *  counts nothing, exactly as it pays nothing. */
export const tallyKpiUnits = (
  tallies: KpiTallies,
  staffId: string,
  docNo: string,
  units: readonly KpiUnit[],
  flags: ItemKpiFlag[],
): void => {
  for (const u of units) {
    if (!(u.qty > 0)) continue;
    for (const f of firingFlags(u, flags)) {
      const byRule = tallies.get(staffId) ?? new Map<string, KpiRuleTally>();
      const key = kpiFlagKey(f);
      const t = byRule.get(key) ?? { flag: f, qty: 0, orders: new Map<string, number>() };
      t.qty += u.qty;
      t.orders.set(docNo, (t.orders.get(docNo) ?? 0) + u.qty);
      byRule.set(key, t);
      tallies.set(staffId, byRule);
    }
  }
};

/** Settle one salesperson's tallies: each rule pays its count × the amount the
 *  count reached. The detail sums back to `bonusCenti` by construction. */
export const settleKpiTallies = (
  byRule: ReadonlyMap<string, KpiRuleTally> | undefined,
  labelOf: (f: ItemKpiFlag) => string,
): { bonusCenti: number; detail: CommissionKpiDetail[] } => {
  let bonusCenti = 0;
  const detail: CommissionKpiDetail[] = [];
  for (const t of byRule?.values() ?? []) {
    const { bonusCenti: each, tier } = kpiTierAt(t.flag, t.qty);
    const lineCenti = t.qty * each;
    if (lineCenti <= 0) continue;
    bonusCenti += lineCenti;
    detail.push({
      label: labelOf(t.flag),
      qty: t.qty,
      bonusCenti: each,
      lineCenti,
      tier: tier ? { aboveQty: tier.aboveQty, baseBonusCenti: t.flag.bonusCenti } : null,
      /* Newest first — doc numbers are date-ordered by construction
         (2990-SO-YYMM-NNN), so a plain reverse sort is chronological. Each
         order is priced at the SAME reached amount: under all-units the tier
         belongs to the period, not to the order that crossed it. */
      orders: [...t.orders.entries()]
        .map(([docNo, qty]) => ({ docNo, qty, lineCenti: qty * each }))
        .sort((a, b) => b.docNo.localeCompare(a.docNo)),
    });
  }
  return { bonusCenti, detail };
};
