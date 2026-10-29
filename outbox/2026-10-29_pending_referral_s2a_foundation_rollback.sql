-- sha256(payload below): a17a59103e9c794941e6487a32b336bb3cae76c8848b30541e65a36c4a802590
-- Откат этапа 2a. Безопасно (объекты инертны, бизнес-логика их не использует до этапов 2–4).
begin;
drop table if exists public.referral_settings;
drop table if exists public.bonus_ledger;
drop index if exists public.promo_codes_owner_key;
alter table public.promo_codes drop column if exists owner_user_id;
commit;
