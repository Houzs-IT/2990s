// Local-simulation stand-ins for 2990's /commission API — the OPEX ▸ Commission
// page, so its Setup tab (KPI items, quantity tiers) can be reviewed without a
// live system. Fictional data only. Never calls fetch. Open it as the director
// persona: localStorage['2990:simulation:persona'] = 'director'.
//
// The KPI rules are checked with the SAME qtyTiersError the API uses, so a
// ladder the simulation accepts is one production would accept.

import { MAX_KPI_QTY_TIERS, qtyTiersError, sortedQtyTiers, type KpiQtyTier } from '@2990s/shared/hr-commission';

const KEY = '2990:mobile-simulation:commission:v1';

type Row = Record<string, any>;
interface CommissionStore { items: Row[]; serial: number }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-pos-simulation': 'local-only' },
});
const failure = (error: string, reason: string, status = 400) => json({ error, reason }, status);

const rule = (id: string, over: Row): Row => ({
  id, flagType: 'fabric', ref: '', refs: [], label: '', bonusCenti: 5_000, qtyTiers: [],
  countsAsRevenue: false, effectiveFrom: null, active: true, ...over,
});

/* A flat series rule, the owner's tiered example, a rule whose code no longer
   exists (as the KN rules after Houzs's 11-13 rename), and a switched-off
   "earns both" add-on — every state the Setup list draws. */
const seed = (): CommissionStore => ({
  serial: 4,
  items: [
    rule('sim-kpi-1', { ref: 'CG', label: 'CG', bonusCenti: 5_000, effectiveFrom: '2026-10-01' }),
    rule('sim-kpi-2', {
      ref: 'EZ', label: 'EZ', bonusCenti: 4_000,
      qtyTiers: [{ aboveQty: 5, bonusCenti: 5_000 }, { aboveQty: 10, bonusCenti: 6_000 }],
    }),
    rule('sim-kpi-3', { ref: 'KN01', label: 'KN01', bonusCenti: 12_500, effectiveFrom: '2026-10-01' }),
    rule('sim-kpi-4', {
      flagType: 'special', ref: 'SOFA-FULL', label: 'Sofa Full Fabric', countsAsRevenue: true, active: false,
    }),
  ],
});

let memory: CommissionStore | undefined;
const load = (): CommissionStore => {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as CommissionStore) : seed();
  } catch { memory = seed(); }
  return memory;
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* storage full or blocked */ } };

export const resetCommissionSimulation = () => {
  memory = seed();
  try { localStorage.removeItem(KEY); } catch { /* blocked */ }
};

const CONFIG = {
  baseBps: 100, personalKpiThresholdCenti: 10_000_000, personalKpiBonusBps: 50,
  showroomKpiThresholdCenti: 40_000_000, showroomKpiBonusBps: 50,
  overrideBaseBps: 50, overrideKpiBonusBps: 50, overrideMode: 'showroom', updatedAt: '2026-11-01T00:00:00.000Z',
};
const PROFILES = [{
  id: 'sim-profile-1', staffId: 'demo-sales', staffName: 'Demo Sales', staffCode: 'DEMO',
  tier: 'sales', showroomId: 'demo-venue', showroomName: 'Demo Showroom', active: true,
}];

const tiersOf = (raw: unknown): KpiQtyTier[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_KPI_QTY_TIERS) return null;
  return raw.map((t) => ({ aboveQty: Number(t?.aboveQty), bonusCenti: Number(t?.bonusCenti) }));
};

export function commissionDispatch(path: string, method: string, body: Row): Response | null {
  if (path !== '/commission' && !path.startsWith('/commission/')) return null;
  const sub = path.slice('/commission'.length) || '/';
  const store = load();

  if (sub === '/config' && method === 'GET') return json({ config: CONFIG });
  if (sub === '/profiles' && method === 'GET') return json({ profiles: PROFILES });
  if (sub === '/override-levels' && method === 'GET') return json({ levels: [] });
  if (sub === '/payout/periods' && method === 'GET') return json({ periods: [] });

  if (sub === '/item-kpi' && method === 'GET') return json({ items: store.items });

  if (sub === '/item-kpi' && method === 'POST') {
    const tiers = tiersOf(body.qtyTiers ?? []);
    const bonusCenti = Number(body.bonusCenti);
    if (!body.ref || !Number.isInteger(bonusCenti) || bonusCenti < 0 || !tiers) {
      return failure('validation_failed', 'The simulated API expected a ref, an amount and a tier list.');
    }
    const wrong = qtyTiersError(bonusCenti, tiers);
    if (wrong) return failure('invalid_tiers', wrong);
    const item = rule(`sim-kpi-${++store.serial}`, {
      flagType: body.flagType, ref: body.ref, refs: [...new Set((body.refs ?? []) as string[])],
      label: body.label ?? '', bonusCenti, qtyTiers: sortedQtyTiers(tiers),
      countsAsRevenue: !!body.countsAsRevenue, effectiveFrom: body.effectiveFrom ?? null,
    });
    store.items.push(item);
    save();
    return json({ item }, 201);
  }

  const one = /^\/item-kpi\/([^/]+)$/.exec(sub);
  if (one) {
    const item = store.items.find((i) => i.id === one[1]);
    if (!item) return failure('not_found', 'No such simulated KPI item.', 404);
    if (method === 'DELETE') {
      store.items = store.items.filter((i) => i !== item);
      save();
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const tiers = body.qtyTiers === undefined ? item.qtyTiers as KpiQtyTier[] : tiersOf(body.qtyTiers);
      const bonusCenti = body.bonusCenti === undefined ? item.bonusCenti as number : Number(body.bonusCenti);
      if (!tiers) return failure('validation_failed', 'The simulated API expected a tier list.');
      const wrong = qtyTiersError(bonusCenti, tiers);
      if (wrong) return failure('invalid_tiers', wrong);
      Object.assign(item, {
        bonusCenti, qtyTiers: sortedQtyTiers(tiers),
        ...(body.countsAsRevenue === undefined ? {} : { countsAsRevenue: !!body.countsAsRevenue }),
        ...(body.effectiveFrom === undefined ? {} : { effectiveFrom: body.effectiveFrom }),
        ...(body.active === undefined ? {} : { active: !!body.active }),
      });
      save();
      return json({ item });
    }
  }
  return failure('simulation_route_missing', `${method} ${path} has not been implemented.`, 501);
}
