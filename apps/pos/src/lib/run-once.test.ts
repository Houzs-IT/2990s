import { describe, it, expect, vi } from 'vitest';
import { runOnce } from './run-once';

describe('runOnce', () => {
  it('drops a second call while the first is still running, then allows a retry', async () => {
    const flag = { current: false };
    const busy: boolean[] = [];
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { finish = r; }));

    const first = runOnce(flag, run, (b) => busy.push(b));
    await runOnce(flag, run, (b) => busy.push(b)); // the double-tap
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await first;
    expect(busy).toEqual([true, false]);

    await runOnce(flag, async () => { throw new Error('x'); }, () => {}).catch(() => {});
    expect(flag.current).toBe(false); // a failure frees the button for a retry
  });
});
