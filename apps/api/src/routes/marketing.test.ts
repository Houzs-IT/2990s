import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* The gate is the whole security story here: the route runs on the
   service-role client, so a request that passes the gate can write anything
   the schemas allow. Pin who gets through first, then the shapes. */

type Answer = {
  single?: Record<string, unknown> | null;
  maybe?: Record<string, unknown> | null;
  /** Answers for successive single-row reads of the table, used up in order before `maybe`. */
  maybes?: Array<Record<string, unknown> | null>;
  list?: Record<string, unknown>[];
  /** Lists for successive list reads of the table, used up in order before `list`. */
  lists?: Record<string, unknown>[][];
  count?: number;
  error?: { message: string; code?: string } | null;
};

const state = vi.hoisted(() => ({
  single: null as Record<string, unknown> | null,
  maybe: null as Record<string, unknown> | null,
  list: [] as Record<string, unknown>[],
  error: null as { message: string; code?: string } | null,
  /** Per-table answers; a table not named here gets the shared ones above. */
  tables: {} as Record<string, Answer>,
  rpcResult: null as unknown,
  rpcError: null as { message: string } | null,
  /** The row inserted — the first, when a list of rows went in at once. */
  inserted: null as Record<string, unknown> | null,
  /** Every row of the last insert: a launch request goes in as a list, one row per showroom. */
  insertedAll: [] as Record<string, unknown>[],
  updated: null as Record<string, unknown> | null,
  lastRpc: null as { fn: string; args: Record<string, unknown> } | null,
  orFilter: null as string | null,
  /** Every table read or written, in order. */
  reads: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.reads.push(table);
      const own = () => state.tables[table] ?? {};
      const pick = <K extends keyof Answer>(k: K, shared: unknown) => (k in own() ? own()[k] : shared);
      const obj: any = {};
      for (const m of ['select', 'order', 'eq', 'is', 'in', 'delete']) obj[m] = () => obj;
      obj.or = (f: string) => { state.orFilter = f; return obj; };
      obj.insert = (p: Record<string, unknown> | Record<string, unknown>[]) => {
        state.insertedAll = Array.isArray(p) ? p : [p];
        state.inserted = state.insertedAll[0] ?? null;
        return obj;
      };
      obj.update = (p: Record<string, unknown>) => { state.updated = p; return obj; };
      obj.upsert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.single = async () => ({ data: pick('single', state.single), error: pick('error', state.error) });
      obj.maybeSingle = async () => {
        const queued = own().maybes;
        return { data: queued?.length ? queued.shift() : pick('maybe', state.maybe), error: pick('error', state.error) };
      };
      obj.then = (resolve: any) => {
        const next = own().lists?.shift();
        return resolve({ data: next ?? pick('list', state.list), error: pick('error', state.error), count: pick('count', 0) });
      };
      return obj;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.lastRpc = { fn, args };
      return { data: state.rpcResult, error: state.rpcError };
    },
  }),
}));

import { marketing, canUseMarketing } from './marketing';

const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  HOUZS_API_ROOT: 'https://houzs.test/api',
  HOUZS_COMPANY_ID: '2',
} as unknown as Env;

const app = () => {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.route('/marketing', marketing);
  return a;
};

type MeUser = Record<string, unknown>;
const meAnswers = (user: MeUser | null, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(user ? { user } : {}), { status })));
};
const MARKETING: MeUser = { id: 41, name: 'Marketing', permissions: [], capabilities: {}, position_name: 'Sales Marketing' };
const SALES: MeUser = { id: 7, name: 'Bernard', permissions: [], capabilities: { 'scm.sales.viewAll': false }, position_name: 'Sales Executive' };

const auth = { authorization: 'Bearer tok' };
const json = (method: string, body: unknown) => ({
  method,
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  state.single = null; state.maybe = null; state.list = []; state.error = null;
  // Every write files under a showroom; by default it is a listed one.
  state.tables = { marketing_showrooms: { maybe: { id: '107' } } };
  state.rpcResult = null; state.rpcError = null; state.inserted = null; state.insertedAll = []; state.updated = null; state.lastRpc = null;
  state.orFilter = null; state.reads = [];
});

/** A 1×1 PNG, base64 — small enough for any size check. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A sofa request with everything saving needs since 0219. */
const SOFA = {
  type: 'sofa', status: 'pending', venueId: '107', action: 'add', supplierCode: 'SL-2207',
  lengthCm: 220, widthCm: 95, sofaCategory: 'Seater', sofaFunction: 'Push back',
  photoMatch: 'exact', photo: { contentType: 'image/png', dataB64: PNG, fileName: 'sofa.png' },
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('canUseMarketing', () => {
  const caller = (over: Partial<Parameters<typeof canUseMarketing>[0]>) => ({
    userId: 1, name: 'x', email: '', permissions: [], capabilities: {}, scmConfigWriter: false, positionName: null, ...over,
  });
  it('admits the marketing account by Houzs capability or Title', () => {
    expect(canUseMarketing(caller({ capabilities: { 'pos.marketing': true } }))).toBe(true);
    expect(canUseMarketing(caller({ positionName: 'Sales Marketing' }))).toBe(true);
  });
  it('admits the Maintain tier', () => {
    expect(canUseMarketing(caller({ permissions: ['*'] }))).toBe(true);
    expect(canUseMarketing(caller({ scmConfigWriter: true }))).toBe(true);
    expect(canUseMarketing(caller({ capabilities: { 'scm.sales.viewAll': true } }))).toBe(true);
  });
  it('refuses a plain salesperson', () => {
    expect(canUseMarketing(caller({ positionName: 'Sales Executive' }))).toBe(false);
  });
});

describe('gate', () => {
  it('401s with no bearer, without asking Houzs', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await app().request('/marketing/state', {}, env);
    expect(res.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('401s when Houzs does not recognise the session', async () => {
    meAnswers(null, 401);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(401);
  });

  it('503s when Houzs is down — an identity check never fails open', async () => {
    meAnswers(null, 502);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(503);
  });

  it('403s a salesperson', async () => {
    meAnswers(SALES);
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'not_marketing' });
  });

  it('lets the marketing account read the board', async () => {
    meAnswers(MARKETING);
    state.list = [];
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ showrooms: [], displays: [], requests: [], floorplans: [], sofaOptions: [] });
  });
});

