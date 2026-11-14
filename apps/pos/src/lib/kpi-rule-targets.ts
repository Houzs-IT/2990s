// ----------------------------------------------------------------------------
// What an item-KPI rule can target, and what to call a rule that exists.
//
// PURE — no network, no React. The hook that feeds it is
// kpi-rule-targets-queries.ts.
//
// ── WHY THE FABRIC PICKER LISTS SERIES, NOT LIBRARY ROWS ────────────────────
// Owner 2026-11-15, on the picker reading "MONS / D / EM / MONZA-HL-B01 / …":
// "为什么这个 fabric series 它不是显示 fabric series 的名字，而是这样乱码？".
// Those were fabric_library ids — the PRICING records. What staff call a
// fabric is the series saved in the Fabric Converter (EMBRACE, HOMELY …),
// which every other POS screen already shows since #827 / #835. So the picker
// groups the library exactly as Fabric tiers does (groupFabricPricingSeries):
// one entry per series, carrying every library id under it.
//
// That grouping is also the one that cannot double-pay. A KPI rule matches an
// order line on its library id (variants.fabricId). When two saved series share
// one library id — BROWNIE-01..10 are HOMELY, BROWNIE-11 has no series, all
// under library id BROWNIE — a rule on either would pay both, so the pricing
// grouping merges them into one entry, "HOMELY / BROWNIE", that says so.
//
// ── WHY A RULE IS DESCRIBED LIVE ────────────────────────────────────────────
// The label stored on a rule is a snapshot from the day it was made ("BROWNIE",
// "KN01"). The name it should show is the series its refs belong to TODAY, and
// a ref that belongs to nothing any more is the thing worth flagging: on
// 2026-11-13 Houzs renamed the EMBRACE codes KN01–KN13 to EM-01–EM-13 and moved
// every order line with them, and eleven rules naming KN codes silently stopped
// paying.
// ----------------------------------------------------------------------------

import { kpiRefsOf, type HrFlagType } from '@2990s/shared/hr-commission';
import { groupFabricPricingSeries, type FabricSeriesName } from './fabric-series-groups';

export interface KpiTargetOption {
  flagType: HrFlagType;
  /** The rule's `ref` when saved. A series over one library id saves that id —
   *  so the rule also reads correctly to anything that only knows `ref` — and
   *  a series over several saves its series key. */
  ref: string;
  /** Everything the rule will pay on. */
  refs: string[];
  /** What staff call it: a saved series name, a product name, a category. */
  label: string;
  /** The codes behind the name, for recognition ("EM · 13 colours"). */
  detail: string | null;
  /** Lower-case haystack for the search box — the name and every code. */
  search: string;
}

export type KpiTargetOptions = Record<HrFlagType, KpiTargetOption[]>;

export interface KpiTargetSources {
  catalog: ReadonlyArray<{ code: string; name: string; category: string }>;
  library: ReadonlyArray<{ id: string; label: string }>;
  colours: ReadonlyArray<{ fabricId: string; colourId: string; label: string }>;
  savedNames: ReadonlyArray<FabricSeriesName>;
  specials: ReadonlyArray<{ code: string; label: string; active: boolean }>;
}

const CATEGORY_LABEL: Record<string, string> = {
  SOFA: 'Sofa',
  BEDFRAME: 'Bedframe',
  MATTRESS: 'Mattress',
  ACCESSORY: 'Accessory',
  FABRIC_ACCESSORY: 'Sofa accessory',
};

/** "FABRIC_ACCESSORY" → "Sofa accessory"; an unknown category reads as itself, tidied. */
export const categoryLabel = (code: string): string =>
  CATEGORY_LABEL[code] ?? (code.charAt(0) + code.slice(1).toLowerCase()).replace(/_/g, ' ');

/** "EM", "MONZA-HL, MONZA-FL", "MONZA-HL, MONZA-FL +6 more". */
export const codesSummary = (codes: readonly string[]): string =>
  codes.length <= 3 ? codes.join(', ') : `${codes.slice(0, 2).join(', ')} +${codes.length - 2} more`;

const byLabel = (a: KpiTargetOption, b: KpiTargetOption) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

const haystack = (...parts: Array<string | null | undefined>) =>
  parts.filter(Boolean).join(' ').toLowerCase();

