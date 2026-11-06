import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LengthPartsInput, type LengthValue } from './LengthPartsInput';

afterEach(cleanup);

const mount = (v: LengthValue) => {
  const onChange = vi.fn();
  render(<LengthPartsInput {...v} label="Length" inputClass="" onChange={onChange} />);
  return onChange;
};

describe('LengthPartsInput', () => {
  it('"+" splits the length into two parts, keeping what was typed as the first', () => {
    const onChange = mount({ value: '120', parts: null });
    fireEvent.click(screen.getByLabelText('Type the length as parts'));
    expect(onChange).toHaveBeenCalledWith({ value: '', parts: ['120', ''] });
  });

  it('keeps the length at the parts’ sum, read-only', () => {
    const onChange = mount({ value: '120', parts: ['120', ''] });
    expect(screen.queryByLabelText('Length in cm')).toBeNull();
    fireEvent.change(screen.getByLabelText('Length part 2 in cm'), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledWith({ value: '220', parts: ['120', '100'] });
  });

  it('adds a part, and removing down to one goes back to the plain length', () => {
    const onChange = mount({ value: '220', parts: ['120', '100'] });
    fireEvent.click(screen.getByLabelText('Add a part'));
    expect(onChange).toHaveBeenLastCalledWith({ value: '', parts: ['120', '100', ''] });
    fireEvent.click(screen.getByLabelText('Remove part 1'));
    expect(onChange).toHaveBeenLastCalledWith({ value: '100', parts: null });
  });
});
