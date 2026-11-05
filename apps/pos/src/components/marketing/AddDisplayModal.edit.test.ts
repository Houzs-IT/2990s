import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { copiedAdd } from './AddDisplayModal';
import { displayCopyFrom, type DisplayItem, type SofaLayout } from './marketing-model';
import type { MarketingOptions } from './marketing-options';

/* YH 2026-11-05: Edit reopens a piece on the floor in the Add on display form,
   filled from what was saved on it. */

const item = (over: Partial<DisplayItem>): DisplayItem => ({
  id: 'd1', venueId: '107', type: 'bedframe', modelId: 'm1', name: 'NOVA', code: 'BF NOVA', photoUrl: null, isNew: false,
  fabric: 'Linen', colour: 'Sand', leg: '4"', seat: '', modules: [], size: 'King', height: '', divan: '10"', gap: '4', qty: 1,
  lengthCm: null, widthCm: null, sofaCategory: '', sofaFunction: '', sourceRequestId: null, photoAt: null, layout: null,
  remarks: '', dimsWidthCm: null, dimsDepthCm: null, ownPhotoAt: null, ...over,
});

const opts = {
  models: { sofa: [], mattress: [], accessory: [], bedframe: [{ id: 'm1', name: 'NOVA', code: 'BF NOVA', photoUrl: null }] },
} as unknown as MarketingOptions;

const editOf = (it: DisplayItem) => copiedAdd(opts, displayCopyFrom({ kind: 'display', item: it }));

describe('Edit display prefill', () => {
  it('picks the catalogue Model and every option the piece was saved with', () => {
    expect(editOf(item({}))).toEqual({
      type: 'bedframe', modelId: 'm1', size: 'King', height: '', fabric: 'Linen', colour: 'Sand', leg: '4"', seat: '',
      divan: '10"', gap: '4', modules: [], layout: null, accessories: null, qty: 1, product: null,
    });
  });

  it('keeps the name and code of a piece whose Model is not in the catalogue, and its sofa layout', () => {
    const layout: SofaLayout = [{ moduleId: '1S', x: 0, y: 0, rot: 0 }];
    const a = editOf(item({ type: 'sofa', modelId: 'gone', name: 'OLD', code: 'X1', modules: ['1S'], layout, seat: '28"', sourceRequestId: 'r1' }));
    expect(a).toMatchObject({ type: 'sofa', modelId: '', modules: ['1S'], layout, seat: '28"' });
    expect(a.product).toMatchObject({ modelId: 'gone', name: 'OLD', code: 'X1', sourceRequestId: 'r1' });
    expect(a.layout).not.toBe(layout);
  });

  it('brings back the accessory pieces placed on a sofa', () => {
    const layout: SofaLayout = [{ id: 'c1', moduleId: '1S', x: 0, y: 0, rot: 0 }];
    const accessories = [{ id: 'p1', modelId: 'acc-back', cellId: 'c1', slot: 0 }];
    expect(editOf(item({ type: 'sofa', modules: ['1S'], layout, accessories, seat: '28"' })).accessories).toEqual(accessories);
  });
});
