import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

/* /commission/item-kpi since 0227 (owner 2026-11-15): quantity tiers, rules
   over several refs, and a start date set at creation. The route runs on the
   service-role client, so the schemas and qtyTiersError are the whole boundary
   between a typo and a payroll figure — pin what they refuse and what reaches
   the table. */

const state = vi.hoisted(() => ({
  maybe: null as Record<string, unknown> | null,
  single: null as Record<string, unknown> | null,
  list: [] as Record<string, unknown>[],
  error: null as { message: string; code?: string } | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  selects: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const obj: any = {};
      obj.select = (cols: string) => { state.selects.push(cols); return obj; };
      for (const m of ['order', 'eq', 'limit', 'delete']) obj[m] = () => obj;
      obj.insert = (p: Record<string, unknown>) => { state.inserted = p; return obj; };
      obj.update = (p: Record<string, unknown>) => { state.updated = p; return obj; };
      obj.single = async () => ({ data: state.single, error: state.error });
      obj.maybeSingle = async () => ({ data: state.maybe, error: state.error });
      obj.then = (resolve: any) => resolve({ data: state.list, error: state.error });
      return obj;
    },
  }),
}));

import { commission } from './commission';

const env = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  HOUZS_API_ROOT: 'https://houzs.test/api',
  HOUZS_COMPANY_ID: '2',
} as unknown as Env;

const app = () => {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.route('/commission', commission);
  return a;
};

const MANAGER = { id: 9, name: 'Owner', permissions: ['scm.hr.read', 'scm.hr.manage'], capabilities: {} };
const READER = { id: 10, name: 'Reader', permissions: ['scm.hr.read'], capabilities: {} };
const meIs = (user: Record<string, unknown>) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })));
};

