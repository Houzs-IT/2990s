-- 2990-0058 — EMBRACE KN renumber, step 1 of 3: DISCOVER (read only).
--
-- Run this FIRST in each database, before step 2. Plain SELECTs: it changes
-- nothing. It works out which database it is in by itself:
--   · Houzs  (anogrigyjbduyzclzjgn) — schema scm, company 2 counted apart
--   · 2990s  (dolvxrchzbnqvahocwsu) — schema public, single company
--
-- What it lists: every text / json / text[] column that holds one of
-- KN01..KN13, with
--   exact_co2     rows whose value IS a code (text = 'KN01', a json string
--                 "KN01", an array element) — company 2, or all rows in 2990s
--   exact_other   the same in OTHER companies (Houzs only). Step 2 never
--                 touches these. Anything here: stop and tell the developer.
--   exact_nocol   the same in a Houzs table with NO company_id column. Step 2
--                 refuses these until someone decides they are company 2's.
--   freetext      rows that mention a code inside longer text ("FABRIC KN-12",
--                 "KN01 Aegean"). Step 2 does NOT rewrite these: they are
--                 printed/sent text. Listed so you can see them.
--   per_code      exact rows per code (company 2 / all in 2990s).
--
-- Send the whole result to the developer before running step 2: step 2 only
-- rewrites the columns on its reviewed list, and refuses to run while a
-- column holding a code is missing from that list.

WITH mode AS (
  SELECT CASE WHEN to_regclass('public.campaign_promos') IS NOT NULL THEN 'public'
              WHEN to_regnamespace('scm') IS NOT NULL                 THEN 'scm' END AS sch,
         CASE WHEN to_regclass('public.campaign_promos') IS NOT NULL THEN NULL ELSE 2 END AS co
),
cols AS MATERIALIZED (
  SELECT c.table_name AS tbl, c.column_name AS col,
         CASE WHEN c.udt_name IN ('_text','_varchar') THEN 'array'
              WHEN c.data_type IN ('json','jsonb')     THEN 'json'
              ELSE 'text' END AS kind,
         EXISTS (SELECT 1 FROM information_schema.columns k
                  WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name
                    AND k.column_name = 'company_id') AS has_co,
         m.sch, m.co
    FROM mode m
    JOIN information_schema.columns c ON c.table_schema = m.sch
    JOIN information_schema.tables  t ON t.table_schema = c.table_schema
                                     AND t.table_name   = c.table_name
                                     AND t.table_type   = 'BASE TABLE'
   WHERE c.data_type IN ('text','character varying','character','json','jsonb')
      OR c.udt_name  IN ('_text','_varchar')
),
preds AS (
  SELECT *,
         CASE kind
           WHEN 'text'  THEN format('%I IN (''KN01'',''KN02'',''KN03'',''KN04'',''KN05'',''KN06'',''KN07'',''KN08'',''KN09'',''KN10'',''KN11'',''KN12'',''KN13'')', col)
           WHEN 'json'  THEN format('%I::text ~ ''"KN(0[1-9]|1[0-3])"''', col)
           ELSE              format('%I::text[] && ARRAY[''KN01'',''KN02'',''KN03'',''KN04'',''KN05'',''KN06'',''KN07'',''KN08'',''KN09'',''KN10'',''KN11'',''KN12'',''KN13'']', col)
         END AS exact_p,
         -- a mention that is not a whole value: strip the exact ones first
         CASE kind
           WHEN 'text' THEN format('%I !~ ''^KN(0[1-9]|1[0-3])$'' AND %I ~ ''\mKN-?(0[1-9]|1[0-3])\M''', col, col)
           ELSE format('regexp_replace(%I::text, ''"KN(0[1-9]|1[0-3])"'', '''', ''g'') ~ ''\mKN-?(0[1-9]|1[0-3])\M''', col)
         END AS free_p
    FROM cols
),
counted AS MATERIALIZED (
  SELECT p.*,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %s %s', sch, tbl, exact_p,
            CASE WHEN has_co AND co IS NOT NULL THEN format('AND company_id = %s', co) ELSE '' END), false, true, '')))[1]::text::int AS exact_scoped,
         CASE WHEN has_co AND co IS NOT NULL THEN
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %s AND company_id <> %s', sch, tbl, exact_p, co), false, true, '')))[1]::text::int
         ELSE 0 END AS exact_other,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %s %s', sch, tbl, free_p,
            CASE WHEN has_co AND co IS NOT NULL THEN format('AND company_id = %s', co) ELSE '' END), false, true, '')))[1]::text::int AS freetext
    FROM preds p
)
SELECT sch || '.' || tbl AS "table", col AS "column", kind,
       CASE WHEN has_co OR co IS NULL THEN exact_scoped ELSE 0 END AS exact_co2,
       exact_other,
       CASE WHEN NOT has_co AND co IS NOT NULL THEN exact_scoped ELSE 0 END AS exact_nocol,
       freetext,
       (SELECT string_agg(code || '=' || n, ' ' ORDER BY code)
          FROM (SELECT k.code,
                       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %s %s', sch, tbl,
                          CASE kind WHEN 'text' THEN format('%I = %L', col, k.code)
                                    WHEN 'json' THEN format('strpos(%I::text, %L) > 0', col, '"' || k.code || '"')
                                    ELSE format('%L = ANY(%I::text[])', k.code, col) END,
                          CASE WHEN has_co AND co IS NOT NULL THEN format('AND company_id = %s', co) ELSE '' END), false, true, '')))[1]::text::int AS n
                  FROM (SELECT 'KN' || lpad(g::text, 2, '0') AS code FROM generate_series(1, 13) g) k) pc
         WHERE n > 0) AS per_code
  FROM counted
 WHERE exact_scoped > 0 OR exact_other > 0 OR freetext > 0
 ORDER BY 1, 2;
