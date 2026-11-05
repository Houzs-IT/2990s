-- 0223 — POS Marketing: the Sofa Accessory pieces placed on a sofa's layout.
--
-- 2026-11-05 (YH: "Marketing display not aligned with pos portal: sofa
-- accessories not in view when designing a custom build"). The Marketing
-- builder is the POS Custom build canvas (0220), and now offers the same Sofa
-- Accessories the POS does — back cushions, sand backs, extra arms. The pieces
-- are kept beside the layout they hang on, in the Custom build's own shape
-- (apps/pos/src/lib/sofa-accessories.ts PlacedAccessory, without a colour):
--
-- [{ "id": "…", "modelId": "<accessory Model id>", "cellId": "<layout cell id>", "slot": 0 }, …]
--
-- The API checks each piece's shape and keeps only those whose cellId is on
-- the layout (routes/marketing.ts, sofaPiece). null = none placed, or a record
-- saved before this. A combo on the reference price list carries its own
-- pieces inside combo_rows (jsonb already, no column needed). Arrive carries
-- the pieces onto the display it creates, as it carries `layout`.
--
-- Must be applied BEFORE the API that selects `accessories` is deployed.
--
-- Reverse (restore 0220's function first, then):
--   ALTER TABLE marketing_displays        DROP CONSTRAINT IF EXISTS marketing_displays_accessories_chk,        DROP COLUMN IF EXISTS accessories;
--   ALTER TABLE marketing_launch_requests DROP CONSTRAINT IF EXISTS marketing_launch_requests_accessories_chk, DROP COLUMN IF EXISTS accessories;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_launch_requests ADD COLUMN IF NOT EXISTS accessories jsonb;
ALTER TABLE marketing_displays        ADD COLUMN IF NOT EXISTS accessories jsonb;

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_accessories_chk
    CHECK (accessories IS NULL OR jsonb_typeof(accessories) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_accessories_chk
    CHECK (accessories IS NULL OR jsonb_typeof(accessories) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Arrive, now carrying the pieces too ──────────────────────────────────────
-- 0220's function plus `accessories` onto the display.
CREATE OR REPLACE FUNCTION public.marketing_arrive_launch_request(
  p_request_id uuid,
  p_by         text,
  p_by_name    text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r            marketing_launch_requests%ROWTYPE;
  old_name     text;
  new_id       uuid;
BEGIN
  SELECT * INTO r FROM marketing_launch_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'request_not_completed' USING ERRCODE = 'P0001';
  END IF;

  IF r.action = 'replace' AND r.replace_display_id IS NOT NULL THEN
    UPDATE marketing_displays
       SET removed_at = now(), removed_by = p_by, removed_by_name = p_by_name
     WHERE id = r.replace_display_id AND removed_at IS NULL
     RETURNING name INTO old_name;
  END IF;

  INSERT INTO marketing_displays (
    venue_id, type, name, code, is_new,
    fabric, colour, leg, seat, modules, layout, accessories, size, height, divan, gap,
    length_cm, width_cm, sofa_category, sofa_function,
    source_request_id, created_by, created_by_name
  ) VALUES (
    r.venue_id, r.type, r.model, r.supplier_code, true,
    r.fabric, r.colour, r.leg, r.seat, r.modules, r.layout, r.accessories, r.size, r.height, r.divan, r.gap,
    r.length_cm, r.width_cm, r.sofa_category, r.sofa_function,
    r.id, p_by, p_by_name
  ) RETURNING id INTO new_id;

  UPDATE marketing_launch_requests
     SET status = 'arrived', arrived_at = now(), arrived_by = p_by,
         arrived_by_name = p_by_name, arrived_display_id = new_id, updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('displayId', new_id, 'removedName', old_name);
END;
$$;

-- CREATE OR REPLACE keeps the grants; restated so this file stands on its own.
REVOKE ALL ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_arrive_launch_request(uuid, text, text) TO service_role;