describe('showrooms', () => {
  it('lists the showrooms that are still listed, first in the read', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { list: [{ id: 's1', name: 'Showroom KL', area: 'Kuala Lumpur', created_by: '41' }] };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { showrooms: unknown[] };
    // Whitelisted: who added it is not on the wire.
    expect(body.showrooms).toEqual([{ id: 's1', name: 'Showroom KL', area: 'Kuala Lumpur' }]);
  });

  it('adds one and stamps who did', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { single: { id: 's9', name: 'Showroom Ipoh', area: 'Ipoh, Perak' } };
    const res = await app().request('/marketing/showrooms', json('POST', { name: '  Showroom Ipoh ', area: 'Ipoh, Perak' }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ name: 'Showroom Ipoh', area: 'Ipoh, Perak', created_by: '41', created_by_name: 'Marketing' });
    expect(await res.json()).toEqual({ showroom: { id: 's9', name: 'Showroom Ipoh', area: 'Ipoh, Perak' } });
  });

  it('needs a name', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/showrooms', json('POST', { name: '   ' }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('says so when the name is taken, rather than failing', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { single: null, error: { message: 'duplicate key value', code: '23505' } };
    const res = await app().request('/marketing/showrooms', json('POST', { name: 'Showroom KL' }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a showroom called Showroom KL.' });
  });

  it('renames one that is still listed', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { maybe: { id: 's1', name: 'Showroom Kuala Lumpur', area: '' } };
    const res = await app().request('/marketing/showrooms/s1', json('PATCH', { name: 'Showroom Kuala Lumpur' }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ name: 'Showroom Kuala Lumpur', area: '', updated_by: '41' });
  });

  it('will not remove one that still has pieces on display or open requests', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_displays = { count: 3 };
    state.tables.marketing_launch_requests = { count: 1 };
    const res = await app().request('/marketing/showrooms/s1', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'showroom_in_use',
      reason: 'This showroom still has 3 pieces on display and 1 open launch request. Clear them first.',
    });
    expect(state.updated).toBeNull();
  });

  it('removes an empty one by stamping, not deleting', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/showrooms/s1', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ archived_by: '41', archived_by_name: 'Marketing' });
    expect(typeof state.updated?.archived_at).toBe('string');
  });

  it('files nothing under a showroom that is no longer listed', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_showrooms = { maybe: null };
    const display = await app().request('/marketing/displays', json('POST', { venueId: 'gone', type: 'mattress', name: 'AKKA-FIRM' }), env);
    expect(display.status).toBe(409);
    expect(await display.json()).toEqual({ error: 'unknown_showroom', reason: 'This showroom is no longer on the list.' });
    const request = await app().request('/marketing/requests', json('POST', { ...SOFA, venueId: 'gone' }), env);
    expect(request.status).toBe(409);
    const plan = await app().request('/marketing/floorplans/gone', json('PUT', { contentType: 'image/png', dataB64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }), env);
    expect(plan.status).toBe(409);
    expect(state.inserted).toBeNull();
  });
});

