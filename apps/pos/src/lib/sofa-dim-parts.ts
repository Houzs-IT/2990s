import { cellBbox, type Cell, type Depth } from '@2990s/shared';

/* YH 2026-11-06: a sofa's length and depth "x + y" are worked out from its
   components, never typed. 188 × 95 beside 110 × 165 reads 188 + 110 = 298
   long and 95 + 70 = 165 deep: every edge of a module along that side starts
   a part. */

/** Parts of [min, max] cut at every span edge inside it, in whole cm; null
 *  when there is only one part. */
export function axisParts(spans: ReadonlyArray<readonly [number, number]>, min: number, max: number): number[] | null {
  const lo = Math.round(min), hi = Math.round(max);
  const cuts = new Set([lo, hi]);
  for (const [a, b] of spans) for (const e of [a, b]) {
    const r = Math.round(e);
    if (r > lo && r < hi) cuts.add(r);
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const parts = edges.slice(1).map((e, i) => e - edges[i]!);
  return parts.length >= 2 ? parts : null;
}

/** '188 + 110 = 298', or the whole number when it is one part. */
export const partsLabel = (parts: number[] | null, total: number): string =>
  parts ? `${parts.join(' + ')} = ${parts.reduce((a, x) => a + x, 0)}` : String(Math.round(total));

/** The width and depth labels of a layout drawn inside `box` (the drawn
 *  bounds, arms included: an arm outside the modules is a part of its own). */
export function layoutDimParts(cells: Cell[], depth: Depth, box: { x: number; y: number; w: number; h: number }) {
  const rects = cells.flatMap((c) => { const b = cellBbox(c, depth); return b ? [b] : []; });
  return {
    w: partsLabel(axisParts(rects.map((r) => [r.x, r.x + r.w] as const), box.x, box.x + box.w), box.w),
    h: partsLabel(axisParts(rects.map((r) => [r.y, r.y + r.h] as const), box.y, box.y + box.h), box.h),
  };
}
