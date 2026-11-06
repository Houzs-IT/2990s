import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SofaComboRule } from '../../lib/products/sofa-combos-queries';
import type { MfgProductRow } from '../../lib/products/mfg-products-queries';

// Owner 2026-11-06: the Combo Pricing page names each Model by its Modular name
// (7218 reads as TAMMAN); combos stay keyed by the base_model code.
const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  filters: [] as Array<{ baseModel?: string; customerId?: string | null }>,
  combos: [
    { id: 'tamman', baseModel: '7218', modules: [['2A(LHF)'], ['L(RHF)']], tier: 'PRICE_1',
      customerId: null, pricesByHeight: {}, sellingPricesByHeight: { 26: 399000 }, label: null,
      effectiveFrom: '2026-11-05', deletedAt: null, notes: '', createdAt: '', updatedAt: '', createdBy: null },
    { id: 'annsa', baseModel: 'Annsa', modules: [['2NA']], tier: 'PRICE_1',
      customerId: null, pricesByHeight: {}, sellingPricesByHeight: {}, label: null,
      effectiveFrom: '2026-11-05', deletedAt: null, notes: '', createdAt: '', updatedAt: '', createdBy: null },
  ] as SofaComboRule[],
  products: [
    { base_model: '7218', model_name: 'TAMMAN' },
    { base_model: '7218', model_name: 'TAMMAN' },
    { base_model: '2378', model_name: 'BOONTAL' },
    { base_model: 'Annsa', model_name: 'Annsa' },
    { base_model: '9001', model_name: null },
  ] as MfgProductRow[],
}));

vi.mock('../../lib/products/sofa-combos-queries', () => ({
  useSofaCombos: (filters: { baseModel?: string; customerId?: string | null }) => {
    mocks.filters.push(filters);
    return {
      data: mocks.combos.filter((c) => !filters.baseModel || c.baseModel === filters.baseModel),
      isLoading: false,
    };
  },
  useCreateSofaCombo: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateSofaCombo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSofaCombo: () => ({ mutate: vi.fn() }),
  useSofaComboHistory: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../lib/products/mfg-products-queries', () => ({
  useMfgProducts: () => ({ data: mocks.products }),
  useMaintenanceConfig: () => ({ data: undefined }),
}));

import { SofaComboTab } from './SofaComboTab';

afterEach(cleanup);
beforeEach(() => { mocks.filters = []; vi.clearAllMocks(); });

describe('SofaComboTab model names', () => {
  it('lists Models by name, filters by their code, and names the combo cards', () => {
    render(<SofaComboTab mode="full" />);
    const filter = screen.getByRole('combobox', { name: 'Model' });
    const options = within(filter).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => o.textContent)).toEqual(['All models', '9001', 'Annsa', 'BOONTAL', 'TAMMAN']);
    expect(options.map((o) => o.value)).toEqual(['', '9001', 'Annsa', '2378', '7218']);

    expect(screen.getByRole('heading', { name: 'TAMMAN (1 combo)' })).toBeInTheDocument();
    expect(screen.queryByText('7218')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: '7218' } });
    expect(mocks.filters.at(-1)).toEqual({ baseModel: '7218', customerId: null });

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('TAMMAN · 2A(LHF) + L(RHF) · PRICE_1')).toBeInTheDocument();
  });

  it('creates a combo for the Model picked by name under its code', () => {
    render(<SofaComboTab mode="full" />);
    fireEvent.click(screen.getByRole('button', { name: 'New Combo' }));
    fireEvent.change(screen.getByDisplayValue('Choose a model'), { target: { value: '7218' } });
    // The Modules field is a <label>, which names its first button after itself.
    fireEvent.click(screen.getByText('Add Module'));
    fireEvent.click(screen.getByText('2A(LHF)', { selector: 'button' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create combo' }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ baseModel: '7218', modules: [['2A(LHF)']] }));
  });
});