describe('displays', () => {
  it('refuses a sofa with no components', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'sofa', name: 'AM9036' }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('stamps the caller on a new display, and an ordinary add is not NEW', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd1', venue_id: '107', type: 'mattress', name: 'AKKA-FIRM', modules: [], qty: 1, is_new: false };
    const res = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA-FIRM', size: 'King', height: '12', isNew: true }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      venue_id: '107', type: 'mattress', size: 'King', height: '12', is_new: false, source_request_id: null,
      created_by: '41', created_by_name: 'Marketing',
    });
  });

  /* Duplicate (owner 2026-10-10): a copy of a new product. */
  const RID = '6f1f6c1e-0000-4000-8000-0000000000a1';
  const COPY = {
    venueId: '107', type: 'sofa', modelId: null, name: 'Untitled sofa', code: 'SL-2207', modules: ['2A(LHF)', 'L(RHF)'],
    lengthCm: 280, widthCm: 160, sofaCategory: 'Seater', sofaFunction: 'Push back', sourceRequestId: RID,
  };

  it('brings a new product’s size, category, function and request with a copy — and NEW', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'sofa' } };
    state.single = { id: 'd4', venue_id: '107', type: 'sofa', name: 'Untitled sofa', modules: COPY.modules, qty: 1, is_new: true, source_request_id: RID };
    const res = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      model_id: null, code: 'SL-2207', is_new: true, source_request_id: RID,
      length_cm: 280, width_cm: 160, sofa_category: 'Seater', sofa_function: 'Push back',
    });
    expect((await res.json() as { display: { sourceRequestId: unknown } }).display.sourceRequestId).toBe(RID);
  });

  it('answers a copy with the photo of the request it came from', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'sofa', photo_updated_at: '2026-10-10T02:00:00.000Z' } };
    state.single = { id: 'd4', venue_id: '107', type: 'sofa', name: 'Untitled sofa', modules: COPY.modules, qty: 1, is_new: true, source_request_id: RID };
    const res = await app().request('/marketing/displays', json('POST', COPY), env);
    expect((await res.json() as { display: { photoAt: unknown } }).display.photoAt).toBe('2026-10-10T02:00:00.000Z');
  });

  /* Owner 2026-10-10: a display card shows its request's photo beside the
     layout, so /state says which pieces have one, and its version. */
  it('gives each sofa on display the photo time of the request it came from', async () => {
    meAnswers(MARKETING);
    const at = (id: string, photo: string | null) => ({ id, type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], photo_updated_at: photo });
    state.tables.marketing_displays = {
      list: [
        { id: 'd1', venue_id: '107', type: 'sofa', modules: ['1S'], source_request_id: 'r-open' },
        { id: 'd2', venue_id: '107', type: 'sofa', modules: ['1S'], source_request_id: 'r-arrived' },
        { id: 'd3', venue_id: '107', type: 'sofa', modules: ['1S'], source_request_id: null },
        { id: 'd4', venue_id: '107', type: 'mattress', modules: [], source_request_id: 'r-mattress' },
      ],
    };
    // First the open requests, then the one that has arrived (no longer open).
    state.tables.marketing_launch_requests = {
      lists: [[at('r-open', '2026-10-10T01:00:00.000Z')], [{ id: 'r-arrived', photo_updated_at: '2026-10-08T09:00:00.000Z' }]],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { displays: Array<{ id: string; photoAt: unknown }> };
    expect(body.displays.map((d) => [d.id, d.photoAt])).toEqual([
      ['d1', '2026-10-10T01:00:00.000Z'], ['d2', '2026-10-08T09:00:00.000Z'], ['d3', null], ['d4', null],
    ]);
    // The open requests, then one batch for the arrived one — not one per piece.
    expect(state.reads.filter((t) => t === 'marketing_launch_requests')).toHaveLength(2);
  });

  it('reads requests once when no sofa’s request has arrived', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_displays = {
      list: [
        { id: 'd1', venue_id: '107', type: 'sofa', modules: ['1S'], source_request_id: null },
        { id: 'd2', venue_id: '107', type: 'sofa', modules: ['1S'], source_request_id: 'r-open' },
      ],
    };
    state.tables.marketing_launch_requests = {
      list: [{ id: 'r-open', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], photo_updated_at: null }],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    expect((await res.json() as { displays: Array<{ photoAt: unknown }> }).displays.map((d) => d.photoAt)).toEqual([null, null]);
    expect(state.reads.filter((t) => t === 'marketing_launch_requests')).toHaveLength(1);
  });

  it('refuses a copy naming a request that is not on record, or not of its kind', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: null };
    const gone = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(gone.status).toBe(409);
    expect(await gone.json()).toEqual({ error: 'unknown_request', reason: 'The launch request this is copied from is not on record.' });
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'mattress' } };
    const other = await app().request('/marketing/displays', json('POST', COPY), env);
    expect(other.status).toBe(409);
    expect(state.inserted).toBeNull();
  });

  it('keeps a sofa’s size, category and function off any other piece', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, type: 'mattress' } };
    state.single = { id: 'd5', venue_id: '107', type: 'mattress', name: 'ARRUS-PLUS', modules: [], qty: 1, is_new: true };
    const res = await app().request('/marketing/displays', json('POST', { ...COPY, type: 'mattress', name: 'ARRUS-PLUS', modules: [] }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_cm: null, width_cm: null, sofa_category: '', sofa_function: '', source_request_id: RID, is_new: true });
  });

  it('keeps a sofa’s layout, and gives a mattress none', async () => {
    meAnswers(MARKETING);
    const layout = [{ moduleId: '1S', x: 240, y: 190, rot: 270 }];
    state.single = { id: 'd2', venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1, is_new: false, layout };
    const sofa = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], layout }), env);
    expect(sofa.status).toBe(201);
    expect(state.inserted).toMatchObject({ layout });
    expect((await sofa.json() as { display: { layout: unknown } }).display.layout).toEqual(layout);
    state.single = { id: 'd3', venue_id: '107', type: 'mattress', name: 'AKKA', modules: [], qty: 1, is_new: false };
    await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA', layout }), env);
    expect(state.inserted).toMatchObject({ layout: null });
  });

  /* 2990-0021: remarks, a photo and a display-only W x D for the diagram. */
  const DID = '6f1f6c1e-0000-4000-8000-000000000001';
  const SHOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

  it('keeps remarks, a photo and diagram dimensions with a new display, and never puts the photo on the wire', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd1', venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1, own_photo_updated_at: '2026-10-29T01:00:00Z' };
    const res = await app().request('/marketing/displays', json('POST', {
      venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], remarks: ' near window ',
      dimsWidthCm: 250, dimsDepthCm: 95, ownPhoto: { contentType: 'image/png', dataB64: SHOT, fileName: 'a.png' },
    }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      remarks: 'near window', dims_width_cm: 250, dims_depth_cm: 95,
      own_photo_content_type: 'image/png', own_photo_b64: SHOT,
    });
    const body = await res.json() as { display: Record<string, unknown> };
    expect(body.display).toMatchObject({ remarks: '', dimsWidthCm: null, ownPhotoAt: '2026-10-29T01:00:00Z' });
    expect(JSON.stringify(body)).not.toContain(SHOT);
  });

  it('refuses a display photo over 3 MB, and a width without a depth', async () => {
    meAnswers(MARKETING);
    const big = 'A'.repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3) + 4);
    const tooBig = await app().request('/marketing/displays', json('POST', {
      venueId: '107', type: 'mattress', name: 'AKKA', ownPhoto: { contentType: 'image/png', dataB64: big },
    }), env);
    expect(tooBig.status).toBe(413);
    const half = await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA', dimsWidthCm: 200 }), env);
    expect(half.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('edits a display’s remarks and diagram dimensions, touching nothing else', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1 };
    const res = await app().request(`/marketing/displays/${DID}`, json('PATCH', { remarks: 'moved to window', dimsWidthCm: 300, dimsDepthCm: 100 }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toEqual({ remarks: 'moved to window', dims_width_cm: 300, dims_depth_cm: 100 });
  });

  it('clears the diagram dimensions with nulls, and refuses nonsense or an empty edit', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1 };
    const reset = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: null, dimsDepthCm: null }), env);
    expect(reset.status).toBe(200);
    expect(state.updated).toEqual({ dims_width_cm: null, dims_depth_cm: null });
    state.updated = null;
    for (const bad of [{ dimsWidthCm: 0, dimsDepthCm: 90 }, { dimsWidthCm: 200 }, {}]) {
      const r = await app().request(`/marketing/displays/${DID}`, json('PATCH', bad), env);
      expect(r.status).toBe(400);
    }
    expect(state.updated).toBeNull();
  });

  /* YH 2026-11-05: edit a piece on the floor, and upload / replace / remove its photo. */
  it('edits what was picked on a piece, never its showroom, type or the request it came from', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S', '2A'], qty: 1 };
    const layout = [{ moduleId: '1S', x: 0, y: 0, rot: 0 }];
    const res = await app().request(`/marketing/displays/${DID}`, json('PATCH', {
      modelId: 'm2', name: 'BOOQIT', code: 'BQ', fabric: 'Linen', colour: 'Sand', leg: '4"', seat: '28"',
      modules: ['1S', '2A'], layout, remarks: ' x ',
      venueId: '999', type: 'mattress', sourceRequestId: '6f1f6c1e-0000-4000-8000-0000000000a1', isNew: true,
    }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toEqual({
      model_id: 'm2', name: 'BOOQIT', code: 'BQ', fabric: 'Linen', colour: 'Sand', leg: '4"', seat: '28"',
      modules: ['1S', '2A'], layout, remarks: 'x',
    });
  });

  it('refuses a sofa edited down to no components, and gives a mattress no layout', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, type: 'sofa' };
    const empty = await app().request(`/marketing/displays/${DID}`, json('PATCH', { modules: [] }), env);
    expect(empty.status).toBe(400);
    expect(state.updated).toBeNull();
    state.maybe = { id: DID, type: 'mattress', modules: [], qty: 1 };
    await app().request(`/marketing/displays/${DID}`, json('PATCH', { size: 'King', layout: [{ moduleId: '1S', x: 0, y: 0, rot: 0 }] }), env);
    expect(state.updated).toEqual({ size: 'King', layout: null });
  });

  it('edits a sofa’s accessory pieces against the layout sent, else the one saved, and gives a mattress none', async () => {
    meAnswers(MARKETING);
    const layout = [{ id: 'c1', moduleId: '1S', x: 0, y: 0, rot: 0 }];
    const kept = { id: 'p1', modelId: 'acc-back', cellId: 'c1', slot: 0 };
    const stray = { id: 'p2', modelId: 'acc-back', cellId: 'gone', slot: 0 };
    state.maybe = { id: DID, type: 'sofa', layout: null };
    await app().request(`/marketing/displays/${DID}`, json('PATCH', { modules: ['1S'], layout, accessories: [kept, stray] }), env);
    expect(state.updated).toMatchObject({ layout, accessories: [kept] });
    state.maybe = { id: DID, type: 'sofa', layout };
    await app().request(`/marketing/displays/${DID}`, json('PATCH', { accessories: [kept] }), env);
    expect(state.updated).toEqual({ accessories: [kept] });
    state.maybe = { id: DID, type: 'mattress', layout: null };
    await app().request(`/marketing/displays/${DID}`, json('PATCH', { accessories: [kept] }), env);
    expect(state.updated).toEqual({ accessories: null });
  });

  it('replaces a piece’s own photo, takes it off with null, and refuses one over 3 MB', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'mattress', name: 'AKKA', modules: [], qty: 1, own_photo_updated_at: 't' };
    const put = await app().request(`/marketing/displays/${DID}`, json('PATCH', { ownPhoto: { contentType: 'image/png', dataB64: SHOT, fileName: 'b.png' } }), env);
    expect(put.status).toBe(200);
    expect(state.updated).toMatchObject({ own_photo_content_type: 'image/png', own_photo_b64: SHOT, own_photo_file_name: 'b.png' });
    expect(typeof state.updated?.own_photo_updated_at).toBe('string');
    expect(JSON.stringify(await put.json())).not.toContain(SHOT);
    const off = await app().request(`/marketing/displays/${DID}`, json('PATCH', { ownPhoto: null }), env);
    expect(off.status).toBe(200);
    expect(state.updated).toEqual({ own_photo_content_type: null, own_photo_b64: null, own_photo_file_name: null, own_photo_updated_at: null });
    state.updated = null;
    const big = 'A'.repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3) + 4);
    const tooBig = await app().request(`/marketing/displays/${DID}`, json('PATCH', { ownPhoto: { contentType: 'image/png', dataB64: big } }), env);
    expect(tooBig.status).toBe(413);
    expect(state.updated).toBeNull();
  });

  it('404s an edit of a display that is gone, and a bad id', async () => {
    meAnswers(MARKETING);
    state.maybe = null;
    expect((await app().request(`/marketing/displays/${DID}`, json('PATCH', { remarks: 'x' }), env)).status).toBe(404);
    expect((await app().request('/marketing/displays/nope', json('PATCH', { remarks: 'x' }), env)).status).toBe(404);
  });

  it('serves a display’s own photo on its own read', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, own_photo_content_type: 'image/png', own_photo_b64: SHOT, own_photo_file_name: 'a.png', own_photo_updated_at: 't' };
    const res = await app().request(`/marketing/displays/${DID}/photo`, { headers: auth }, env);
    expect(await res.json()).toEqual({ photo: { dataUrl: `data:image/png;base64,${SHOT}`, fileName: 'a.png', updatedAt: 't' } });
    state.maybe = { id: DID, own_photo_b64: null };
    expect(await (await app().request(`/marketing/displays/${DID}/photo`, { headers: auth }, env)).json()).toEqual({ photo: null });
  });

  it('removes by stamping, not deleting', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: '6f1f6c1e-0000-4000-8000-000000000001' };
    const res = await app().request('/marketing/displays/6f1f6c1e-0000-4000-8000-000000000001', { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ removed_by: '41', removed_by_name: 'Marketing' });
    expect(typeof state.updated?.removed_at).toBe('string');
  });
});

