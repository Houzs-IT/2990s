import { groupSofas, type Cell, type Depth } from '@2990s/shared';
import { cellsFromComboModules } from './sofa-combo-cells';
import { centerCellsInRoom } from '../pages/CustomBuilder';

export interface SwapCellIn { moduleId: string; x: number; y: number; rot: number }

/* "Change product → Same Model" re-opens a saved order's sofa on the canvas
   (2990-0032 / 0033). Module widths grow with seat depth, so the cells must be
   read at the depth they were laid out at — a 24" read of a 28" build leaves a
   gap. If the saved geometry still doesn't form one sofa (older orders, drift),
   fall back to the flush default row/L of the same modules, in saved order.
   Then centre in the room (pure translation). */
export const seedSwapCells = (cellsIn: SwapCellIn[], depth: Depth, newId: () => string): Cell[] => {
  let cells = cellsIn.map((c) => ({ id: newId(), moduleId: c.moduleId, x: c.x, y: c.y, rot: c.rot } as Cell));
  if (groupSofas(cells, depth).length > 1) {
    cells = cellsFromComboModules(cellsIn.map((c) => [c.moduleId]), depth).map((c) => ({ ...c, id: newId() }));
  }
  return centerCellsInRoom(cells, depth);
};

/* Keep the seat-depth tab within the Model's offered depths. While the Model is
   still loading, depthOptions is only the ['24'] placeholder: clamping then
   knocked a 28" Change-product seed back to 24", so the saved cells were
   re-read at the wrong width and drew apart (2990-0032). */
export const clampDepth = (active: Depth, options: Depth[], loading: boolean): Depth =>
  loading || options.includes(active) ? active : (options[0] ?? '24');

/* The SO stores a build's seat depth as variants.seatHeight (Backend canonical
   name); variants.depth is only there on some older lines. Reading `depth`
   alone gave undefined for 2990-SO-2611-002, so a 30" build was read at 24". */
export const swapDepthOf = (v: Record<string, unknown> | null | undefined): string | undefined => {
  const d = v?.depth ?? v?.seatHeight;
  return typeof d === 'string' && d ? d : undefined;
};
