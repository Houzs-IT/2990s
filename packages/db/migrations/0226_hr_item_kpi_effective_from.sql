-- 0226 — item-KPI rules get a start date.
--
-- 2026-11-09 (YH, 2990-0043): no payout period has ever been closed
-- (hr_payout_periods is empty), so every month is recomputed with the CURRENT
-- rules. The BROWNIE / KN01–KN13 fabric rules added on 9 Nov therefore also
-- paid August and September. They should pay from October.
--
--   effective_from  date, NULL = the rule has always applied (D and EZ keep
--                   paying exactly as before). Set = the rule pays only on an
--                   SO whose so_date is on or after it — both the bonus and the
--                   goods exclusion (POS commission-engine.ts, flagsInForce).
--
-- Must be applied BEFORE the API that selects this column is deployed:
-- GET /commission/item-kpi selects it, and the POS Commission screen fails
-- until it exists.
--
-- Reverse:
--   ALTER TABLE public.hr_item_kpi DROP COLUMN IF EXISTS effective_from;

ALTER TABLE public.hr_item_kpi ADD COLUMN IF NOT EXISTS effective_from date;

COMMENT ON COLUMN public.hr_item_kpi.effective_from IS
  'First so_date the rule pays on. NULL = always applied. (0226, 2026-11-09)';