describe('launch requests', () => {
  const base = SOFA;
  const RID = '6f1f6c1e-0000-4000-8000-000000000004';

  it('needs the showroom and Add / Replace to save at all', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending' }), env);
    expect(res.status).toBe(400);
  });

  it('saves a pending sofa and snapshots who asked', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const res = await app().request('/marketing/requests', json('POST', base), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ requested_by: '41', requested_by_name: 'Marketing', requested_by_role: 'Marketing', completed_at: null });
  });

  /* Owner 2026-10-09: these are needed to SAVE, not only to Complete. */
  it('will not save a sofa without its supplier code, size, category, function and photo', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { type: 'sofa', status: 'pending', venueId: '107', action: 'add' }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; missing: string[]; reason: string };
    expect(body.error).toBe('missing_fields');
    expect(body.missing).toEqual(['Supplier code', 'Sofa size', 'Category', 'Function', 'Photo']);
    expect(body.reason).toBe('Fill in Supplier code, Sofa size, Category, Function and Photo before saving. If the form does not show them, reload the POS.');
    expect(state.inserted).toBeNull();
  });

  it('wants the photo marked Exact or Non-exact, and a Non-exact one explained', async () => {
    meAnswers(MARKETING);
    const unmarked = await app().request('/marketing/requests', json('POST', { ...base, photoMatch: '' }), env);
    expect((await unmarked.json() as { missing: string[] }).missing).toEqual(['Exact / Non-exact']);
    const unexplained = await app().request('/marketing/requests', json('POST', { ...base, photoMatch: 'non_exact', photoNote: '  ' }), env);
    expect((await unexplained.json() as { missing: string[] }).missing).toEqual(['Photo note']);
    expect(state.inserted).toBeNull();
  });

  it('needs only the supplier code on a mattress or bed frame', async () => {
    meAnswers(MARKETING);
    const bare = await app().request('/marketing/requests', json('POST', { type: 'mattress', status: 'pending', venueId: '107', action: 'add' }), env);
    expect((await bare.json() as { missing: string[] }).missing).toEqual(['Supplier code']);
    state.list = [{ id: 'r2', type: 'bedframe', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const ok = await app().request('/marketing/requests', json('POST', { type: 'bedframe', status: 'pending', venueId: '107', action: 'add', supplierCode: 'BF-9' }), env);
    expect(ok.status).toBe(201);
  });

  it('writes the size, category, function and photo with the request in one insert', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const res = await app().request('/marketing/requests', json('POST', { ...base, photoNote: 'kept only for Non-exact' }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      length_cm: 220, width_cm: 95, sofa_category: 'Seater', sofa_function: 'Push back',
      photo_match: 'exact', photo_note: '', photo_content_type: 'image/png', photo_b64: PNG, photo_file_name: 'sofa.png',
    });
    expect(state.inserted?.photo_bytes).toBeGreaterThan(0);
    expect(typeof state.inserted?.photo_updated_at).toBe('string');
  });

  it('refuses a size in anything but whole centimetres', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { ...base, lengthCm: 220.5 }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('never puts the photo itself on the wire of a request', async () => {
    meAnswers(MARKETING);
    state.list = [{
      id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [],
      photo_b64: PNG, photo_updated_at: '2026-10-09T03:00:00.000Z', photo_match: 'exact', length_cm: 220, width_cm: 95,
    }];
    const res = await app().request('/marketing/requests', json('POST', base), env);
    const body = await res.json() as { request: Record<string, unknown> };
    expect(JSON.stringify(body)).not.toContain(PNG);
    expect(body.request).toMatchObject({ photoAt: '2026-10-09T03:00:00.000Z', photoMatch: 'exact', lengthCm: 220, widthCm: 95 });
  });

  it('keeps the saved photo on an edit that sends none', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = {
      maybe: { id: RID, type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], photo_updated_at: '2026-10-09T03:00:00.000Z' },
    };
    const noPhoto = { ...base, photo: undefined }; // JSON drops it: no photo sent
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', noPhoto), env);
    expect(res.status).toBe(200);
    expect(state.updated).not.toHaveProperty('photo_b64');
    expect(state.updated).toMatchObject({ length_cm: 220, sofa_function: 'Push back' });
  });

  it('will not save an edit of a sofa that has no photo and sends none', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: { id: RID, photo_updated_at: null } };
    const noPhoto = { ...base, photo: undefined }; // JSON drops it: no photo sent
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', noPhoto), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { missing: string[] }).missing).toEqual(['Photo']);
    expect(state.updated).toBeNull();
  });

  it('404s an edit of a request that has left the board', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = { maybe: null };
    const res = await app().request(`/marketing/requests/${RID}`, json('PUT', base), env);
    expect(res.status).toBe(404);
  });

  it('will not complete a Replace without the piece it replaces', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', { ...base, status: 'completed', action: 'replace' }), env);
    expect(res.status).toBe(409);
  });

  it('refuses to replace a piece from another showroom', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: 'x', venue_id: '999', type: 'sofa', removed_at: null };
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, action: 'replace', replaceId: '6f1f6c1e-0000-4000-8000-000000000002',
    }), env);
    expect(res.status).toBe(409);
  });

  /* owner 2026-11-12: a new product can go to several showrooms at once. It is
     one request for each showroom, all of them written by a single insert. */
  describe('several showrooms at once', () => {
    const D1 = '6f1f6c1e-0000-4000-8000-0000000000d1';
    const D2 = '6f1f6c1e-0000-4000-8000-0000000000d2';
    // The product alone: where it goes is named in `destinations` instead.
    const product = { ...base, venueId: undefined };
    const row = (id: string, venue: string) => ({ id, type: 'sofa', status: 'pending', venue_id: venue, action: 'add', combo_rows: [], modules: [] });
    const post = (body: unknown) => app().request('/marketing/requests', json('POST', body), env);

    it('files one request for each showroom in a single insert, each with its own copy of the photo', async () => {
      meAnswers(MARKETING);
      state.tables.marketing_launch_requests = { list: [row('r1', '107'), row('r2', '108')] };
      const res = await post({ ...product, destinations: [{ venueId: '107' }, { venueId: '108' }] });
      expect(res.status).toBe(201);
      expect(state.insertedAll.map((r) => r.venue_id)).toEqual(['107', '108']);
      for (const r of state.insertedAll) {
        expect(r).toMatchObject({
          supplier_code: 'SL-2207', action: 'add', replace_display_id: null, photo_b64: PNG,
          requested_by: '41', requested_by_name: 'Marketing', completed_at: null,
        });
      }
      // One write for both rows: they are filed together or not at all.
      expect(state.reads.filter((t) => t === 'marketing_launch_requests')).toHaveLength(1);
      const body = await res.json() as { request: { id: string }; requests: Array<{ id: string; venueId: string }> };
      expect(body.requests.map((r) => [r.id, r.venueId])).toEqual([['r1', '107'], ['r2', '108']]);
      expect(body.request.id).toBe('r1');
      expect(JSON.stringify(body)).not.toContain(PNG);
    });

    it('still takes one showroom the way it always has, and answers with it both ways', async () => {
      meAnswers(MARKETING);
      state.list = [row('r1', '107')];
      const res = await post(base);
      expect(res.status).toBe(201);
      expect(state.insertedAll).toHaveLength(1);
      expect(state.inserted).toMatchObject({ venue_id: '107' });
      const body = await res.json() as { request: { id: string }; requests: Array<{ id: string }> };
      expect(body.request.id).toBe('r1');
      expect(body.requests.map((r) => r.id)).toEqual(['r1']);
    });

    it('writes each showroom’s own piece to replace', async () => {
      meAnswers(MARKETING);
      state.tables.marketing_displays = {
        maybes: [
          { id: D1, venue_id: '107', type: 'sofa', removed_at: null },
          { id: D2, venue_id: '108', type: 'sofa', removed_at: null },
        ],
      };
      state.tables.marketing_launch_requests = { list: [row('r1', '107'), row('r2', '108')] };
      const res = await post({
        ...product, action: 'replace', destinations: [{ venueId: '107', replaceId: D1 }, { venueId: '108', replaceId: D2 }],
      });
      expect(res.status).toBe(201);
      expect(state.insertedAll.map((r) => [r.venue_id, r.replace_display_id])).toEqual([['107', D1], ['108', D2]]);
    });

    it('files none of them when one showroom’s piece to replace is on another showroom’s floor', async () => {
      meAnswers(MARKETING);
      state.maybe = { id: D1, venue_id: '107', type: 'sofa', removed_at: null };
      const res = await post({
        ...product, action: 'replace', destinations: [{ venueId: '107', replaceId: D1 }, { venueId: '108', replaceId: D1 }],
      });
      expect(res.status).toBe(409);
      expect(state.inserted).toBeNull();
    });

    it('will not complete a Replace until every showroom has its piece, but saves it as pending', async () => {
      meAnswers(MARKETING);
      state.maybe = { id: D1, venue_id: '107', type: 'sofa', removed_at: null };
      const destinations = [{ venueId: '107', replaceId: D1 }, { venueId: '108' }];
      const done = await post({ ...product, status: 'completed', action: 'replace', destinations });
      expect(done.status).toBe(409);
      expect(await done.json()).toEqual({ error: 'invalid_replace', reason: 'Choose the piece this replaces.' });
      expect(state.inserted).toBeNull();
      state.tables.marketing_launch_requests = { list: [row('r1', '107'), row('r2', '108')] };
      const pending = await post({ ...product, action: 'replace', destinations });
      expect(pending.status).toBe(201);
      expect(state.insertedAll.map((r) => r.replace_display_id)).toEqual([D1, null]);
    });

    it('files none of them when one of the showrooms is no longer listed', async () => {
      meAnswers(MARKETING);
      state.tables.marketing_showrooms = { maybes: [{ id: '107' }], maybe: null };
      const res = await post({ ...product, destinations: [{ venueId: '107' }, { venueId: 'gone' }] });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'unknown_showroom', reason: 'One of these showrooms is no longer on the list.' });
      expect(state.inserted).toBeNull();
    });

    it('refuses a showroom named twice, no showroom at all, or more than a save may name', async () => {
      meAnswers(MARKETING);
      const tooMany = Array.from({ length: 21 }, (_, i) => ({ venueId: `v${i}` }));
      for (const destinations of [[{ venueId: '107' }, { venueId: '107' }], [], tooMany]) {
        const res = await post({ ...product, destinations });
        expect(res.status).toBe(400);
      }
      expect((await post(product)).status).toBe(400);
      expect(state.inserted).toBeNull();
    });

    it('refuses a photo too large to copy to that many showrooms', async () => {
      meAnswers(MARKETING);
      // Exactly 1 MB of photo: twelve copies are the 12 MB one save may write, thirteen are over.
      const photo = { contentType: 'image/jpeg', dataB64: `${'A'.repeat(Math.ceil((1024 * 1024) / 3) * 4 - 2)}==`, fileName: 'big.jpg' };
      const to = (n: number) => Array.from({ length: n }, (_, i) => ({ venueId: `v${i}` }));
      const over = await post({ ...product, photo, destinations: to(13) });
      expect(over.status).toBe(413);
      expect((await over.json() as { reason: string }).reason)
        .toBe('This photo is too large to file for 13 showrooms at once. Choose fewer showrooms, or a smaller photo.');
      expect(state.inserted).toBeNull();
      state.tables.marketing_launch_requests = { list: to(12).map((d, i) => row(`r${i}`, d.venueId)) };
      const fits = await post({ ...product, photo, destinations: to(12) });
      expect(fits.status).toBe(201);
      expect(state.insertedAll).toHaveLength(12);
    });

    it('keeps a saved request to one showroom', async () => {
      meAnswers(MARKETING);
      state.tables.marketing_launch_requests = {
        maybe: { id: RID, type: 'sofa', status: 'pending', venue_id: '108', action: 'add', combo_rows: [], modules: [], photo_updated_at: '2026-10-09T03:00:00.000Z' },
      };
      const several = await app().request(`/marketing/requests/${RID}`, json('PUT', {
        ...product, destinations: [{ venueId: '107' }, { venueId: '108' }],
      }), env);
      expect(several.status).toBe(400);
      expect((await several.json() as { reason: string }).reason).toBe('A saved request goes to one showroom.');
      expect(state.updated).toBeNull();
      // One showroom named the new way is still that request's own edit.
      const one = await app().request(`/marketing/requests/${RID}`, json('PUT', { ...product, photo: undefined, destinations: [{ venueId: '108' }] }), env);
      expect(one.status).toBe(200);
      expect(state.updated).toMatchObject({ venue_id: '108' });
    });
  });

  it('keeps an untyped combo price as null, not zero', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', modules: [], combo_rows: [{ modules: ['2A(LHF)'], price: null }] }];
    const res = await app().request('/marketing/requests', json('POST', { ...base, rows: [{ modules: ['2A(LHF)'], price: null }] }), env);
    const body = await res.json() as { request: { rows: unknown[] } };
    expect(body.request.rows).toEqual([{ modules: ['2A(LHF)'], price: null, layout: null, accessories: null }]);
  });

  /* 0220: the sofa as laid out on the Custom build canvas. */
  const LAYOUT = [
    { id: 'c1', moduleId: '2A(LHF)', x: 152.5, y: 192.5, rot: 90 },
    { id: 'c2', moduleId: 'L(RHF)', x: 152.5, y: 337.5, rot: 180 },
  ];

  it('stores the layout, and each combo’s, as laid out', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, modules: ['2A(LHF)', 'L(RHF)'], layout: LAYOUT,
      rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540, layout: LAYOUT }],
    }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ layout: LAYOUT, combo_rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540, layout: LAYOUT }] });
  });

  it('refuses a layout cell turned anything but a quarter turn', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, layout: [{ moduleId: '2A(LHF)', x: 0, y: 0, rot: 45 }],
    }), env);
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('reads a layout back, dropping a malformed cell and keeping none as null', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_launch_requests = {
      list: [
        { id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], layout: [...LAYOUT, { moduleId: '', x: 'x', rot: 7 }] },
        { id: 'r2', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: ['1S'], layout: null },
      ],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { requests: Array<{ id: string; layout: unknown }> };
    expect(body.requests.map((r) => r.layout)).toEqual([LAYOUT, null]);
  });

  /* 0223: Sofa Accessory pieces placed on the layout. */
  const PIECES = [
    { id: 'p1', modelId: 'acc-back', cellId: 'c1', slot: 0 },
    { id: 'p2', modelId: 'acc-arm', cellId: 'c2', slot: 2 },
  ];

  it('stores the pieces on a request and its combos, dropping one off the layout', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], layout: LAYOUT, accessories: PIECES }];
    const stray = { id: 'p9', modelId: 'acc-back', cellId: 'gone', slot: 1 };
    const res = await app().request('/marketing/requests', json('POST', {
      ...base, modules: ['2A(LHF)', 'L(RHF)'], layout: LAYOUT, accessories: [...PIECES, stray],
      rows: [{ modules: ['2A(LHF)', 'L(RHF)'], price: 3540, layout: LAYOUT, accessories: PIECES }],
    }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ accessories: PIECES, combo_rows: [{ layout: LAYOUT, accessories: PIECES }] });
    expect((await res.json() as { request: { accessories: unknown } }).request.accessories).toEqual(PIECES);
  });

  it('keeps no pieces without a layout, and refuses a malformed one', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    await app().request('/marketing/requests', json('POST', { ...base, accessories: PIECES }), env);
    expect(state.inserted).toMatchObject({ accessories: null });
    state.inserted = null;
    const bad = await app().request('/marketing/requests', json('POST', {
      ...base, layout: LAYOUT, accessories: [{ id: 'p1', modelId: 'acc-back', cellId: 'c1', slot: -1 }],
    }), env);
    expect(bad.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('stores a sofa display’s pieces and reads them back; a mattress gets none', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd2', venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['2A(LHF)', 'L(RHF)'], qty: 1, is_new: false, layout: LAYOUT, accessories: PIECES };
    const sofa = await app().request('/marketing/displays', json('POST', {
      venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['2A(LHF)', 'L(RHF)'], layout: LAYOUT, accessories: PIECES,
    }), env);
    expect(sofa.status).toBe(201);
    expect(state.inserted).toMatchObject({ accessories: PIECES });
    expect((await sofa.json() as { display: { accessories: unknown } }).display.accessories).toEqual(PIECES);
    await app().request('/marketing/displays', json('POST', { venueId: '107', type: 'mattress', name: 'AKKA', layout: LAYOUT, accessories: PIECES }), env);
    expect(state.inserted).toMatchObject({ accessories: null });
  });

  it('serves a request photo with its Exact / Non-exact note, or null', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: RID, photo_content_type: 'image/png', photo_b64: PNG, photo_file_name: 'sofa.png', photo_updated_at: '2026-10-09T03:00:00.000Z', photo_match: 'non_exact', photo_note: 'Slimmer arms' };
    const res = await app().request(`/marketing/requests/${RID}/photo`, { headers: auth }, env);
    expect(await res.json()).toEqual({
      photo: { dataUrl: `data:image/png;base64,${PNG}`, fileName: 'sofa.png', updatedAt: '2026-10-09T03:00:00.000Z', match: 'non_exact', note: 'Slimmer arms' },
    });
    state.maybe = { id: RID, photo_b64: null };
    const none = await app().request(`/marketing/requests/${RID}/photo`, { headers: auth }, env);
    expect(await none.json()).toEqual({ photo: null });
  });
});

