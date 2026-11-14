import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CommissionKpiItem } from '../../lib/commission-api';
import { buildKpiTargetOptions } from '../../lib/kpi-rule-targets';
import type { KpiTargets } from '../../lib/kpi-rule-targets-queries';

afterEach(cleanup);

/* The data layer is mocked; the naming rules (kpi-rule-targets) and the form
   rules (kpi-rule-form) run for real. What this pins is what the owner asked
   for on 2026-11-15: series NAMES instead of codes, a rule whose codes are
   gone said out loud, and quantity tiers that reach the API as typed. */

const api = vi.hoisted(() => ({
  items: [] as CommissionKpiItem[],
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  remove: vi.fn(async () => ({})),
}));
vi.mock('../../lib/commission-api', () => ({
  useCommissionKpiItems: () => ({ data: api.items, isLoading: false, error: null }),
  useCreateCommissionKpiItem: () => ({ mutateAsync: api.create, isPending: false }),
  useUpdateCommissionKpiItem: () => ({ mutateAsync: api.update, isPending: false }),
  useDeleteCommissionKpiItem: () => ({ mutateAsync: api.remove, isPending: false }),
}));

const lib = (id: string) => ({ id, label: id });
const col = (fabricId: string, colourId: string) => ({ fabricId, colourId, label: colourId });
const TARGETS: KpiTargets = {
  options: buildKpiTargetOptions({
    catalog: [{ code: 'ANNSA-3S', name: 'ANNSA 3 Seater', category: 'SOFA' }],
    library: ['EM', 'BROWNIE', 'HG1313', 'MONZA-HL', 'MONZA-HL-B01'].map(lib),
    colours: [
      col('EM', 'EM-01'), col('EM', 'EM-02'), col('BROWNIE', 'BROWNIE-01'),
      col('HG1313', 'HG1313-01'), col('MONZA-HL', 'MONZA-HL-01'), col('MONZA-HL-B01', 'MONZA-HL-B01'),
    ],
    savedNames: [
      { fabric_code: 'EM-01', series: 'EMBRACE' }, { fabric_code: 'EM-02', series: 'EMBRACE' },
      { fabric_code: 'BROWNIE-01', series: 'HOMELY' }, { fabric_code: 'HG1313-01', series: 'BELONG' },
    ],
    specials: [{ code: 'Latex Seat', label: 'Latex Seat', active: true }],
  }),
  isLoading: false,
  ready: { product: true, category: true, fabric: true, special: true },
  namesFailed: false,
};
vi.mock('../../lib/kpi-rule-targets-queries', () => ({ useKpiTargets: () => TARGETS }));

import { SetupKpiItems } from './SetupKpiItems';

const rule = (over: Partial<CommissionKpiItem>): CommissionKpiItem => ({
  id: 'r', flagType: 'fabric', ref: 'X', refs: [], label: '', bonusCenti: 5_000, qtyTiers: [],
  countsAsRevenue: false, effectiveFrom: null, active: true, ...over,
});

beforeEach(() => {
  api.create.mockClear(); api.update.mockClear(); api.remove.mockClear();
  api.items = [
    rule({ id: 'brownie', ref: 'BROWNIE', label: 'BROWNIE', bonusCenti: 25_000, effectiveFrom: '2026-10-01' }),
    rule({ id: 'kn01', ref: 'KN01', label: 'KN01', bonusCenti: 12_500, effectiveFrom: '2026-10-01' }),
    rule({ id: 'embrace', ref: 'EM', refs: ['EM'], label: 'EMBRACE', bonusCenti: 12_500 }),
    rule({
      id: 'monza', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-HL-B01'], label: 'MONZA', bonusCenti: 4_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
    }),
    rule({ id: 'latex', flagType: 'special', ref: 'Latex Seat', label: 'Latex Seat' }),
  ];
});

const rowOf = (name: string) => screen.getByText(name, { selector: 'span' }).closest('tr')!;

