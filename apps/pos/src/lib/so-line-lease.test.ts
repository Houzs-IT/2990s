import { describe, it, expect, vi } from 'vitest';

const calls: Array<{ path: string; init?: RequestInit }> = [];
vi.mock('./apiClient', () => ({
  authedFetch: async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (!init) return { salesOrder: { version: 7 } };
    const body = JSON.parse(String(init.body));
    return body.reserveLineWrites ? { version: 8, leaseToken: body.lineWriteLeaseToken } : { ok: true };
  },
}));

import { withSoLineLease } from './so-line-lease';

describe('withSoLineLease', () => {
  it('reserves with the loaded version, hands the token to the action, then releases', async () => {
    let seen = '';
    const out = await withSoLineLease('SO-1', async (t) => { seen = t; return 'done'; });
    expect(out).toBe('done');
    const [, reserve, release] = calls;
    expect(JSON.parse(String(reserve!.init?.body))).toMatchObject({ version: 7, reserveLineWrites: true, lineWriteLeaseToken: seen });
    expect(JSON.parse(String(release!.init?.body))).toMatchObject({ version: 8, completeLineWrites: true, lineWriteLeaseToken: seen });
  });
});
