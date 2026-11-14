-- 0227 — item-KPI rules get quantity tiers, and one rule can cover several refs.
--
-- 2026-11-15 (owner): "我要能做到一个 function，它可以 by tiering … 这个 item
-- 卖超过 5 个的话，本来是 40 块就会变成 50 块；超过 10 个 item 的话，50 块就会
-- 变成 60 块". Ruled the same day: ALL-UNITS — once a salesperson's units
-- under a rule pass a step in the period, every one of those units pays the
-- step's amount (12 sold → 12 × RM 60).
--
--   qty_tiers  jsonb array of {"aboveQty": int >= 1, "bonusCenti": int > 0},
--              the steps above bonus_centi. '[]' = a flat rule, which is every
--              row written before this migration. Validated by the API
--              (qtyTiersError in @2990s/shared/hr-commission); the CHECK here
--              only keeps the column an array.
--
--   refs       text[] — everything the rule pays on. A named fabric series
--              (EMBRACE, MONZA …) can span several fabric_library ids, and its
--              tiers must count them as ONE rule. '{}' = just `ref`, which is
--              every row written before this migration.
--
-- Additive with defaults: the API deployed before this one selects explicit
-- columns and never sees these, so applying this first changes nothing live.
-- It MUST be applied before the API that selects them is deployed —
-- GET /commission/item-kpi selects both, and the POS Commission screen fails
-- until they exist.
--
-- Reverse:
--   ALTER TABLE public.hr_item_kpi DROP CONSTRAINT IF EXISTS hr_item_kpi_qty_tiers_array_chk;
--   ALTER TABLE public.hr_item_kpi DROP COLUMN IF EXISTS qty_tiers;
--   ALTER TABLE public.hr_item_kpi DROP COLUMN IF EXISTS refs;

ALTER TABLE public.hr_item_kpi
  ADD COLUMN IF NOT EXISTS refs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qty_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.hr_item_kpi
    ADD CONSTRAINT hr_item_kpi_qty_tiers_array_chk
    CHECK (jsonb_typeof(qty_tiers) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.hr_item_kpi.refs IS
  'Everything the rule pays on when more than ref (a fabric series over several library ids). Empty = [ref]. (0227, 2026-11-15)';
COMMENT ON COLUMN public.hr_item_kpi.qty_tiers IS
  'Quantity steps [{aboveQty, bonusCenti}]: more than aboveQty units in the period pays bonusCenti on every unit. Empty = flat. (0227, 2026-11-15)';
