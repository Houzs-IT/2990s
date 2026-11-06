import { describe, expect, it } from 'vitest';
import { axisParts, partsLabel } from './sofa-dim-parts';
import { layoutAxisParts } from './sofa-dim-parts';
import { cellsBbox } from '@2990s/shared';
import { cellsFromComboModules } from './sofa-combo-cells';
import { lengthText, partsFor } from '../components/marketing/marketing-model';

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

describe('layoutAxisParts', () => {
  it('is empty for no cells', () => {
    expect(layoutAxisParts([], 95 as never, 'x')).toEqual([]);
    expect(layoutAxisParts([], 95 as never, 'y')).toEqual([]);
  });

  it('cuts an L-shape along both sides, each adding up to its box', () => {
    // A corner sofa, like Lotti: the depth has a part too (YH 2026-11-06).
    const cells = cellsFromComboModules([['1B(LHF)'], ['CNR'], ['2A(RHF)']], '24');
    const box = cellsBbox(cells, '24')!;
    const x = layoutAxisParts(cells, '24', 'x'), y = layoutAxisParts(cells, '24', 'y');
    expect(y.length).toBeGreaterThanOrEqual(2);
    expect(x.reduce((a, v) => a + v, 0)).toBe(Math.round(box.w));
    expect(y.reduce((a, v) => a + v, 0)).toBe(Math.round(box.h));
  });
});

describe('partsFor', () => {
  it('keeps typed parts only when they add up to the width', () => {
    expect(partsFor(['120', '100'], '220')).toEqual([120, 100]);
    expect(partsFor(['120', '90'], '220')).toBeNull();
    expect(partsFor(['220'], '220')).toBeNull();
    expect(lengthText(220, [120, 100], true)).toBe('120 + 100 = 220');
    expect(lengthText(220, [120, 100], false)).toBe('220');
  });
});
