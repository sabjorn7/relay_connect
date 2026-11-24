-- Separate approval required. Non-destructive emergency disable; no history/files/subscriptions deleted.
BEGIN;
UPDATE public.club_chat_feature_flags SET attachments=false,push=false WHERE singleton;
COMMIT;
-- Also set PUSH_CLUB_ENABLED=false in the existing Edge environment via its approved admin procedure.
-- Retain columns, private bucket, RLS and attachment references on rollback.
-- Restoring old broad grants/RLS-disabled state is NOT automatic rollback.
