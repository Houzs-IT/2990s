import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { sofaAccessoriesFromCatalog } from './marketing-options';
import type { MfgCatalogApiRow } from '../../lib/queries';

const row = (over: Partial<MfgCatalogApiRow> & { model?: Partial<NonNullable<MfgCatalogApiRow['product_models']>> | null }): MfgCatalogApiRow => {
  const { model, ...rest } = over;
  return {
    id: 'sku', code: 'BC06', name: 'BACK CUSHION 06', category: 'FABRIC_ACCESSORY', description: null, branding: null,
    size_label: null, size_code: null, sell_price_sen: 39950, pwp_price_sen: null, seat_height_prices: null,
    included_addons: null, base_model: null, model_id: 'm1', retail_product_id: null, status: 'ACTIVE', pos_active: true,
    product_models: model === null ? null : { id: 'm1', name: 'BACK CUSHION 06', model_code: 'BC06', photo_url: null, active: true, allowed_options: null, ...model },
    ...rest,
  };
};

describe('sofaAccessoriesFromCatalog', () => {
  it('keeps the active accessories that go on a sofa, one per Model, with their placement', () => {
    const out = sofaAccessoriesFromCatalog([
      row({}),
      row({ id: 'sku-dup' }),                                                            // same Model again
      row({ id: 'arm', code: 'AR01', name: 'ARM REST 01', model: { id: 'm2', allowed_options: { placement: { role: 'arm', armWidthCm: 18 } } as never } }),
      row({ id: 'own', model: { id: 'm3', allowed_options: { on_sofa: false } as never } }), // sold on its own
      row({ id: 'off', status: 'INACTIVE', model: { id: 'm4' } }),
      row({ id: 'hidden', pos_active: false, model: { id: 'm5' } }),
      row({ id: 'sofa', category: 'SOFA', model: { id: 'm6' } }),
    ]);
    expect(out.map((o) => [o.modelId, o.code, o.role, o.armWidthCm])).toEqual([
      ['m2', 'AR01', 'arm', 18],
      ['m1', 'BC06', 'back', 20],
    ]);
  });
});
