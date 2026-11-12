-- 2990-0058 — EMBRACE KN renumber, step 2 of 3: APPLY. ONE-WAY DOOR for
-- anything outside the database (see the PR). Rollback = step 3.
--
-- YH 2026-11-12: "EM-01 pearl = alta-01 = KN-01 ... it's a code inconsistency"
-- → renumber the KN codes so the KN number is the swatch card's EM number.
-- Each colour keeps its name, stock, price tier and order history; only its
-- code moves:
--   KN06→KN01 Pearl    KN07→KN02 Sand     KN09→KN03 Desert   KN08→KN04 Velvet
--   KN13→KN05 Rosewood KN11→KN06 Caramel  KN12→KN07 Forest   KN10→KN08 Teal
--   KN01→KN09 Aegean   KN03→KN10 Navy     KN05→KN11 Grey     KN04→KN12 Nobel
--   KN02→KN13 Shadow
--
-- Run in BOTH databases (it detects which it is in): Houzs first, then 2990s.
-- Run step 1 (discover) first and have its output reviewed: this script
-- rewrites ONLY the columns on the reviewed list below, and REFUSES (rolls
-- back, changes nothing) while any other column holds a KN01..KN13 value.
--
-- What it rewrites: whole values — a text column equal to 'KN01', a json
-- string "KN01" (value or key), an array element 'KN01' — and, while the
-- SWITCH below is 'on' (the default), the codes inside free text on the
-- order lines and their snapshots. History stays as printed: the SO audit log
-- and the scanned-paper tables are never touched.
-- Houzs: company 2 rows only. 2990s: every row (single company).
--
-- How: one transaction, two passes (KNxx → zzKNRENUMxx → new KNxx), so the
-- 13-way swap never meets a unique key half-done. Before COMMIT it checks
-- every EMBRACE Fabric Converter row's KN number equals its EM number, and
-- every colour row's name matches its new code; any mismatch rolls it all
-- back. Triggers on the touched tables DO fire (updated_at, audit).

BEGIN;

-- ═══════════════════════════════ SWITCH ════════════════════════════════
-- 'on' (default — YH 12 Nov, after reading step 1b: old orders show the new
--       code): ALSO renumber KN codes inside the free text listed in kn_free
--       below — description2 and the text inside the json (a "summary" of
--       "EMBRACE/KN07 Sand", an MRP "variantLabel" of "KN07 Sand / SEAT 28").
--       Houzs, company 2 only, whole tokens only ("KN01", "KN-01"; never
--       "KN013", "KN01A"). A supplier code such as "(KN10-2)" WOULD be
--       renumbered too; step 1b found none on 12 Nov.
-- 'off': free text keeps the old code as printed; only whole values move.
-- The rollback must use the same setting.
CREATE TEMP TABLE kn_switch ON COMMIT DROP AS
SELECT 'on'::text AS renumber_free_text;   -- ← 'on' or 'off'
-- ═══════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE kn_map (old_code text PRIMARY KEY, new_code text UNIQUE, colour text) ON COMMIT DROP;
INSERT INTO kn_map VALUES
  ('KN06','KN01','Pearl'),  ('KN07','KN02','Sand'),    ('KN09','KN03','Desert'),
  ('KN08','KN04','Velvet'), ('KN13','KN05','Rosewood'),('KN11','KN06','Caramel'),
  ('KN12','KN07','Forest'), ('KN10','KN08','Teal'),    ('KN01','KN09','Aegean'),
  ('KN03','KN10','Navy'),   ('KN05','KN11','Grey'),    ('KN04','KN12','Nobel'),
  ('KN02','KN13','Shadow');

