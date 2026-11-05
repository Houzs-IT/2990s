// ----------------------------------------------------------------------------
// Every option list the Marketing forms offer, from the SAME sources a Sales
// Order line reads — the design's rule ("same options as a Sales Order line").
// The prototype hard-coded sample lists (four showrooms, three fabric series,
// 2"/4"/6" legs…); each one is replaced by its live source:
//
//   showrooms          → NOT here: the Marketing section keeps its own list
//                        (owner 2026-10-09, migration 0218) and it arrives
//                        with the rest of its state (lib/marketing-api.ts)
//   models + photos    → the POS catalogue (/pos-pools/mfg-catalog)
//   fabric / colour    → the fabric library + colours
//   legs, seat, divan,
//   sizes, compartments→ the master Maintenance config
//
// Values are stored as the human-readable text the screens print ('4"',
// 'No leg', 'AM275', 'AM275-05 BROWN', 'Queen'): a display record is read by
// people, and the prototype stores them the same way.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { maintActiveValues } from '@2990s/shared';
import { normalizeCompartmentCode, representativeArtCode } from '@2990s/shared/sofa-build';
import {
  classifyCompartmentCode, fetchMfgCatalog, resolveCompartmentPhoto, resolvePhotoUrl, useFabricColours, useFabricLibrary,
  type MfgAllowedOptions, type MfgCatalogApiRow, type SofaCustomizerData,
} from '../../lib/queries';
import { useMaintenanceConfig } from '../../lib/products/mfg-products-queries';
import {
  DEFAULT_ARM_WIDTH_CM, guessAccessoryRole, readAccessoryOnSofa, readAccessoryPlacement, type SofaAccessoryOption,
} from '../../lib/sofa-accessories';
import { sizeName, type DisplayType } from './marketing-model';

export interface ModelOption {
  id: string;
  name: string;
  code: string;
  type: DisplayType;
  photoUrl: string | null;
  /** Size codes this Model is sold in (K / Q / S / SS …). */
  sizeCodes: string[];
  allowed: MfgAllowedOptions | null;
}

export interface FabricSeriesOption { id: string; label: string }
export interface ColourOption { code: string; label: string; seriesId: string }

/* ── formatting ─────────────────────────────────────────────────────────── */

/** Maintenance stores bare inches ('4', '28') and 'No Leg'; the screens print
 *  '4"' and 'No leg' as the design does. Anything else passes through. */
export const inchOption = (v: string): string => {
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return `${t}"`;
  if (/^no\s*-?\s*legs?$/i.test(t)) return 'No leg';
  return t;
};

const SIZE_ORDER = ['S', 'SS', 'Q', 'K', 'SK', 'SP'];
const bySizeOrder = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase());
  const ib = SIZE_ORDER.indexOf(b.toUpperCase());
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

const TYPE_OF_CATEGORY: Record<string, DisplayType | undefined> = {
  SOFA: 'sofa', MATTRESS: 'mattress', BEDFRAME: 'bedframe', ACCESSORY: 'accessory',
};

/** The short code a display card prints beside the name: 'SOFA ANNSA',
 *  '2990 AKKA-FIRM MATT', 'ARIA'. */
const displayCode = (category: string, leadCode: string, modelCode: string): string => {
  if (category === 'SOFA') return `SOFA ${modelCode}`;
  return leadCode.replace(/\s*-?\s*\([^()]+\)\s*$/, '').trim() || modelCode;
};

