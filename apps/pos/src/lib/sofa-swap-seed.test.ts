import { describe, expect, it, vi } from 'vitest';
import { groupSofas, moduleFootprint, findModule } from '@2990s/shared';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { seedSwapCells, clampDepth, swapDepthOf } from './sofa-swap-seed';

let n = 0;
const id = () => `c${n++}`;

describe('seedSwapCells (2990-0032)', () => {
  it('rejoins a layout whose saved gap would show on the canvas', () => {
    const w = moduleFootprint(findModule('2A(LHF)')!, 0, '24').w;
    // chaise saved 40cm away from the 2-seater: two separate pieces
    const gapped = [
      { moduleId: '2A(LHF)', x: 0, y: 0, rot: 0 },
      { moduleId: 'L(RHF)', x: w + 40, y: 0, rot: 0 },
    ];
    const out = seedSwapCells(gapped, '24', id);
    expect(groupSofas(out, '24')).toHaveLength(1);
  });

  it('reads a 28" build at 28" and keeps it joined', () => {
    const w28 = moduleFootprint(findModule('2A(LHF)')!, 0, '28').w;
    const flush = [
      { moduleId: '2A(LHF)', x: 0, y: 0, rot: 0 },
      { moduleId: 'L(RHF)', x: w28, y: 0, rot: 0 },
    ];
    const out = seedSwapCells(flush, '28', id);
    expect(groupSofas(out, '28')).toHaveLength(1);
    expect(out[1]!.x - out[0]!.x).toBe(w28);
  });
});

describe('clampDepth (2990-0032)', () => {
  it('keeps the seeded 28" while the Model is still loading', () => {
    expect(clampDepth('28', ['24'], true)).toBe('28');
  });
  it('falls back to the smallest offered depth once loaded', () => {
    expect(clampDepth('28', ['24'], false)).toBe('24');
    expect(clampDepth('28', ['24', '28'], false)).toBe('28');
  });
});

describe('2990-SO-2611-002 (LOTTI L(LHF) + 2A(RHF), seat 30)', () => {
  const v = { x: 127.74, y: 192.5, rot: 0, seatHeight: '30' };
  const saved = [
    { moduleId: 'L(LHF)', x: 127.74, y: 192.5, rot: 0 },
    { moduleId: '2A(RHF)', x: 237.74, y: 192.5, rot: 0 },
  ];
  it('reads the seat depth from seatHeight when the line has no depth', () => {
    expect(swapDepthOf(v)).toBe('30');
    expect(swapDepthOf({ depth: '28', seatHeight: '30' })).toBe('28');
    expect(swapDepthOf({})).toBeUndefined();
  });
  it('keeps the saved layout as one sofa at that depth', () => {
    const out = seedSwapCells(saved, swapDepthOf(v)!, id);
    expect(groupSofas(out, '30')).toHaveLength(1);
    expect(out[1]!.x - out[0]!.x).toBe(110);
  });
});