-- The reviewed list: (database, table, column) — from step 1's output, run
-- by YH on 12 Nov 2026 in both databases. Every listed Houzs table has
-- company_id. A listed column that does not exist is skipped and reported.
CREATE TEMP TABLE kn_target (db text, tbl text, col text) ON COMMIT DROP;
INSERT INTO kn_target VALUES
  -- Houzs (schema scm, company 2): the colour itself …
  ('houzs','fabric_colours','fabric_id'),   ('houzs','fabric_colours','colour_id'),
  ('houzs','fabric_library','id'),          ('houzs','fabric_library','label'),
  ('houzs','fabric_trackings','id'),        ('houzs','fabric_trackings','fabric_code'),
  ('houzs','product_models','allowed_options'),
  ('houzs','hr_item_kpi','ref'),            ('houzs','hr_item_kpi','label'),
  ('houzs','product_request_lines','fabric_code'),
  -- … the lines that picked it …
  ('houzs','mfg_sales_order_items','variants'),
  ('houzs','purchase_order_items','variants'),
  ('houzs','purchase_consignment_order_items','variants'),
  ('houzs','purchase_consignment_receive_items','variants'),
  -- … and saved snapshots of those (so an old revision / MRP run reads the same colour)
  ('houzs','so_revisions','snapshot'),
  ('houzs','mrp_snapshots','result'),       ('houzs','mrp_list_snapshots','result'),
  -- 2990s (schema public): KPI rules + Marketing
  ('2990s','hr_item_kpi','ref'),            ('2990s','hr_item_kpi','label'),
  ('2990s','marketing_displays','fabric'),  ('2990s','marketing_launch_requests','fabric');

-- Free text (only when the switch is 'on'): Houzs, these columns. Not the SO
-- audit log, scan_jobs or so_scan_samples — those are history, kept as printed.
CREATE TEMP TABLE kn_free (tbl text, col text) ON COMMIT DROP;
INSERT INTO kn_free VALUES
  ('mfg_sales_order_items','description2'), ('purchase_order_items','description2'),
  ('purchase_consignment_order_items','description2'), ('purchase_consignment_receive_items','description2'),
  ('mfg_sales_order_items','variants'), ('purchase_order_items','variants'),
  ('purchase_consignment_order_items','variants'), ('purchase_consignment_receive_items','variants'),
  ('so_revisions','snapshot'), ('mrp_snapshots','result'), ('mrp_list_snapshots','result');

DROP TABLE IF EXISTS kn_log;
CREATE TEMP TABLE kn_log (tbl text, col text, kind text, row_updates int, note text);  -- a json row holding 3 codes counts 3

DO $$
DECLARE
  is2990 boolean := to_regclass('public.campaign_promos') IS NOT NULL;
  v_db text  := CASE WHEN is2990 THEN '2990s' ELSE 'houzs' END;
  sch text   := CASE WHEN is2990 THEN 'public' ELSE 'scm' END;
  co  bigint := CASE WHEN is2990 THEN NULL ELSE 2 END;
  r record; m record; pass int; n int; total int; scope text; unlisted text := '';
  free_on boolean := (SELECT renumber_free_text = 'on' FROM kn_switch);
  codes text := '''KN01'',''KN02'',''KN03'',''KN04'',''KN05'',''KN06'',''KN07'',''KN08'',''KN09'',''KN10'',''KN11'',''KN12'',''KN13''';