describe('sofa category + function lists', () => {
  const CAT = '6f1f6c1e-0000-4000-8000-0000000000c1';

  it('reads each category with its functions, in the order they were added', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = {
      list: [
        { id: 'f2', kind: 'function', parent_id: 'c1', name: 'Push back', seq: 4, created_by: '41' },
        { id: 'c1', kind: 'category', parent_id: null, name: 'Seater', seq: 1 },
        { id: 'f1', kind: 'function', parent_id: 'c1', name: 'Fixed', seq: 3 },
        { id: 'c2', kind: 'category', parent_id: null, name: 'Chair', seq: 2 },
      ],
    };
    const res = await app().request('/marketing/state', { headers: auth }, env);
    const body = await res.json() as { sofaOptions: unknown };
    expect(body.sofaOptions).toEqual([
      { id: 'c1', name: 'Seater', functions: [{ id: 'f1', name: 'Fixed' }, { id: 'f2', name: 'Push back' }] },
      { id: 'c2', name: 'Chair', functions: [] },
    ]);
  });

  it('adds a category, and a function under a listed one', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { single: { id: 'c9', kind: 'category', parent_id: null, name: 'Recliner', seq: 9 } };
    const cat = await app().request('/marketing/sofa-options', json('POST', { name: ' Recliner ' }), env);
    expect(cat.status).toBe(201);
    expect(state.inserted).toMatchObject({ kind: 'category', parent_id: null, name: 'Recliner', created_by: '41' });

    state.tables.marketing_sofa_options = {
      maybe: { id: CAT, kind: 'category' },
      single: { id: 'f9', kind: 'function', parent_id: CAT, name: 'Electric', seq: 10 },
    };
    const fn = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(fn.status).toBe(201);
    expect(state.inserted).toMatchObject({ kind: 'function', parent_id: CAT, name: 'Electric' });
    expect(await fn.json()).toEqual({ option: { id: 'f9', kind: 'function', categoryId: CAT, name: 'Electric' } });
  });

  it('files no function under a removed category, or under a function', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: null };
    const gone = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(gone.status).toBe(409);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'function' } };
    const nested = await app().request('/marketing/sofa-options', json('POST', { name: 'Electric', categoryId: CAT }), env);
    expect(nested.status).toBe(409);
    expect(state.inserted).toBeNull();
  });

  it('says so when a name is already on the list', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { single: null, error: { message: 'duplicate key value', code: '23505' } };
    const res = await app().request('/marketing/sofa-options', json('POST', { name: 'Seater' }), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a category called Seater.' });
  });

  it('renames one', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'category', parent_id: null, name: 'Seaters', seq: 1 } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, json('PATCH', { name: 'Seaters' }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ name: 'Seaters', updated_by: '41' });
  });

  it('removes a category together with its functions, by stamping', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'category' } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ archived_by: '41', archived_by_name: 'Marketing' });
    expect(state.orFilter).toBe(`id.eq.${CAT},parent_id.eq.${CAT}`);
  });

  it('removes a function on its own', async () => {
    meAnswers(MARKETING);
    state.tables.marketing_sofa_options = { maybe: { id: CAT, kind: 'function' } };
    const res = await app().request(`/marketing/sofa-options/${CAT}`, { method: 'DELETE', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.orFilter).toBeNull();
  });

  it('keeps a salesperson out of the lists', async () => {
    meAnswers(SALES);
    const res = await app().request('/marketing/sofa-options', json('POST', { name: 'Recliner' }), env);
    expect(res.status).toBe(403);
    expect(state.inserted).toBeNull();
    const whole = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', { name: 'Seater', functions: [] }), env);
    expect(whole.status).toBe(403);
    expect(state.lastRpc).toBeNull();
  });

  /* 0221 (owner 2026-10-10): the edit dialog saves a category and its whole
     function list at once. */
  const F1 = '6f1f6c1e-0000-4000-8000-0000000000f1';

  it('saves a category and its whole list in one transaction, as the caller', async () => {
    meAnswers(MARKETING);
    state.rpcResult = CAT;
    state.tables.marketing_sofa_options = {
      list: [
        { id: CAT, kind: 'category', parent_id: null, name: 'Sitter', seq: 1 },
        { id: F1, kind: 'function', parent_id: CAT, name: 'Fixed', seq: 3 },
        { id: 'f9', kind: 'function', parent_id: CAT, name: 'Recliner', seq: 12 },
      ],
    };
    const res = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', {
      name: ' Sitter ', functions: [{ id: F1, name: 'Fixed ' }, { name: 'Recliner' }],
    }), env);
    expect(res.status).toBe(200);
    expect(state.lastRpc).toEqual({
      fn: 'marketing_save_sofa_category',
      args: { p_category_id: CAT, p_name: 'Sitter', p_functions: [{ id: F1, name: 'Fixed' }, { name: 'Recliner' }], p_by: '41', p_by_name: 'Marketing' },
    });
    expect(state.orFilter).toBe(`id.eq.${CAT},parent_id.eq.${CAT}`);
    expect(await res.json()).toEqual({
      category: { id: CAT, name: 'Sitter', functions: [{ id: F1, name: 'Fixed' }, { id: 'f9', name: 'Recliner' }] },
    });
  });

  it('adds a category with its functions', async () => {
    meAnswers(MARKETING);
    state.rpcResult = CAT;
    state.tables.marketing_sofa_options = { list: [{ id: CAT, kind: 'category', parent_id: null, name: 'Chaise', seq: 9 }] };
    const res = await app().request('/marketing/sofa-categories', json('POST', { name: 'Chaise', functions: [{ name: 'Fixed' }] }), env);
    expect(res.status).toBe(201);
    expect(state.lastRpc?.args).toMatchObject({ p_category_id: null, p_name: 'Chaise', p_functions: [{ name: 'Fixed' }] });
  });

  it('refuses a function listed twice before writing anything', async () => {
    meAnswers(MARKETING);
    const res = await app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', {
      name: 'Sitter', functions: [{ id: F1, name: 'Fixed' }, { name: 'fixed' }],
    }), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'fixed is on the list twice.' });
    expect(state.lastRpc).toBeNull();
  });

  it('says what the transaction refused', async () => {
    meAnswers(MARKETING);
    const put = () => app().request(`/marketing/sofa-categories/${CAT}`, json('PUT', { name: 'Chair', functions: [] }), env);
    state.rpcError = { message: 'duplicate_category' };
    let res = await put();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'duplicate_name', reason: 'There is already a category called Chair.' });
    state.rpcError = { message: 'function_not_found' };
    res = await put();
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('list_changed');
    state.rpcError = { message: 'category_not_found' };
    res = await put();
    expect(res.status).toBe(404);
  });

  it('404s an id that is not one', async () => {
    meAnswers(MARKETING);
    const res = await app().request('/marketing/sofa-categories/c1', json('PUT', { name: 'Chair', functions: [] }), env);
    expect(res.status).toBe(404);
    expect(state.lastRpc).toBeNull();
  });
});

