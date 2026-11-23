-- Restore the previous frontend FIRST. Keep all orders and subscriptions.
BEGIN;
DROP FUNCTION public.club_prepare_subscription_order(uuid);
COMMIT;
