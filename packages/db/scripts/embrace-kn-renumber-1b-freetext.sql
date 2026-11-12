-- 2990-0058 — EMBRACE KN renumber, step 1b: READ ONLY. Changes nothing.
--
-- Prints the free text that mentions a KN01..KN13 code ("FABRIC KN-12 / SEAT
-- 18", "KN13 Rosewood"), so a person can decide whether step 2's
-- free-text SWITCH should be on. Houzs: company 2 rows only. 2990s: no
-- such columns, so it returns nothing there.
--
-- One row per distinct text: table, column, the text (for json, the 40
-- characters either side of the code), how many rows hold it, and the
-- document numbers (the row's own doc_no, else its parent's through a foreign
-- key, else the row's primary key; at most 20 listed).

WITH mode AS (
  SELECT CASE WHEN to_regclass('public.campaign_promos') IS NOT NULL THEN 'public' ELSE 'scm' END AS sch,
         CASE WHEN to_regclass('public.campaign_promos') IS NOT NULL THEN NULL ELSE 2 END AS co
),
want(tbl, col) AS (VALUES
  ('mfg_sales_order_items','description2'), ('purchase_order_items','description2'),
  ('purchase_consignment_order_items','description2'), ('purchase_consignment_receive_items','description2'),
  ('mfg_sales_order_items','variants'), ('purchase_order_items','variants'),
  ('purchase_consignment_order_items','variants'), ('purchase_consignment_receive_items','variants'),
  ('mfg_so_audit_log','field_changes'), ('scan_jobs','review'), ('so_scan_samples','extracted'),
  ('mrp_snapshots','result'), ('mrp_list_snapshots','result'), ('so_revisions','snapshot')
),
cols AS (
  SELECT w.tbl, w.col, c.data_type IN ('json','jsonb') AS is_json, m.sch, m.co,
         EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = m.sch
                   AND k.table_name = w.tbl AND k.column_name = 'company_id') AS has_co,
         (SELECT k.column_name FROM information_schema.columns k WHERE k.table_schema = m.sch
             AND k.table_name = w.tbl AND k.column_name IN ('doc_no','so_doc_no','document_no')
           ORDER BY k.column_name LIMIT 1) AS own_doc,
         -- a single-column foreign key to a parent table that has doc_no
         (SELECT format('LEFT JOIN %s p ON p.%I = x.%I', con.confrelid::regclass, pa.attname, ca.attname)
            FROM pg_constraint con
            JOIN pg_attribute ca ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
            JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
           WHERE con.contype = 'f' AND cardinality(con.conkey) = 1
             AND con.conrelid = to_regclass(format('%I.%I', m.sch, w.tbl))
             AND EXISTS (SELECT 1 FROM pg_attribute d WHERE d.attrelid = con.confrelid AND d.attname = 'doc_no' AND NOT d.attisdropped)
           ORDER BY con.conname LIMIT 1) AS parent_join,
         -- the table's own primary key, read from the live catalog (not every table has an id:
         -- mrp_snapshots / mrp_list_snapshots are keyed by company_id); ctid if it has none
         coalesce((SELECT string_agg(format('x.%I::text', a.attname), $s$ || '/' || $s$ ORDER BY k.ord)
                     FROM pg_index i
                     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                    WHERE i.indrelid = to_regclass(format('%I.%I', m.sch, w.tbl)) AND i.indisprimary),
                  'x.ctid::text') AS pk_doc
    FROM want w CROSS JOIN mode m
    JOIN information_schema.columns c ON c.table_schema = m.sch AND c.table_name = w.tbl AND c.column_name = w.col
),
q AS (
  SELECT tbl, col, format($f$
    SELECT val, count(*) AS n,
           array_to_string((array_agg(DISTINCT doc ORDER BY doc))[1:20], ', ') AS docs
      FROM (SELECT %s AS doc, %s AS val FROM %I.%I x %s WHERE %s%s) s
     GROUP BY val$f$,
      CASE WHEN own_doc IS NOT NULL THEN format('x.%I::text', own_doc)
           WHEN parent_join IS NOT NULL THEN 'p.doc_no::text'
           ELSE pk_doc END,
      CASE WHEN is_json
           THEN format($v$substring(regexp_replace(x.%I::text, '"KN(0[1-9]|1[0-3])"', '"·"', 'g') FROM '.{0,40}\mKN-?(?:0[1-9]|1[0-3])\M.{0,40}')$v$, col)
           ELSE format('x.%I', col) END,
      sch, tbl, coalesce(CASE WHEN own_doc IS NULL THEN parent_join END, ''),
      CASE WHEN is_json
           THEN format($v$regexp_replace(x.%I::text, '"KN(0[1-9]|1[0-3])"', '', 'g') ~ '\mKN-?(0[1-9]|1[0-3])\M'$v$, col)
           ELSE format($v$x.%1$I !~ '^KN(0[1-9]|1[0-3])$' AND x.%1$I ~ '\mKN-?(0[1-9]|1[0-3])\M'$v$, col) END,
      CASE WHEN co IS NOT NULL AND has_co THEN format(' AND x.company_id = %s', co) ELSE '' END) AS sql
    FROM cols
)
SELECT q.tbl AS "table", q.col AS "column",
       (xpath('/row/val/text()', r))[1]::text AS value,
       (xpath('/row/n/text()', r))[1]::text::int AS rows,
       (xpath('/row/docs/text()', r))[1]::text AS documents
  FROM q, unnest(xpath('/table/row', query_to_xml(q.sql, true, false, ''))) r
 ORDER BY 1, 2, 4 DESC, 3;
