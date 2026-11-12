import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShowroomsPicker } from './ShowroomsPicker';

afterEach(cleanup);

/* owner 2026-11-12: the launch form's Showroom field takes several showrooms. */

const SHOWROOMS = [
  { id: 'f', name: '2990s Flagship', area: 'Petaling Jaya' },
  { id: 'm', name: '2990s Mini', area: 'Kelana Jaya' },
  { id: 'm2', name: '2990s Mini (II)', area: 'Puchong' },
];

const open = () => fireEvent.click(screen.getByRole('button', { name: /^Showroom:/ }));

describe('ShowroomsPicker', () => {
  it('reads as the select it stands in for: a prompt, the one showroom, or how many', () => {
    const { rerender } = render(<ShowroomsPicker showrooms={SHOWROOMS} value={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Showroom: Choose showroom…' })).toBeTruthy();
    rerender(<ShowroomsPicker showrooms={SHOWROOMS} value={['m']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Showroom: 2990s Mini — Kelana Jaya' })).toBeTruthy();
    rerender(<ShowroomsPicker showrooms={SHOWROOMS} value={['m', 'f']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Showroom: 2 showrooms' })).toBeTruthy();
  });

  it('ticks a second showroom without dropping the first, in the list’s order', () => {
    const onChange = vi.fn();
    render(<ShowroomsPicker showrooms={SHOWROOMS} value={['m2']} onChange={onChange} />);
    expect(screen.queryByRole('group', { name: 'Showrooms' })).toBeNull();
    open();
    expect((screen.getByLabelText('2990s Mini (II) — Puchong') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('2990s Flagship — Petaling Jaya'));
    expect(onChange).toHaveBeenLastCalledWith(['f', 'm2']);
    // The list stays open for the next one.
    expect(screen.getByRole('group', { name: 'Showrooms' })).toBeTruthy();
  });

  it('unticks one, and closes on Done', () => {
    const onChange = vi.fn();
    render(<ShowroomsPicker showrooms={SHOWROOMS} value={['f', 'm']} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByLabelText('2990s Flagship — Petaling Jaya'));
    expect(onChange).toHaveBeenLastCalledWith(['m']);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Showrooms' })).toBeNull();
  });

  it('drops a showroom that is no longer on the list the next time one is ticked', () => {
    const onChange = vi.fn();
    render(<ShowroomsPicker showrooms={SHOWROOMS} value={['gone', 'm']} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Showroom: 2990s Mini — Kelana Jaya' })).toBeTruthy();
    open();
    fireEvent.click(screen.getByLabelText('2990s Flagship — Petaling Jaya'));
    expect(onChange).toHaveBeenLastCalledWith(['f', 'm']);
  });

  it('cannot be opened while there is no showroom to choose', () => {
    render(<ShowroomsPicker showrooms={[]} value={[]} onChange={() => {}} />);
    expect((screen.getByRole('button', { name: /^Showroom:/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