describe('the rule list', () => {
  it('names rules by series, never by the library code', () => {
    render(<SetupKpiItems canManage />);
    expect(screen.getByText('HOMELY')).toBeInTheDocument();
    expect(screen.getByText('EMBRACE', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('MONZA', { selector: 'span' })).toBeInTheDocument();
  });

  it('says out loud when a rule\'s codes are gone — the KN rules after the rename', () => {
    render(<SetupKpiItems canManage />);
    expect(within(rowOf('KN01')).getByText('Not in the fabric library')).toBeInTheDocument();
    expect(within(rowOf('EMBRACE')).queryByText(/Not in/)).not.toBeInTheDocument();
  });

  it('shows the quantity tiers under the base amount', () => {
    render(<SetupKpiItems canManage />);
    const monza = rowOf('MONZA');
    expect(within(monza).getByText('RM 40.00 each')).toBeInTheDocument();
    expect(within(monza).getByText(/more than 5 sold/)).toHaveTextContent('RM 50.00');
    expect(within(monza).getByText(/more than 10 sold/)).toHaveTextContent('RM 60.00');
  });

  it('groups by type, saying the type once', () => {
    render(<SetupKpiItems canManage />);
    expect(screen.getAllByRole('columnheader', { name: /Fabric series/ })).toHaveLength(1);
    expect(screen.getAllByRole('columnheader', { name: /Special add-on/ })).toHaveLength(1);
  });

  it('read-only holders see the figures and no controls', () => {
    render(<SetupKpiItems canManage={false} />);
    expect(screen.queryByRole('button', { name: /New KPI item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByText('HOMELY')).toBeInTheDocument();
  });
});

describe('a new KPI item', () => {
  it('picks a series by name and saves the owner\'s ladder as typed', async () => {
    render(<SetupKpiItems canManage />);
    fireEvent.click(screen.getByRole('button', { name: /New KPI item/ }));
    const dialog = screen.getByRole('dialog', { name: 'New KPI item' });

    // the picker lists names; the codes are only detail
    const list = within(dialog).getByRole('radiogroup', { name: 'Applies to' });
    expect(within(list).getByText('BELONG')).toBeInTheDocument();
    expect(within(list).queryByText('HG1313')).not.toBeInTheDocument();
    // a series that already has an active rule cannot be picked twice
    expect(within(list).getByRole('radio', { name: /EMBRACE/ })).toBeDisabled();

    fireEvent.click(within(list).getByRole('radio', { name: /BELONG/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /For each unit sold/ }), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add a tier/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Tier 1: amount/ }), { target: { value: '50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add a tier/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Tier 2: amount/ }), { target: { value: '60' } });

    // the worked examples come from the engine's own arithmetic
    expect(within(dialog).getByText('11 × RM 60.00')).toBeInTheDocument();
    expect(within(dialog).getByText('RM 660.00')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save KPI item' }));
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({
      flagType: 'fabric', ref: 'HG1313', refs: ['HG1313'], label: 'BELONG',
      bonusCenti: 4_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
      countsAsRevenue: false,
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
  });

  it('refuses a tier that pays less, and saves nothing', async () => {
    render(<SetupKpiItems canManage />);
    fireEvent.click(screen.getByRole('button', { name: /New KPI item/ }));
    const dialog = screen.getByRole('dialog', { name: 'New KPI item' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /BELONG/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /For each unit sold/ }), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add a tier/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Tier 1: amount/ }), { target: { value: '5' } });
    expect(within(dialog).getByText(/must pay more/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save KPI item' }));
    expect(api.create).not.toHaveBeenCalled();
  });

  it('asks for a target before saving', () => {
    render(<SetupKpiItems canManage />);
    fireEvent.click(screen.getByRole('button', { name: /New KPI item/ }));
    const dialog = screen.getByRole('dialog', { name: 'New KPI item' });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /For each unit sold/ }), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save KPI item' }));
    expect(within(dialog).getByText(/Pick what this KPI item pays on/)).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe('editing a rule', () => {
  it('keeps the target fixed and saves amounts, tiers and start date', async () => {
    render(<SetupKpiItems canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HOMELY' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit KPI item' });
    expect(within(dialog).queryByRole('radiogroup', { name: 'Applies to' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('HOMELY')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /For each unit sold/ }), { target: { value: '200' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add a tier/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Tier 1: amount/ }), { target: { value: '300' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith({
      id: 'brownie', bonusCenti: 20_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 30_000 }],
      countsAsRevenue: false, effectiveFrom: '2026-10-01',
    });
  });

  it('turns a rule off from the drawer', async () => {
    render(<SetupKpiItems canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Latex Seat' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Turn off/ }));
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith({ id: 'latex', active: false }));
  });
});