describe('arrive', () => {
  it('runs the one-transaction function with the caller', async () => {
    meAnswers(MARKETING);
    state.rpcResult = { displayId: 'd9', removedName: '5531' };
    const res = await app().request('/marketing/requests/6f1f6c1e-0000-4000-8000-000000000003/arrive', { method: 'POST', headers: auth }, env);
    expect(res.status).toBe(200);
    expect(state.lastRpc).toEqual({ fn: 'marketing_arrive_launch_request', args: { p_request_id: '6f1f6c1e-0000-4000-8000-000000000003', p_by: '41', p_by_name: 'Marketing' } });
    expect(await res.json()).toEqual({ displayId: 'd9', removedName: '5531' });
  });

  it('409s a request that is not in Completed Info', async () => {
    meAnswers(MARKETING);
    state.rpcError = { message: 'request_not_completed' };
    const res = await app().request('/marketing/requests/6f1f6c1e-0000-4000-8000-000000000003/arrive', { method: 'POST', headers: auth }, env);
    expect(res.status).toBe(409);
  });
});

/* 0224 (YH 2026-11-05): a length typed as parts, x + y = length. */
describe('length parts', () => {
  const DID = '6f1f6c1e-0000-4000-8000-0000000000b1';
  const RID = '6f1f6c1e-0000-4000-8000-0000000000b2';

  it('saves a request’s parts and their choice, and gives them back on the wire', async () => {
    meAnswers(MARKETING);
    state.list = [{
      id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [],
      length_cm: 220, width_cm: 95, length_parts: [120, 100], length_show_parts: true,
    }];
    const res = await app().request('/marketing/requests', json('POST', { ...SOFA, lengthParts: [120, 100], lengthShowParts: true }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_cm: 220, length_parts: [120, 100], length_show_parts: true });
    const body = await res.json() as { request: Record<string, unknown> };
    expect(body.request).toMatchObject({ lengthCm: 220, lengthParts: [120, 100], lengthShowParts: true });
  });

  it('saves "show as x + y" with no typed parts: the POS works them out from the layout', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const res = await app().request('/marketing/requests', json('POST', { ...SOFA, lengthShowParts: true }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_parts: null, length_show_parts: true });
  });

  it('works the length out from the parts when none is sent', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [] }];
    const res = await app().request('/marketing/requests', json('POST', { ...SOFA, lengthCm: null, lengthParts: [150, 90] }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_cm: 240, length_parts: [150, 90], length_show_parts: false });
  });

  it('refuses parts that do not add up, a single part, or more than six', async () => {
    meAnswers(MARKETING);
    for (const lengthParts of [[120, 90], [220], [1, 1, 1, 1, 1, 1, 1], [120.5, 99.5]]) {
      const r = await app().request('/marketing/requests', json('POST', { ...SOFA, lengthParts }), env);
      expect(r.status).toBe(400);
    }
    const put = await app().request(`/marketing/requests/${RID}`, json('PUT', { ...SOFA, lengthParts: [100, 100] }), env);
    expect(put.status).toBe(400);
    expect(state.inserted).toBeNull();
    expect(state.updated).toBeNull();
  });

  it('checks a new display’s parts against its diagram width, else its length', async () => {
    meAnswers(MARKETING);
    state.single = { id: 'd1', venue_id: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], qty: 1, length_parts: [150, 100], length_show_parts: true };
    const ok = await app().request('/marketing/displays', json('POST', {
      venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], dimsWidthCm: 250, dimsDepthCm: 95, lengthCm: 220,
      lengthParts: [150, 100], lengthShowParts: true,
    }), env);
    expect(ok.status).toBe(201);
    expect(state.inserted).toMatchObject({ length_parts: [150, 100], length_show_parts: true });
    expect((await ok.json() as { display: Record<string, unknown> }).display).toMatchObject({ lengthParts: [150, 100], lengthShowParts: true });
    state.inserted = null;
    const bad = await app().request('/marketing/displays', json('POST', {
      venueId: '107', type: 'sofa', name: 'BOOQIT', modules: ['1S'], lengthCm: 220, lengthParts: [150, 100],
    }), env);
    expect(bad.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('edits a display’s parts with its diagram size, and drops saved parts that no longer add up', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'sofa', length_cm: 220, dims_width_cm: null, length_parts: [120, 100] };
    const res = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: 260, dimsDepthCm: 95, lengthParts: [160, 100], lengthShowParts: true }), env);
    expect(res.status).toBe(200);
    expect(state.updated).toEqual({ dims_width_cm: 260, dims_depth_cm: 95, length_parts: [160, 100], length_show_parts: true });
    const mismatch = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: 260, dimsDepthCm: 95, lengthParts: [120, 100] }), env);
    expect(mismatch.status).toBe(400);
    const plain = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: 230, dimsDepthCm: 95 }), env);
    expect(plain.status).toBe(200);
    expect(state.updated).toEqual({ dims_width_cm: 230, dims_depth_cm: 95, length_parts: null });
    const back = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: null, dimsDepthCm: null }), env);
    expect(back.status).toBe(200);
    expect(state.updated).toEqual({ dims_width_cm: null, dims_depth_cm: null }); // 120 + 100 = its length 220 again
  });

  /* 0225 (YH 2026-11-06, an L-shape such as Lotti): the depth by component too. */
  it('saves a request’s depth parts against its width, and refuses ones that do not add up', async () => {
    meAnswers(MARKETING);
    state.list = [{ id: 'r1', type: 'sofa', status: 'pending', venue_id: '107', action: 'add', combo_rows: [], modules: [], depth_parts: [60, 35] }];
    const res = await app().request('/marketing/requests', json('POST', { ...SOFA, widthCm: 95, depthParts: [60, 35] }), env);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ width_cm: 95, depth_parts: [60, 35] });
    expect((await res.json() as { request: Record<string, unknown> }).request).toMatchObject({ depthParts: [60, 35] });
    state.inserted = null;
    const bad = await app().request('/marketing/requests', json('POST', { ...SOFA, widthCm: 95, depthParts: [60, 30] }), env);
    expect(bad.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('checks a display’s depth parts against its diagram depth', async () => {
    meAnswers(MARKETING);
    state.maybe = { id: DID, venue_id: '107', type: 'sofa', length_cm: 276, width_cm: 182, dims_width_cm: null, dims_depth_cm: null, length_parts: null, depth_parts: null };
    const ok = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: 276, dimsDepthCm: 182, depthParts: [95, 87] }), env);
    expect(ok.status).toBe(200);
    expect(state.updated).toEqual({ dims_width_cm: 276, dims_depth_cm: 182, depth_parts: [95, 87] });
    const bad = await app().request(`/marketing/displays/${DID}`, json('PATCH', { dimsWidthCm: 276, dimsDepthCm: 180, depthParts: [95, 87] }), env);
    expect(bad.status).toBe(400);
  });
});