export function buildKpiTargetOptions(src: KpiTargetSources): KpiTargetOptions {
  /* SERVICE lines are never KPI units (commission-kpi-units.ts drops them), so
     a rule on one could never fire — it is not offered. */
  const goods = src.catalog.filter((p) => p.category !== 'SERVICE');

  const product = goods
    .map((p): KpiTargetOption => ({
      flagType: 'product', ref: p.code, refs: [p.code],
      label: p.name || p.code,
      detail: p.name ? p.code : null,
      search: haystack(p.name, p.code),
    }))
    .sort(byLabel);

  const category = [...new Set(goods.map((p) => p.category))]
    .map((code): KpiTargetOption => ({
      flagType: 'category', ref: code, refs: [code],
      label: categoryLabel(code), detail: null, search: haystack(categoryLabel(code), code),
    }))
    .sort(byLabel);

  const fabric = groupFabricPricingSeries([...src.library], [...src.colours], [...src.savedNames])
    .map((s): KpiTargetOption => {
      const refs = s.fabrics.map((f) => f.id);
      const colourCount = src.colours.filter((c) => refs.includes(c.fabricId)).length;
      const colours = colourCount > 0 ? ` · ${colourCount} colour${colourCount === 1 ? '' : 's'}` : '';
      return {
        flagType: 'fabric',
        ref: refs.length === 1 ? refs[0]! : s.id,
        refs,
        label: s.label,
        detail: `${codesSummary(refs)}${colours}`,
        search: haystack(s.label, ...refs),
      };
    })
    .sort(byLabel);

  const special = src.specials
    .filter((s) => s.active)
    .map((s): KpiTargetOption => ({
      flagType: 'special', ref: s.code, refs: [s.code],
      label: s.label || s.code,
      detail: s.label && s.label !== s.code ? s.code : null,
      search: haystack(s.label, s.code),
    }))
    .sort(byLabel);

  return { product, category, fabric, special };
}

export interface KpiRuleView {
  /** What to call the rule today. */
  name: string;
  /** The codes behind it, or a note that it covers only part of a series. */
  detail: string | null;
  /** Refs the live catalogue / fabric library no longer offers. */
  missing: string[];
  /** ok = every ref is offered · partial = some are not · missing = none are. */
  state: 'ok' | 'partial' | 'missing';
}

type RuleLike = { flagType: HrFlagType; ref: string; refs?: string[]; label?: string };

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Name a rule from what its refs belong to now — see the header. */
export function describeKpiRule(rule: RuleLike, options: KpiTargetOptions): KpiRuleView {
  const refs = kpiRefsOf(rule);
  const matched = options[rule.flagType].filter((o) => o.refs.some((r) => refs.includes(r)));
  const offered = new Set(matched.flatMap((o) => o.refs));
  const missing = refs.filter((r) => !offered.has(r));

  if (matched.length === 0) {
    const name = rule.label?.trim() || rule.ref;
    const codes = codesSummary(refs);
    return { name, detail: codes === name ? null : codes, missing, state: 'missing' };
  }

  const name = [...new Set(matched.map((o) => o.label))].join(' / ');
  let detail: string | null;
  if (matched.length === 1 && sameSet(matched[0]!.refs, refs)) {
    detail = matched[0]!.detail;
  } else if (matched.length === 1 && refs.every((r) => matched[0]!.refs.includes(r))) {
    // A rule made on one library id of what is now a wider series.
    detail = `Only ${codesSummary(refs)}, not the whole series`;
  } else {
    detail = codesSummary(refs);
  }
  return { name, detail, missing, state: missing.length > 0 ? 'partial' : 'ok' };
}

/** The ACTIVE rule that already pays on any of this option's refs — a second
 *  one would pay the same units twice, since rules of one type stack. */
export function ruleCovering<R extends RuleLike & { active: boolean; id: string }>(
  option: Pick<KpiTargetOption, 'flagType' | 'refs'>,
  rules: readonly R[],
  except?: string,
): R | null {
  return rules.find((r) =>
    r.active && r.id !== except && r.flagType === option.flagType
    && kpiRefsOf(r).some((ref) => option.refs.includes(ref))) ?? null;
}