const send = (method: string, path: string, body: unknown) =>
  app().request(`/commission${path}`, {
    method,
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, env);

/** The row the table hands back after a write. */
const STORED = {
  id: 'r1', flag_type: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-FL'], label: 'MONZA',
  bonus_centi: 4_000, qty_tiers: [{ aboveQty: 5, bonusCenti: 5_000 }],
  counts_as_revenue: false, effective_from: '2026-11-01', active: true,
};

beforeEach(() => {
  state.maybe = null; state.single = STORED; state.list = []; state.error = null;
  state.inserted = null; state.updated = null; state.selects = [];
  meIs(MANAGER);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('GET /item-kpi', () => {
  it('returns refs and tiers, whitelisted and in quantity order', async () => {
    meIs(READER);
    state.list = [{
      ...STORED,
      qty_tiers: [
        { aboveQty: 10, bonusCenti: 6_000, extra: 'dropped' },
        { aboveQty: 5, bonusCenti: 5_000 },
        { aboveQty: 0, bonusCenti: 1 }, // malformed — never reaches the engine
      ],
    }, {
      // a pre-0227 row as the table now holds it: the column defaults
      id: 'r2', flag_type: 'fabric', ref: 'D', refs: [], label: 'D', bonus_centi: 5_000, qty_tiers: [],
      counts_as_revenue: false, effective_from: null, active: true,
    }];
    const res = await app().request('/commission/item-kpi', { headers: { authorization: 'Bearer tok' } }, env);
    expect(res.status).toBe(200);
    const { items } = await res.json() as { items: Array<Record<string, unknown>> };
    expect(items[0]).toMatchObject({
      refs: ['MONZA-HL', 'MONZA-FL'],
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
      effectiveFrom: '2026-11-01',
    });
    expect(items[1]).toMatchObject({ ref: 'D', refs: [], qtyTiers: [], effectiveFrom: null });
    expect(state.selects[0]).toContain('qty_tiers');
    expect(state.selects[0]).toContain('refs');
  });
});

describe('POST /item-kpi', () => {
  const NEW = {
    flagType: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-FL', 'MONZA-HL'], label: 'MONZA',
    bonusCenti: 4_000, effectiveFrom: '2026-11-01',
    qtyTiers: [{ aboveQty: 10, bonusCenti: 6_000 }, { aboveQty: 5, bonusCenti: 5_000 }],
  };

  it('stores the series refs de-duplicated, the tiers in order and the start date', async () => {
    const res = await send('POST', '/item-kpi', NEW);
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      flag_type: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-FL'],
      bonus_centi: 4_000, effective_from: '2026-11-01', counts_as_revenue: false,
      qty_tiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
    });
  });

  it('a rule with no tiers, refs or date stores the pre-0227 shape', async () => {
    const res = await send('POST', '/item-kpi', { flagType: 'special', ref: 'Latex Seat', bonusCenti: 5_000 });
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({ refs: [], qty_tiers: [], effective_from: null });
  });

  it('refuses a step that pays less than the one below it — and writes nothing', async () => {
    const res = await send('POST', '/item-kpi', { ...NEW, qtyTiers: [{ aboveQty: 5, bonusCenti: 500 }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_tiers', reason: expect.stringMatching(/must pay more/) });
    expect(state.inserted).toBeNull();
  });

  it('refuses two steps at one quantity', async () => {
    const res = await send('POST', '/item-kpi', {
      ...NEW, qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 5, bonusCenti: 6_000 }],
    });
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('refuses a malformed step and a malformed date at the schema', async () => {
    expect((await send('POST', '/item-kpi', { ...NEW, qtyTiers: [{ aboveQty: 0, bonusCenti: 5_000 }] })).status).toBe(400);
    expect((await send('POST', '/item-kpi', { ...NEW, qtyTiers: [{ aboveQty: 2.5, bonusCenti: 5_000 }] })).status).toBe(400);
    expect((await send('POST', '/item-kpi', { ...NEW, effectiveFrom: '1/11/2026' })).status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('is a manager-only write', async () => {
    meIs(READER);
    const res = await send('POST', '/item-kpi', NEW);
    expect(res.status).toBe(403);
    expect(state.inserted).toBeNull();
  });
});

describe('PATCH /item-kpi/:id', () => {
  it('checks new tiers against the stored base', async () => {
    state.maybe = { bonus_centi: 4_000, qty_tiers: [] };
    const res = await send('PATCH', '/item-kpi/r1', { qtyTiers: [{ aboveQty: 5, bonusCenti: 3_000 }] });
    expect(res.status).toBe(400);
    expect(state.updated).toBeNull();
  });

  it('checks a new base against the stored tiers — raising it past a step is refused', async () => {
    state.maybe = { bonus_centi: 4_000, qty_tiers: [{ aboveQty: 5, bonusCenti: 5_000 }] };
    const res = await send('PATCH', '/item-kpi/r1', { bonusCenti: 5_500 });
    expect(res.status).toBe(400);
    expect(state.updated).toBeNull();
  });

  it('saves tiers, the base and the start date together', async () => {
    state.maybe = { bonus_centi: 4_000, qty_tiers: [] };
    const res = await send('PATCH', '/item-kpi/r1', {
      bonusCenti: 4_500, effectiveFrom: null,
      qtyTiers: [{ aboveQty: 10, bonusCenti: 6_000 }, { aboveQty: 5, bonusCenti: 5_000 }],
    });
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({
      bonus_centi: 4_500, effective_from: null,
      qty_tiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
    });
  });

  it('never re-aims a rule: ref and refs are not patchable', async () => {
    state.maybe = STORED;
    const res = await send('PATCH', '/item-kpi/r1', { active: false, ref: 'EM', refs: ['EM'] });
    expect(res.status).toBe(200);
    expect(state.updated).not.toHaveProperty('ref');
    expect(state.updated).not.toHaveProperty('refs');
    expect(state.updated).toMatchObject({ active: false });
  });

  it('404s an unknown rule before judging its tiers', async () => {
    state.maybe = null;
    const res = await send('PATCH', '/item-kpi/nope', { qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }] });
    expect(res.status).toBe(404);
  });
});
