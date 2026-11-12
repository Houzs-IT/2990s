-- 2990-0058 — repair the EMBRACE KN codes in the 2990s database ONLY.
--
-- What happened: after the step 2 run and the step 3 rollback, the rows that
-- existed before 12 Nov sit two rollback-steps past their original code
-- (Navy KN03 → KN01, Shadow KN02 → KN12, Aegean KN01 → KN11). The 4 display
-- rows made on 12 Nov 17:35–17:38 MYT got only the rollback and are correct.
-- So the old rows are put forward two steps of the step 2 map (A applied
-- twice), and the new rows are left alone.
--
-- 2990s Supabase SQL editor only. The editor shows only the LAST result, so:
-- select and run each Part 1 query on its own first; then run the whole file.
-- Part 2 is one transaction: it changes nothing unless every check passes.
-- A second run refuses ("already repaired") and changes nothing.

-- ═══ Part 1 — read only: the state now ═══════════════════════════════════
-- "ok" = the code matches the colour name under the ORIGINAL codes.
WITH orig(code, colour) AS (VALUES
  ('KN01','Aegean'), ('KN02','Shadow'), ('KN03','Navy'),   ('KN04','Nobel'),
  ('KN05','Grey'),   ('KN06','Pearl'),  ('KN07','Sand'),   ('KN08','Velvet'),
  ('KN09','Desert'), ('KN10','Teal'),   ('KN11','Caramel'),('KN12','Forest'),
  ('KN13','Rosewood'))
SELECT 'marketing_displays' AS tbl, d.id::text, d.name AS what, d.fabric, d.colour,
       o.colour AS colour_of_code, lower(trim(d.colour)) = lower(o.colour) AS ok,
       d.created_at, d.created_by_name AS by
  FROM public.marketing_displays d LEFT JOIN orig o ON o.code = d.fabric
 WHERE d.fabric ~ '^KN(0[1-9]|1[0-3])$'
UNION ALL
SELECT 'marketing_launch_requests', r.id::text, r.status::text, r.fabric, r.colour,
       o.colour, lower(trim(r.colour)) = lower(o.colour), r.created_at, NULL
  FROM public.marketing_launch_requests r LEFT JOIN orig o ON o.code = r.fabric
 WHERE r.fabric ~ '^KN(0[1-9]|1[0-3])$'
ORDER BY 1, 8;

SELECT id, flag_type, ref, label, bonus_centi, active, effective_from, created_at, updated_at
  FROM public.hr_item_kpi
 WHERE ref ~ '^KN(0[1-9]|1[0-3])$' OR label ~ '\mKN(0[1-9]|1[0-3])\M'
 ORDER BY ref;

-- ═══ Part 2 — the repair, one transaction ════════════════════════════════
DROP TABLE IF EXISTS kn_repair_log;
CREATE TEMP TABLE kn_repair_log (tbl text, rows_changed int, note text);

BEGIN;

CREATE TEMP TABLE kn_fix ON COMMIT DROP AS
SELECT * FROM (VALUES
  -- code now → original code (the step 2 map applied twice), original colour of the result
  ('KN01','KN03','Navy'),   ('KN02','KN05','Grey'),    ('KN03','KN08','Velvet'),
  ('KN04','KN07','Sand'),   ('KN05','KN06','Pearl'),   ('KN06','KN09','Desert'),
  ('KN07','KN13','Rosewood'),('KN08','KN12','Forest'), ('KN09','KN10','Teal'),
  ('KN10','KN04','Nobel'),  ('KN11','KN01','Aegean'),  ('KN12','KN02','Shadow'),
  ('KN13','KN11','Caramel')) v(now_code, orig_code, orig_colour);

CREATE TEMP TABLE kn_orig ON COMMIT DROP AS
SELECT orig_code AS code, orig_colour AS colour FROM kn_fix;