function modelsFromCatalog(rows: MfgCatalogApiRow[]): Record<DisplayType, ModelOption[]> {
  const byModel = new Map<string, ModelOption>();
  for (const r of rows) {
    const type = TYPE_OF_CATEGORY[r.category];
    const m = r.product_models;
    if (!type || !r.model_id || !m || m.active === false) continue;
    let opt = byModel.get(r.model_id);
    if (!opt) {
      opt = {
        id: r.model_id, name: m.name, code: displayCode(r.category, r.code, m.model_code), type,
        photoUrl: resolvePhotoUrl(m.photo_url), sizeCodes: [], allowed: m.allowed_options ?? null,
      };
      byModel.set(r.model_id, opt);
    }
    if (r.size_code && !opt.sizeCodes.includes(r.size_code)) opt.sizeCodes.push(r.size_code);
  }
  const out: Record<DisplayType, ModelOption[]> = { sofa: [], mattress: [], bedframe: [], accessory: [] };
  for (const o of byModel.values()) {
    o.sizeCodes.sort(bySizeOrder);
    out[o.type].push(o);
  }
  for (const k of Object.keys(out) as DisplayType[]) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Every Sofa Accessory the tablet would put on a sofa (Custom build), read as
 *  useSofaCustomizer reads a Model's ticked ones (lib/queries.ts): an active
 *  SKU of an active Model left "On the sofa". All of them, not one Model's
 *  list — a new product has no Model to narrow it, like the compartment pool. */
export function sofaAccessoriesFromCatalog(rows: MfgCatalogApiRow[]): SofaAccessoryOption[] {
  const byModel = new Map<string, SofaAccessoryOption>();
  for (const r of rows) {
    const m = r.product_models;
    if (r.category !== 'FABRIC_ACCESSORY' || !m || m.active === false || r.status !== 'ACTIVE' || r.pos_active === false) continue;
    if (!readAccessoryOnSofa(m.allowed_options) || byModel.has(m.id)) continue;
    const placement = readAccessoryPlacement(m.allowed_options);
    byModel.set(m.id, {
      modelId: m.id, productId: r.id, code: r.code, name: r.name, priceSen: r.sell_price_sen,
      role: placement?.role ?? guessAccessoryRole(r.name, r.code),
      armWidthCm: placement?.armWidthCm ?? DEFAULT_ARM_WIDTH_CM,
    });
  }
  return [...byModel.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/* ── the hook ───────────────────────────────────────────────────────────── */

export interface MarketingOptions {
  isLoading: boolean;
  models: Record<DisplayType, ModelOption[]>;
  fabricSeries: FabricSeriesOption[];
  colours: ColourOption[];
  sofaLegs: string[];
  bedLegs: string[];
  seats: string[];
  divans: string[];
  mattressSizes: string[];
  bedframeSizes: string[];
  moduleLabel: (code: string) => string | null;
  /** The master compartment pool in the shape the POS Custom build takes a
   *  Model's ticked compartments (its `modelCustomizer`), resolved the same
   *  way — Maintenance photo and description per code — so the Marketing
   *  canvas draws the same art. Every active compartment: a new product has
   *  no Model to narrow it. No prices: Marketing lays out, it does not sell. */
  sofaPool: SofaCustomizerData;
  /** The pool's Sofa Accessories by accessory Model id, so a preview can draw
   *  the pieces placed on a laid-out sofa. */
  sofaAccessoryById: ReadonlyMap<string, SofaAccessoryOption>;
  /** Whether the pool has loaded — the canvas drops placed pieces it has no
   *  accessory for, so it must not tidy them before the list arrives. */
  sofaPoolState: 'pending' | 'error' | 'ready';
  /** The art a compartment draws with, for previews of a laid-out sofa: the
   *  pool's Maintenance image, else the bundled module art. */
  moduleArt: (code: string) => string;
}

// Nothing is "Needed to order" in Marketing's builder: it lays out, it does not sell.
const EMPTY_POOL: Omit<SofaCustomizerData, 'compartments' | 'accessories'> = {
  sellingRows: [], sizes: [], legHeights: [], specials: [], fabricIds: [], accessoriesNeeded: [], modelId: '', modelName: '', modelCode: '',
};

export function useMarketingOptions(): MarketingOptions {
  const catalog = useQuery({
    queryKey: ['marketing', 'catalog'],
    staleTime: 60_000,
    queryFn: () => fetchMfgCatalog(),
  });
  const fabrics = useFabricLibrary();
  const colours = useFabricColours();
  const maint = useMaintenanceConfig('master');

  return useMemo<MarketingOptions>(() => {
    const cfg = (maint.data?.data ?? {}) as unknown as Record<string, unknown>;
    const values = (key: string) => maintActiveValues((cfg[key] ?? []) as Parameters<typeof maintActiveValues>[0]);
    const priced = (key: string) =>
      ((cfg[key] ?? []) as Array<{ value: string; active?: boolean }>)
        .filter((o) => o.active !== false)
        .map((o) => o.value);
    const meta = (cfg.sofaCompartmentMeta ?? {}) as Record<string, { description?: string; imageKey?: string }>;
    const pool = values('sofaCompartments');

    // The selling configurator's per-Model resolution (lib/queries.ts,
    // useSofaCustomizer), applied to the whole pool.
    const compartments = pool.map((code) => {
      const m = meta[code] ?? {};
      return {
        code,
        normalizedCode: normalizeCompartmentCode(code),
        label: m.description ?? code,
        priceSen: 0,
        imageUrl: resolveCompartmentPhoto(code, m.imageKey ?? `sofa-modules/${representativeArtCode(code)}.svg`),
        group: classifyCompartmentCode(code),
      };
    });
    const artByCode = new Map(compartments.map((c) => [c.normalizedCode, c.imageUrl] as const));
    const accessories = sofaAccessoriesFromCatalog(catalog.data ?? []);
    const moduleArt = (code: string) =>
      artByCode.get(normalizeCompartmentCode(code)) ?? `/sofa-modules/${representativeArtCode(code)}.png`;

    return {
      isLoading: catalog.isLoading || fabrics.isLoading || colours.isLoading || maint.isLoading,
      models: modelsFromCatalog(catalog.data ?? []),
      fabricSeries: (fabrics.data ?? []).map((f) => ({ id: f.id, label: f.label })),
      colours: (colours.data ?? []).map((c) => ({ code: c.colourId, label: c.label || c.colourId, seriesId: c.fabricId })),
      sofaLegs: priced('sofaLegHeights').map(inchOption),
      bedLegs: priced('legHeights').map(inchOption),
      seats: values('sofaSizes').map(inchOption),
      divans: priced('divanHeights').map(inchOption),
      mattressSizes: values('mattressSizes').sort(bySizeOrder).map(sizeName),
      bedframeSizes: values('bedframeSizes').sort(bySizeOrder).map(sizeName),
      moduleLabel: (code: string) => meta[code]?.description ?? null,
      sofaPool: { ...EMPTY_POOL, compartments, accessories },
      sofaAccessoryById: new Map(accessories.map((o) => [o.modelId, o] as const)),
      sofaPoolState: catalog.isError || maint.isError ? 'error' : catalog.data && maint.data ? 'ready' : 'pending',
      moduleArt,
    };
  }, [catalog.data, catalog.isLoading, catalog.isError, maint.isError, fabrics.data, fabrics.isLoading, colours.data, colours.isLoading, maint.data, maint.isLoading]);
}

/* ── per-Model narrowing (the Sales Order line's allowed-options rule) ──── */

/** The fabric series and colours a Model may be sold in. An empty allowed list
 *  is "no restriction", exactly as the server treats it. */
export function fabricsFor(opts: MarketingOptions, allowed: MfgAllowedOptions | null | undefined) {
  const codes = allowed?.fabrics ?? [];
  if (!codes.length) return { series: opts.fabricSeries, colours: opts.colours };
  const set = new Set(codes);
  const colours = opts.colours.filter((c) => set.has(c.code));
  const seriesIds = new Set(colours.map((c) => c.seriesId));
  const series = opts.fabricSeries.filter((s) => seriesIds.has(s.id));
  return series.length ? { series, colours } : { series: opts.fabricSeries, colours: opts.colours };
}

/** A Model's ticked list, formatted, or the master pool when it ticks none. */
export function allowedOr(pool: string[], allowed: string[] | undefined): string[] {
  const picked = (allowed ?? []).map(inchOption);
  return picked.length ? picked : pool;
}

/** Colour labels of one series (by the series LABEL the form stores). */
export function coloursOf(opts: { fabricSeries: FabricSeriesOption[]; colours: ColourOption[] }, seriesLabel: string): string[] {
  const s = opts.fabricSeries.find((x) => x.label === seriesLabel);
  if (!s) return [];
  return opts.colours.filter((c) => c.seriesId === s.id).map((c) => c.label);
}

/** The design's preferred default when the live list has it, else the first. */
export const preferred = (list: string[], want: string): string => (list.includes(want) ? want : list[0] ?? '');

/** A saved request keeps the text it was saved with, but the live list can
 *  drop it (a fabric series renamed or retired in the library). Without the
 *  stored value among the options its select would show "—" while the field
 *  still counts as filled, so it is appended. */
export const withValue = (list: string[], value: string): string[] =>
  value && !list.includes(value) ? [...list, value] : list;