BEGIN
  IF NOT is2990 AND to_regnamespace('scm') IS NULL THEN
    RAISE EXCEPTION 'Neither the 2990s nor the Houzs database — stopped.';
  END IF;

  -- Every candidate column, with how to match a whole-value code in it.
  CREATE TEMP TABLE kn_cols ON COMMIT DROP AS
  SELECT c.table_name AS tbl, c.column_name AS col,
         CASE WHEN c.udt_name IN ('_text','_varchar') THEN 'array'
              WHEN c.data_type = 'jsonb' THEN 'jsonb'
              WHEN c.data_type = 'json'  THEN 'json'
              ELSE 'text' END AS kind,
         EXISTS (SELECT 1 FROM information_schema.columns k
                  WHERE k.table_schema = sch AND k.table_name = c.table_name
                    AND k.column_name = 'company_id') AS has_co
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema
                                    AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = sch
     AND (c.data_type IN ('text','character varying','character','json','jsonb')
          OR c.udt_name IN ('_text','_varchar'));

  -- 1. Refuse while a code sits in a column nobody reviewed, in ANY company:
  --    a missed column would keep the old code and silently mean another colour.
  FOR r IN SELECT * FROM kn_cols LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %s', sch, r.tbl,
      CASE r.kind WHEN 'text'  THEN format('%I IN (%s)', r.col, codes)
                  WHEN 'array' THEN format('%I::text[] && ARRAY[%s]', r.col, codes)
                  ELSE format('%I::text ~ ''"KN(0[1-9]|1[0-3])"''', r.col) END) INTO n;
    IF n > 0 AND NOT EXISTS (SELECT 1 FROM kn_target t WHERE t.db = v_db AND t.tbl = r.tbl AND t.col = r.col) THEN
      unlisted := unlisted || format(' %s.%s (%s rows);', r.tbl, r.col, n);
    END IF;
    IF n > 0 AND co IS NOT NULL AND NOT r.has_co
       AND EXISTS (SELECT 1 FROM kn_target t WHERE t.db = v_db AND t.tbl = r.tbl AND t.col = r.col) THEN
      unlisted := unlisted || format(' %s.%s has no company_id — cannot scope to company 2;', r.tbl, r.col);
    END IF;
  END LOOP;
  IF unlisted <> '' THEN
    RAISE EXCEPTION 'Not on the reviewed list, nothing changed:%', unlisted;
  END IF;

  INSERT INTO kn_log
  SELECT t.tbl, t.col, NULL, 0, 'column not in this database — skipped'
    FROM kn_target t
   WHERE t.db = v_db AND NOT EXISTS (SELECT 1 FROM kn_cols c WHERE c.tbl = t.tbl AND c.col = t.col);

  -- 2. Foreign keys that point at, or from, a listed column (Houzs:
  --    fabric_colours.fabric_id and product_fabrics.fabric_id → fabric_library.id,
  --    NOT deferrable, ON UPDATE NO ACTION) would refuse the first UPDATE. Drop
  --    them for the swap and add them back, same name and definition, before
  --    COMMIT — re-adding re-checks every row.
  CREATE TEMP TABLE kn_fk ON COMMIT DROP AS
  SELECT DISTINCT con.conname::text AS conname, con.conrelid::regclass::text AS on_tbl,
         pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN kn_target t ON t.db = v_db
    JOIN pg_class cl ON cl.relname = t.tbl
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = sch
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = t.col
   WHERE con.contype = 'f'
     AND ((con.conrelid = cl.oid AND a.attnum = ANY (con.conkey))
       OR (con.confrelid = cl.oid AND a.attnum = ANY (con.confkey)));
  FOR r IN SELECT * FROM kn_fk LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.on_tbl, r.conname);
    INSERT INTO kn_log VALUES (r.on_tbl, r.conname, 'foreign key', 0, 'dropped for the swap, added back below');
  END LOOP;

  -- 3. Two passes: old → temporary token, then token → new.
  FOR pass IN 1..2 LOOP
    FOR r IN SELECT c.* FROM kn_cols c JOIN kn_target t ON t.tbl = c.tbl AND t.col = c.col AND t.db = v_db LOOP
      scope := CASE WHEN co IS NOT NULL THEN format(' AND company_id = %s', co) ELSE '' END;
      total := 0;
      FOR m IN SELECT CASE pass WHEN 1 THEN old_code ELSE 'zzKNRENUM' || substr(new_code, 3) END AS f,
                      CASE pass WHEN 1 THEN 'zzKNRENUM' || substr(new_code, 3) ELSE new_code END AS t
                 FROM kn_map LOOP
        EXECUTE CASE r.kind
          WHEN 'text'  THEN format('UPDATE %I.%I SET %I = %L WHERE %I = %L%s', sch, r.tbl, r.col, m.t, r.col, m.f, scope)
          WHEN 'array' THEN format('UPDATE %I.%I SET %I = array_replace(%I, %L, %L) WHERE %L = ANY(%I)%s',
                                   sch, r.tbl, r.col, r.col, m.f, m.t, m.f, r.col, scope)
          ELSE format('UPDATE %I.%I SET %I = replace(%I::text, %L, %L)::%s WHERE strpos(%I::text, %L) > 0%s',
                      sch, r.tbl, r.col, r.col, '"' || m.f || '"', '"' || m.t || '"', r.kind, r.col, '"' || m.f || '"', scope)
        END;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
      END LOOP;
      IF pass = 2 THEN INSERT INTO kn_log VALUES (r.tbl, r.col, r.kind, total, NULL); END IF;
    END LOOP;

    -- The switch: free text, whole tokens, keeping the "KN-01" / "KN01" form.
    -- Runs after the whole-value pass above, so a quoted "KN07" is already a
    -- zzKNRENUM token and is not changed twice. Only letters and digits are
    -- swapped, so the json stays valid.
    IF free_on AND co IS NOT NULL THEN
      FOR r IN SELECT c.* FROM kn_free d JOIN kn_cols c ON c.tbl = d.tbl AND c.col = d.col AND c.has_co LOOP
        total := 0;
        FOR m IN SELECT CASE pass WHEN 1 THEN 'KN' ELSE 'zzKNRENUM' END || '(-?)' ||
                        substr(CASE pass WHEN 1 THEN old_code ELSE new_code END, 3) AS f,
                        CASE pass WHEN 1 THEN 'zzKNRENUM' ELSE 'KN' END || '\1' || substr(new_code, 3) AS t
                   FROM kn_map LOOP
          EXECUTE format('UPDATE %I.%I SET %I = regexp_replace(%I::text, %L, %L, ''g'')::%s WHERE %I::text ~ %L AND company_id = %s',
                         sch, r.tbl, r.col, r.col, '\m' || m.f || '\M', m.t, r.kind, r.col, '\m' || m.f || '\M', co);
          GET DIAGNOSTICS n = ROW_COUNT;
          total := total + n;
        END LOOP;
        IF pass = 2 THEN INSERT INTO kn_log VALUES (r.tbl, r.col, 'free text (switch on)', total, NULL); END IF;
      END LOOP;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM kn_fk LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.on_tbl, r.conname, r.def);
  END LOOP;

  -- 4. The colour list follows the new numbers: hand the 13 rows' existing
  --    sort_order values out again in KN01..KN13 order (Houzs picker order).
  IF to_regclass(format('%I.fabric_colours', sch)) IS NOT NULL THEN
    EXECUTE format($q$
      WITH rows AS (SELECT ctid, colour_id, sort_order FROM %I.fabric_colours
                     WHERE colour_id IN (%s)%s),
           slots AS (SELECT sort_order, row_number() OVER (ORDER BY sort_order, colour_id) AS i FROM rows),
           want  AS (SELECT ctid, row_number() OVER (ORDER BY colour_id) AS i FROM rows)
      UPDATE %I.fabric_colours f SET sort_order = s.sort_order
        FROM want w JOIN slots s USING (i) WHERE f.ctid = w.ctid$q$,
      sch, codes, CASE WHEN co IS NOT NULL THEN format(' AND company_id = %s', co) ELSE '' END, sch);
  END IF;

  -- 5. Proof before COMMIT. KN number = EM number on every EMBRACE converter row …
  IF EXISTS (SELECT 1 FROM kn_cols WHERE tbl = 'fabric_trackings' AND col = 'fabric_description') THEN
    EXECUTE format($q$SELECT count(*) FROM %I.fabric_trackings
                       WHERE upper(coalesce(series, '')) = 'EMBRACE' AND fabric_code IN (%s)%s
                         AND fabric_code <> 'KN' || substring(fabric_description FROM 'EM\s*-\s*(\d\d)')$q$,
                   sch, codes, CASE WHEN co IS NOT NULL AND EXISTS (SELECT 1 FROM kn_cols WHERE tbl = 'fabric_trackings' AND has_co)
                                    THEN format(' AND company_id = %s', co) ELSE '' END) INTO n;
    IF n > 0 THEN RAISE EXCEPTION '% EMBRACE converter rows still have KN <> EM — rolled back.', n; END IF;
  END IF;
  -- … and every colour row's name matches its new code.
  IF EXISTS (SELECT 1 FROM kn_cols WHERE tbl = 'fabric_colours' AND col = 'label') THEN
    EXECUTE format($q$SELECT count(*) FROM %I.fabric_colours f JOIN kn_map k ON k.new_code = f.colour_id
                       WHERE lower(trim(f.label)) <> lower(k.colour)%s$q$,
                   sch, CASE WHEN co IS NOT NULL THEN format(' AND f.company_id = %s', co) ELSE '' END) INTO n;
    IF n > 0 THEN RAISE EXCEPTION '% colour rows have a name that does not match the new code — rolled back.', n; END IF;
  END IF;
END $$;

COMMIT;

-- What changed (this session only).
SELECT * FROM kn_log ORDER BY tbl, col;
