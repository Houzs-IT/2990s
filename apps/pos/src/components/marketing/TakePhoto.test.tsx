import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TakePhoto } from './TakePhoto';

afterEach(cleanup);

const touchScreen = (coarse: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: coarse, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });

describe('TakePhoto', () => {
  it('opens the back camera on a phone or tablet and hands the shot to the same handler', () => {
    touchScreen(true);
    const onFile = vi.fn();
    render(<TakePhoto onFile={onFile} />);
    const input = screen.getByLabelText('Take photo') as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    fireEvent.change(input, { target: { files: [new File(['x'], 'shot.jpg', { type: 'image/jpeg' })] } });
    expect(onFile).toHaveBeenCalledOnce();
  });

  it('is not shown on a desktop', () => {
    touchScreen(false);
    render(<TakePhoto onFile={() => {}} />);
    expect(screen.queryByText('Take photo')).toBeNull();
  });
});
