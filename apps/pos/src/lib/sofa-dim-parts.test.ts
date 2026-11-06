import { describe, expect, it } from 'vitest';
import { axisParts, partsLabel } from './sofa-dim-parts';

describe('axisParts', () => {
  // YH's example: 188 × 95 beside 110 × 165, backs flush.
  const a = { x: 0, y: 0, w: 188, h: 95 };
  const b = { x: 188, y: 0, w: 110, h: 165 };

  it('cuts the length at each module edge: 188 + 110 = 298', () => {
    const p = axisParts([[a.x, a.x + a.w], [b.x, b.x + b.w]], 0, 298);
    expect(p).toEqual([188, 110]);
    expect(partsLabel(p, 298)).toBe('188 + 110 = 298');
  });

  it('cuts the depth where the shallower one ends: 95 + 70 = 165', () => {
    const p = axisParts([[a.y, a.y + a.h], [b.y, b.y + b.h]], 0, 165);
    expect(partsLabel(p, 165)).toBe('95 + 70 = 165');
  });

  it('splits a straight run per module', () => {
    expect(axisParts([[0, 95], [95, 165], [165, 260]], 0, 260)).toEqual([95, 70, 95]);
  });

  it('is one number when every module has the same depth', () => {
    const p = axisParts([[0, 95], [0, 95]], 0, 95);
    expect(p).toBeNull();
    expect(partsLabel(p, 95)).toBe('95');
  });

  it('gives an arm outside the modules its own part, and ignores sub-cm noise', () => {
    expect(axisParts([[15, 203.4]], 0, 218.6)).toEqual([15, 188, 16]);
  });
});
