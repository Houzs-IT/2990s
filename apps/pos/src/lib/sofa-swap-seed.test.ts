import { describe, expect, it, vi } from 'vitest';
import { groupSofas, moduleFootprint, findModule } from '@2990s/shared';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { seedSwapCells } from './sofa-swap-seed';

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
