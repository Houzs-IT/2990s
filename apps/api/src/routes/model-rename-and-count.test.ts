// 2990-0022 — after a Model rename (8210 → TANNAH):
//  (1) GET /mfg-products returns the live name as model_name (base_model stays the code);
//  (2) GET /product-models counts SKUs past PostgREST's 1000-row cap.
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../env';

vi.mock('../middleware/auth', () => ({
  supabaseAuth: async (_c: any, next: any) => { await next(); },
}));

import { mfgProducts } from './mfg-products';
import { productModels } from './product-models';

type Row = Record<string, unknown>;
class Q {
  private preds: Array<(r: Row) => boolean> = [];
  private r: [number, number] | null = null;
  constructor(private rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  not() { return this; }
  eq(col: string, val: unknown) { this.preds.push((x) => String(x[col]) === String(val)); return this; }
  in(col: string, vals: unknown[]) { this.preds.push((x) => vals.map(String).includes(String(x[col]))); return this; }
  range(a: number, b: number) { this.r = [a, b]; return this; }
  then(res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) {
    const hit = this.rows.filter((x) => this.preds.every((p) => p(x)));
    // PostgREST answers at most 1000 rows to a request with no range
    const out = this.r ? hit.slice(this.r[0], this.r[1] + 1) : hit.slice(0, 1000);
    return Promise.resolve({ data: out, error: null as null }).then(res, rej);
  }
}

function appWith(tables: Record<string, Row[]>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('supabase', { from: (t: string) => new Q(tables[t] ?? []) } as any);
    await next();
  });
  app.route('/mfg-products', mfgProducts);
  app.route('/product-models', productModels);
  return app;
}

describe('Model rename', () => {
  it('GET /mfg-products carries the live model name and keeps base_model as the code', async () => {
    const app = appWith({
      mfg_products: [{ id: 'a', code: '8210-4FT', status: 'ACTIVE', base_model: '8210', model: { name: 'TANNAH', allowed_options: null } }],
    });
    const res = await app.request('/mfg-products');
    const [p] = ((await res.json()) as { products: Row[] }).products;
    expect(p?.model_name).toBe('TANNAH');
    expect(p?.base_model).toBe('8210');
  });

  it('GET /product-models counts SKUs that sit past the first 1000 rows', async () => {
    const skus: Row[] = [];
    for (let i = 0; i < 1500; i++) skus.push({ id: `b${i}`, model_id: 'big' });
    for (const id of ['t1', 't2', 't3']) skus.push({ id, model_id: 'tannah' });
    const app = appWith({
      product_models: [{ id: 'big', category: 'SOFA' }, { id: 'tannah', category: 'SOFA' }],
      mfg_products: skus,
    });
    const res = await app.request('/product-models');
    const out = ((await res.json()) as { models: Array<{ id: string; sku_count: number }> }).models;
    expect(out.find((m) => m.id === 'big')!.sku_count).toBe(1500);
    expect(out.find((m) => m.id === 'tannah')!.sku_count).toBe(3);
  });
});