DO $$
DECLARE n int; bad text;
BEGIN
  IF to_regclass('public.campaign_promos') IS NULL THEN
    RAISE EXCEPTION 'Not the 2990s database — stopped, nothing changed.';
  END IF;

  -- The witness: Vivian's 4 display rows (YH's paste, 12 Nov). Wrong now → repair.
  -- Already at the original codes → this ran before; stop. Anything else → stop.
  SELECT count(*) INTO n FROM public.marketing_displays d
    JOIN (VALUES ('1d4c82f7-9cda-40ab-9f98-e10a17e8f3ec','KN01'), ('c26bb122-1137-4328-8767-c597eedebca8','KN12'),
                 ('192141de-5b0f-41a9-85b4-fc716b6eda66','KN11'), ('e0c6cabd-c2f8-4268-a533-1454bd204d67','KN11')) w(id, code)
      ON d.id::text = w.id AND d.fabric = w.code;
  IF n <> 4 THEN
    SELECT count(*) INTO n FROM public.marketing_displays d
      JOIN (VALUES ('1d4c82f7-9cda-40ab-9f98-e10a17e8f3ec','KN03'), ('c26bb122-1137-4328-8767-c597eedebca8','KN02'),
                   ('192141de-5b0f-41a9-85b4-fc716b6eda66','KN01'), ('e0c6cabd-c2f8-4268-a533-1454bd204d67','KN01')) w(id, code)
        ON d.id::text = w.id AND d.fabric = w.code;
    IF n = 4 THEN RAISE EXCEPTION 'Already repaired — nothing changed.'; END IF;
    RAISE EXCEPTION 'The 4 witness display rows are not in the state YH pasted on 12 Nov — stopped, nothing changed.';
  END IF;

  -- hr_item_kpi has no colour to check against, so only rows that existed
  -- before 12 Nov are moved; a KN row made on 12 Nov or later stops the run.
  SELECT string_agg(ref, ', ') INTO bad FROM public.hr_item_kpi
   WHERE ref ~ '^KN(0[1-9]|1[0-3])$' AND created_at >= '2026-11-12 00:00+08';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'hr_item_kpi rows created on/after 12 Nov (%) — their state is unknown; stopped, nothing changed.', bad;
  END IF;

  -- 1. Displays: the 4 witness rows only.
  UPDATE public.marketing_displays d SET fabric = f.orig_code
    FROM kn_fix f
   WHERE d.fabric = f.now_code
     AND d.id::text IN ('1d4c82f7-9cda-40ab-9f98-e10a17e8f3ec','c26bb122-1137-4328-8767-c597eedebca8',
                        '192141de-5b0f-41a9-85b4-fc716b6eda66','e0c6cabd-c2f8-4268-a533-1454bd204d67');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO kn_repair_log VALUES ('marketing_displays', n, 'the 4 rows by id');

  -- 2. Launch requests: a row whose code disagrees with its colour now, and
  --    agrees once moved forward two steps.
  UPDATE public.marketing_launch_requests r SET fabric = f.orig_code
    FROM kn_fix f
   WHERE r.fabric = f.now_code
     AND lower(trim(r.colour)) = lower(f.orig_colour)
     AND NOT EXISTS (SELECT 1 FROM kn_orig o WHERE o.code = r.fabric AND lower(o.colour) = lower(trim(r.colour)));
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO kn_repair_log VALUES ('marketing_launch_requests', n, 'moved where the colour then matches');

  -- 3. hr_item_kpi: every KN row (all made before 12 Nov — checked above).
  --    ref is the code; label moves too where it IS the code. One statement,
  --    so the 13-way swap never meets itself half-done.
  UPDATE public.hr_item_kpi k
     SET ref   = f.orig_code,
         label = CASE WHEN k.label = k.ref THEN f.orig_code ELSE k.label END
    FROM kn_fix f
   WHERE k.ref = f.now_code;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO kn_repair_log VALUES ('hr_item_kpi', n, 'ref (and label where it equals ref)');

  -- After-check: every display / launch row with a KN code and one of the 13
  -- colour names must now match under the original codes.
  SELECT string_agg(format('%s %s %s', t, fabric, colour), '; ') INTO bad FROM (
    SELECT 'display' t, fabric, colour FROM public.marketing_displays
    UNION ALL SELECT 'launch', fabric, colour FROM public.marketing_launch_requests) x
   WHERE fabric ~ '^KN(0[1-9]|1[0-3])$'
     AND EXISTS (SELECT 1 FROM kn_orig o WHERE lower(o.colour) = lower(trim(x.colour)))
     AND NOT EXISTS (SELECT 1 FROM kn_orig o WHERE o.code = x.fabric AND lower(o.colour) = lower(trim(x.colour)));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Code and colour still disagree (%) — rolled back, nothing changed.', bad;
  END IF;
END $$;

COMMIT;

-- What changed. Empty, or an error above, means nothing changed.
SELECT * FROM kn_repair_log;
