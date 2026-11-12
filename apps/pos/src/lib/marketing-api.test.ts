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
