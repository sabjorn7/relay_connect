-- sha256(payload below): d3b12e7d40e2a018db22f3b33bb7c6c0639be265df72d10b66b08fdc75f8bcb6
-- Этап 2a — безопасный additive-фундамент реферальной программы.
-- НИЧЕГО не читает/пишет из бизнес-логики (инертно до этапов 2–4): не трогает webhook/цены/доступ/выплаты.
-- Только новые объекты + nullable-колонка. Обратимо (см. rollback).
begin;

-- 1) владелец личного промокода (nullable → существующие админ-коды = null, не затрагиваются)
alter table public.promo_codes add column if not exists owner_user_id uuid;
-- один личный код на пользователя (админ-коды с owner_user_id=null — без ограничения)
create unique index if not exists promo_codes_owner_key
  on public.promo_codes (owner_user_id) where owner_user_id is not null;

-- 2) append-only журнал бонусов (баланс = сумма записей). Писать только через SECURITY DEFINER RPC.
create table if not exists public.bonus_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null check (kind in ('accrued','spent','expired','cancelled','reserve','reserve_release')),
  amount      numeric not null,               -- знаковая: + начисление/резерв-ин, − трата/сгорание
  order_id    uuid,                           -- для идемпотентности и привязки к покупке
  promo_id    uuid,
  position_id uuid,                            -- курс/shop-позиция (атрибуция резерва)
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists bonus_ledger_user_idx on public.bonus_ledger (user_id, created_at desc);
-- идемпотентность: не более одной записи данного вида на (order_id, user_id)
create unique index if not exists bonus_ledger_order_once
  on public.bonus_ledger (order_id, user_id, kind) where order_id is not null;
alter table public.bonus_ledger enable row level security;
revoke all on public.bonus_ledger from anon, authenticated;

-- 3) настройки реферальной программы (одна строка, правится без деплоя; master-флаг enabled=false)
create table if not exists public.referral_settings (
  id                     integer primary key default 1 check (id = 1),
  enabled                boolean not null default false,  -- общий рубильник фичи
  levels                 jsonb   not null default
    '[{"min":0,"pct":5},{"min":10,"pct":6},{"min":20,"pct":7},{"min":30,"pct":8},{"min":40,"pct":9},{"min":50,"pct":10}]'::jsonb,
  bonus_spend_pct_cap    numeric not null default 30,     -- макс. % цены бонусами
  bonus_expiry_months    integer not null default 12,     -- срок жизни бонусов
  refund_window_days     integer not null default 14,     -- начисление после окна возврата
  monthly_accrual_cap    numeric,                          -- лимит начислений на человека/мес (null = без лимита)
  author_platform_split  numeric not null default 50,     -- % издержек с автора (остальное с площадки)
  updated_at             timestamptz not null default now()
);
insert into public.referral_settings (id) values (1) on conflict (id) do nothing;
alter table public.referral_settings enable row level security;
revoke all on public.referral_settings from anon, authenticated;

commit;
