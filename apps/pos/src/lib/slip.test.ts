import { beforeEach, describe, expect, it, vi } from 'vitest';

const authedFetchRaw = vi.fn();
const handleSessionExpired = vi.fn();
vi.mock('./apiClient', () => ({
  API_URL: 'https://houzs.test/api/scm',
  IS_HOUZS: true,
  authedFetchRaw: (...a: unknown[]) => authedFetchRaw(...a),
}));
vi.mock('./session-recovery', () => ({ handleSessionExpired: () => handleSessionExpired() }));

import { uploadSlipFull } from './slip';

/* A slip upload is not a TanStack call, so main.tsx's shared 401 handler never
   sees it: an expired Houzs login left "slip init failed (401)" on the
   handover instead of the sign-in screen. */

const file = new File(['slip'], 'slip.png', { type: 'image/png' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const init = () => json({ uploadSessionId: 's1', r2Key: 'k1' });

beforeEach(() => {
  authedFetchRaw.mockReset();
  handleSessionExpired.mockReset();
});

describe('uploadSlipFull — an expired login', () => {
  it('sends the caller to sign in when init answers 401', async () => {
    authedFetchRaw.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    await expect(uploadSlipFull({ file })).rejects.toThrow('slip init failed (401)');
    expect(handleSessionExpired).toHaveBeenCalled();
  });

  it('sends the caller to sign in when confirm answers 401', async () => {
    authedFetchRaw
      .mockResolvedValueOnce(init())
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    await expect(uploadSlipFull({ file })).rejects.toThrow('slip confirm failed (401)');
    expect(handleSessionExpired).toHaveBeenCalled();
  });

  it('leaves the caller signed in on any other refusal', async () => {
    authedFetchRaw.mockResolvedValueOnce(json({ error: 'too_large' }, 400));
    await expect(uploadSlipFull({ file })).rejects.toThrow('slip init failed (400)');
    expect(handleSessionExpired).not.toHaveBeenCalled();
  });
});
