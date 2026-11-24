-- DO NOT APPLY under current authorization: includes Storage RLS changes.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF public.club_chat_capabilities() IS DISTINCT FROM '{"attachments":false}'::jsonb
 THEN RAISE EXCEPTION 'baseline_capability_mismatch'; END IF;
END $$;
\ir 01-functions-disabled.sql
\ir 02-storage-policy.REQUIRES-APPROVAL.sql
COMMIT;
