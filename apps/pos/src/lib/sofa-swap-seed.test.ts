import { describe, expect, it, vi } from 'vitest';
import { groupSofas, moduleFootprint, findModule } from '@2990s/shared';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { seedSwapCells, clampDepth, swapDepthOf, planSwapSeed, reflowOnDepthChange } from './sofa-swap-seed';

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

describe('planSwapSeed — Model does not offer the saved depth (2990-0032)', () => {
  const saved = [
    { moduleId: 'L(LHF)', x: 127.74, y: 192.5, rot: 0 },
    { moduleId: '2A(RHF)', x: 237.74, y: 192.5, rot: 0 },
  ];
  it('lands on an offered depth and draws the pieces flush there', () => {
    const plan = planSwapSeed(saved, '30', ['24', '28'], id)!;
    expect(plan.depth).toBe('24');
    expect(groupSofas(plan.cells, '24')).toHaveLength(1);
    const [a, b] = [...plan.cells].sort((p, q) => p.x - q.x);
    expect(b!.x - a!.x).toBe(moduleFootprint(findModule('L(LHF)')!, 0, '24').w);
  });
  it('keeps the saved depth when the Model offers it', () => {
    expect(planSwapSeed(saved, '30', ['24', '30'], id)!.depth).toBe('30');
  });
});

describe('2990-SO-2611-002 survives depth switches (2990-0032)', () => {
  const saved = [
    { moduleId: 'L(LHF)', x: 127.74, y: 192.5, rot: 0 },
    { moduleId: '2A(RHF)', x: 237.74, y: 192.5, rot: 0 },
  ];
  it('stays joined 24 -> 30 -> 24 and keeps cell ids', () => {
    // SO-002 was last saved at 24 (95 apart), so Change product opens at 24
    const at24 = planSwapSeed(saved.map((c, i) => ({ ...c, x: 127.74 + i * 95 })), '24', ['24', '28', '30'], id)!.cells;
    expect(groupSofas(at24, '24')).toHaveLength(1);
    expect(groupSofas(at24, '30')).toHaveLength(2); // what the tab click used to leave behind
    const at30 = reflowOnDepthChange(at24, '24', '30');
    expect(groupSofas(at30, '30')).toHaveLength(1);
    expect(at30.map((c) => c.id).sort()).toEqual(at24.map((c) => c.id).sort());
    expect(groupSofas(reflowOnDepthChange(at30, '30', '24'), '24')).toHaveLength(1);
  });
  it('leaves a layout alone when the switch breaks nothing', () => {
    const one = [{ id: 'a', moduleId: '2A(LHF)', x: 5, y: 5, rot: 0 }] as never;
    expect(reflowOnDepthChange(one, '30', '24')).toBe(one);
  });
});
