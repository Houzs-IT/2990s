import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { requestBody } from './marketing-api';
import { blankRequest, type LaunchRequest } from '../components/marketing/marketing-model';

/* owner 2026-11-12: how a launch request names where it goes on the wire. */

const draft = (over: Partial<LaunchRequest>): LaunchRequest =>
  ({ ...blankRequest('Loo', 'Sales'), type: 'mattress', supplierCode: 'MW-118', ...over });

describe('requestBody — where a request goes', () => {
  it('sends one showroom as it always has', () => {
    const body = requestBody(draft({ showroomId: '107', action: 'replace', replaceId: 'd1' }), 'pending');
    expect(body).toMatchObject({ venueId: '107', action: 'replace', replaceId: 'd1' });
    expect(body).not.toHaveProperty('destinations');
  });

  it('names every showroom of a new request, each with its own piece to replace', () => {
    const body = requestBody(draft({
      showroomId: '107', action: 'replace', replaceId: 'd1', alsoTo: [{ showroomId: '108', replaceId: 'd2' }, { showroomId: '109', replaceId: null }],
    }), 'completed');
    expect(body).toMatchObject({
      action: 'replace',
      destinations: [{ venueId: '107', replaceId: 'd1' }, { venueId: '108', replaceId: 'd2' }, { venueId: '109', replaceId: null }],
    });
    // No single showroom beside the list: an API that does not know the list
    // must refuse the save, not file the first showroom alone.
    expect(body).not.toHaveProperty('venueId');
    expect(body).not.toHaveProperty('replaceId');
  });

  it('replaces nothing on an Add, whatever was picked before', () => {
    const body = requestBody(draft({ showroomId: '107', action: 'add', replaceId: 'd1', alsoTo: [{ showroomId: '108', replaceId: 'd2' }] }), 'pending');
    expect(body).toMatchObject({ destinations: [{ venueId: '107', replaceId: null }, { venueId: '108', replaceId: null }] });
  });

  it('keeps a saved request to its own showroom', () => {
    const body = requestBody(draft({ id: 'r1', showroomId: '107', action: 'add', alsoTo: [{ showroomId: '108', replaceId: null }] }), 'pending');
    expect(body).toMatchObject({ venueId: '107', replaceId: null });
    expect(body).not.toHaveProperty('destinations');
  });
});

/* Hub 2990-0066: a Houzs session that had lapsed showed "Could not load
   Marketing: Houzs did not recognise this session" instead of the sign-in
   screen, because the error lost its 401. */
describe('call — a session Houzs no longer recognises', () => {
  const answer = (status: number, reason: string) => async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.test');
    vi.resetModules();
    vi.doMock('./apiClient', () => ({ bearerToken: async () => 'tok' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x', reason }), { status })));
    const { call } = await import('./marketing-api');
    const { isSessionExpiredError } = await import('./session-recovery');
    const err = (await call('/state').catch((e: unknown) => e)) as Error;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    return { err, expired: isSessionExpiredError(err) };
  };

  it('sends the caller back to sign in on a 401', async () => {
    const { err, expired } = await answer(401, 'Houzs did not recognise this session')();
    expect(expired).toBe(true);
    expect(err.message).toContain('Houzs did not recognise this session');
  });

  it('keeps any other refusal as the plain reason', async () => {
    const { err, expired } = await answer(403, 'not allowed')();
    expect(expired).toBe(false);
    expect(err.message).toBe('not allowed');
  });
});
