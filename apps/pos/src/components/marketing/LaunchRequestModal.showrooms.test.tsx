import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

/* The form's own logic is under test, not the network: the save is a spy that
   answers with one saved request for each showroom, as the API does. */
const save = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock('../../lib/marketing-api', async (original) => ({
  ...(await original<typeof import('../../lib/marketing-api')>()),
  useSaveRequest: () => save,
  useRequestPhoto: () => ({ data: null, isError: false }),
  useFetchRequestPhoto: () => vi.fn(),
}));

import { LaunchRequestModal } from './LaunchRequestModal';
import { blankRequest, destinationsOf, type DisplayItem, type LaunchRequest, type RequestStatus } from './marketing-model';
import type { MarketingOptions } from './marketing-options';

/* owner 2026-11-12: a new product can be sent to several showrooms at once. */

const SHOWROOMS = [
  { id: 'f', name: '2990s Flagship', area: 'Petaling Jaya' },
  { id: 'm', name: '2990s Mini', area: 'Kelana Jaya' },
  { id: 'm2', name: '2990s Mini (II)', area: 'Puchong' },
];
const F = '2990s Flagship — Petaling Jaya';
const M = '2990s Mini — Kelana Jaya';
const M2 = '2990s Mini (II) — Puchong';

const mattress = (id: string, venueId: string, name: string): DisplayItem => ({
  id, venueId, type: 'mattress', modelId: null, name, code: name, photoUrl: null, isNew: false, fabric: '', colour: '', leg: '', seat: '',
  modules: [], size: 'King', height: '12', divan: '', gap: '', qty: 1, lengthCm: null, widthCm: null, sofaCategory: '', sofaFunction: '',
  sourceRequestId: null, photoAt: null, layout: null, remarks: '', dimsWidthCm: null, dimsDepthCm: null, ownPhotoAt: null,
});
/** Two mattresses on the Flagship floor, one at Mini, none at Mini (II). */
const DISPLAYS = [mattress('f1', 'f', 'AKKA-FIRM'), mattress('f2', 'f', 'AKKA-SOFT'), mattress('m1', 'm', 'KETTA-SOFT')];

const opts = {
  fabricSeries: [], colours: [], sofaLegs: [], bedLegs: [], seats: [], divans: [], mattressSizes: ['Queen', 'King'], bedframeSizes: [],
  sofaAccessoryById: new Map(), moduleArt: () => '', moduleLabel: () => null,
} as unknown as MarketingOptions;

/** A mattress that has all it needs to be saved, bar where it goes. */
const draftOf = (over: Partial<LaunchRequest> = {}): LaunchRequest =>
  ({ ...blankRequest('Loo', 'Sales'), type: 'mattress', supplierCode: 'MW-118', ...over });

let latest: LaunchRequest | null = null;
const onSaved = vi.fn<(status: RequestStatus, count: number) => void>();

const Form = ({ initial }: { initial: LaunchRequest }) => {
  const [draft, setDraft] = useState<LaunchRequest | null>(initial);
  latest = draft;
  return draft ? (
    <LaunchRequestModal
      draft={draft} setDraft={setDraft} opts={opts} showrooms={SHOWROOMS} displays={DISPLAYS} requests={[]} sofaOptions={[]}
      onSaved={onSaved}
    />
  ) : null;
};

const tick = (label: string) => {
  if (!screen.queryByRole('group', { name: 'Showrooms' })) fireEvent.click(screen.getByRole('button', { name: /^Showroom:/ }));
  fireEvent.click(screen.getByLabelText(label));
};
const pieceAt = (label: string) => screen.getByLabelText(`Piece to replace at ${label}`) as HTMLSelectElement;

beforeEach(() => {
  latest = null;
  onSaved.mockReset();
  save.mutateAsync.mockReset();
  save.mutateAsync.mockImplementation(async ({ draft }: { draft: LaunchRequest }) => destinationsOf(draft).map(() => draft));
});
afterEach(cleanup);

describe('New product launch — several showrooms', () => {
  it('ticks more than one showroom, and says a request is filed for each', () => {
    render(<Form initial={draftOf()} />);
    tick(M);
    expect(latest).toMatchObject({ showroomId: 'm', alsoTo: [] });
    expect(screen.queryByText(/A request is filed for each showroom/)).toBeNull();
    tick(F);
    // The list's order, not the order they were ticked in.
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: null }, { showroomId: 'm', replaceId: null }]);
    expect(screen.getByRole('button', { name: 'Showroom: 2 showrooms' })).toBeTruthy();
    expect(screen.getByText(/A request is filed for each showroom/)).toBeTruthy();
  });

  it('picks the piece to replace at each showroom on its own', () => {
    render(<Form initial={draftOf()} />);
    tick(F);
    tick(M);
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    // Each showroom starts on the first same-category piece on its own floor.
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: 'f1' }, { showroomId: 'm', replaceId: 'm1' }]);
    expect([...pieceAt(F).options].map((o) => o.value)).toEqual(['f1', 'f2']);
    expect([...pieceAt(M).options].map((o) => o.value)).toEqual(['m1']);
    fireEvent.change(pieceAt(F), { target: { value: 'f2' } });
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: 'f2' }, { showroomId: 'm', replaceId: 'm1' }]);
    // Unticking one showroom leaves the other's choice alone.
    tick(M);
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: 'f2' }]);
    // Back to Add: nothing is replaced anywhere.
    tick(M);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: null }, { showroomId: 'm', replaceId: null }]);
  });

  it('holds Complete back while one showroom has no piece to replace, and still saves it as pending', async () => {
    render(<Form initial={draftOf({ model: 'ARRUS-PLUS', size: 'King', height: '13' })} />);
    tick(F);
    tick(M2);
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByText('No mattress on display here. Leave this showroom out, or use Add instead.')).toBeTruthy();
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: 'f1' }, { showroomId: 'm2', replaceId: null }]);
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(save.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Save & close/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('pending', 2));
  });

  it('saves once for all of them and reports how many requests were filed', async () => {
    render(<Form initial={draftOf({ model: 'ARRUS-PLUS', size: 'King', height: '13' })} />);
    tick(F);
    tick(M);
    tick(M2);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('completed', 3));
    expect(save.mutateAsync).toHaveBeenCalledTimes(1);
    const sent = save.mutateAsync.mock.calls[0]![0] as { draft: LaunchRequest; status: RequestStatus };
    expect(sent.status).toBe('completed');
    expect(destinationsOf(sent.draft).map((x) => x.showroomId)).toEqual(['f', 'm', 'm2']);
  });

  it('keeps a saved request to the one showroom it is for', () => {
    render(<Form initial={draftOf({ id: 'r1', showroomId: 'm', action: 'add' })} />);
    expect(screen.queryByRole('button', { name: /^Showroom:/ })).toBeNull();
    const select = screen.getByLabelText('Showroom') as HTMLSelectElement;
    expect(select.value).toBe('m');
    fireEvent.change(select, { target: { value: 'f' } });
    expect(destinationsOf(latest!)).toEqual([{ showroomId: 'f', replaceId: null }]);
  });
});
