-- 0224 — POS Marketing: a sofa length typed as parts (x + y = length).
--
-- 2026-11-05 (YH: "Partial length (eg length is composed using x + y = length)
-- AND edit values in the add custom build side"; "the + button is for them to
-- type the length of parts separately ... allow them to choose whether x+y or
-- total"). Next to a length input, "+" splits it into parts; the record keeps
-- the parts and whether to print them.
--
--   length_parts       whole cm, 2 to 6 parts, each 1–1000; NULL = typed as one
--                      number. The parts ADD UP TO the length they describe:
--                        launch request → length_cm
--                        display        → dims_width_cm when set, else length_cm
--                      The API enforces the sum (routes/marketing.ts); a CHECK
--                      cannot (no subquery), so only the shape is checked here.
--   length_show_parts  print "120 + 100 = 220" instead of "220".
--
-- Arrive carries both from the request onto the display it creates (its
-- dims_width_cm is NULL there, so the parts describe length_cm, as on the
-- request).
--
-- Must be applied BEFORE the API that selects these columns is deployed.
--
-- Reverse (restore 0223's function first, then):
--   ALTER TABLE marketing_displays        DROP CONSTRAINT IF EXISTS marketing_displays_length_parts_chk,        DROP COLUMN IF EXISTS length_parts, DROP COLUMN IF EXISTS length_show_parts;
--   ALTER TABLE marketing_launch_requests DROP CONSTRAINT IF EXISTS marketing_launch_requests_length_parts_chk, DROP COLUMN IF EXISTS length_parts, DROP COLUMN IF EXISTS length_show_parts;
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE marketing_launch_requests
  ADD COLUMN IF NOT EXISTS length_parts      integer[],
  ADD COLUMN IF NOT EXISTS length_show_parts boolean NOT NULL DEFAULT false;
ALTER TABLE marketing_displays
  ADD COLUMN IF NOT EXISTS length_parts      integer[],
  ADD COLUMN IF NOT EXISTS length_show_parts boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE marketing_launch_requests
    ADD CONSTRAINT marketing_launch_requests_length_parts_chk
    CHECK (length_parts IS NULL OR (cardinality(length_parts) BETWEEN 2 AND 6
      AND array_position(length_parts, NULL) IS NULL
      AND 1 <= ALL(length_parts) AND 1000 >= ALL(length_parts)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing_displays
    ADD CONSTRAINT marketing_displays_length_parts_chk
    CHECK (length_parts IS NULL OR (cardinality(length_parts) BETWEEN 2 AND 6
      AND array_position(length_parts, NULL) IS NULL
      AND 1 <= ALL(length_parts) AND 1000 >= ALL(length_parts)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Arrive, now carrying the length parts too ────────────────────────────────
-- 0223's function plus length_parts / length_show_parts onto the display.
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
    length_cm, width_cm, length_parts, length_show_parts, sofa_category, sofa_function,
    source_request_id, created_by, created_by_name
  ) VALUES (
    r.venue_id, r.type, r.model, r.supplier_code, true,
    r.fabric, r.colour, r.leg, r.seat, r.modules, r.layout, r.accessories, r.size, r.height, r.divan, r.gap,
    r.length_cm, r.width_cm, r.length_parts, r.length_show_parts, r.sofa_category, r.sofa_function,
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
