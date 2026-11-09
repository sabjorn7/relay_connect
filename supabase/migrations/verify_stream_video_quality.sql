-- Read-only post-migration checks. Run separately AFTER the migration commits.
-- Expected: every check below is PASS before the first deployment.
-- This script does not reload schema cache, enable Full HD or modify data.
BEGIN READ ONLY;

WITH expected AS (
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'streams'
    AND column_name = 'video_quality'
)
SELECT 'streams.video_quality: text, NOT NULL, default hd' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM expected WHERE data_type = 'text' AND is_nullable = 'NO'
      AND column_default = '''hd''::text'
  ) THEN 'PASS' ELSE 'FAIL' END AS result;

WITH expected(name) AS (VALUES
  ('stream_video_quality_settings'), ('stream_video_runs'),
  ('stream_video_start_reservations')
)
SELECT e.name AS check_name,
  CASE WHEN c.relkind = 'r' AND c.relrowsecurity
    AND NOT has_table_privilege('anon', c.oid, 'SELECT')
    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
    AND NOT has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')
  THEN 'PASS' ELSE 'FAIL' END AS result
FROM expected e
LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.name;

WITH expected(signature, client_callable) AS (VALUES
  ('public.reserve_stream_video_start(uuid,text,text)', false),
  ('public.hold_stream_video_start(uuid)', false),
  ('public.mark_stream_video_started(uuid,text,text,text,uuid,uuid)', false),
  ('public.stream_video_quality_capabilities()', true)
)
SELECT e.signature AS check_name,
  CASE WHEN p.prosecdef AND 'search_path=pg_catalog' = ANY(p.proconfig)
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND has_function_privilege('anon', p.oid, 'EXECUTE') = e.client_callable
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.client_callable
  THEN 'PASS' ELSE 'FAIL' END AS result
FROM expected e LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature);

WITH expected(name) AS (VALUES ('guard_stream_video_quality'), ('guard_stream_video_run'))
SELECT e.name AS check_name,
  CASE WHEN t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal
    AND p.proname = e.name AND p.prosecdef
    AND 'search_path=pg_catalog' = ANY(p.proconfig)
  THEN 'PASS' ELSE 'FAIL' END AS result
FROM expected e
LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass('public.streams') AND t.tgname = e.name
LEFT JOIN pg_proc p ON p.oid = t.tgfoid;

SELECT 'video_quality CHECK restricts profiles (inspect definition)' AS check_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.streams'::regclass AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%video_quality%';

-- For first application, all existing streams must remain HD.
SELECT 'initial streams remain hd' AS check_name,
  CASE WHEN count(*) FILTER (WHERE video_quality IS DISTINCT FROM 'hd') = 0
    THEN 'PASS' ELSE 'FAIL' END AS result,
  count(*) AS total_streams
FROM public.streams;

SELECT 'initial Full HD disabled, concurrency limit one' AS check_name,
  CASE WHEN count(*) = 1 AND bool_and(singleton AND NOT full_hd_enabled AND max_full_hd_live = 1)
    THEN 'PASS' ELSE 'FAIL' END AS result
FROM public.stream_video_quality_settings;

-- Expected definitions:
-- stream_video_runs.profile and stream_video_start_reservations.profile: hd/full_hd.
SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
WHERE con.conrelid IN (
  'public.stream_video_quality_settings'::regclass,
  'public.stream_video_runs'::regclass,
  'public.stream_video_start_reservations'::regclass
)
ORDER BY c.relname, con.conname;

ROLLBACK;
