-- sha256(payload below, вставлять БЕЗ этой строки): ca8235d448781414aa7b3eb86959608542b76e26f19a5ec1934d6367e601b610

create table if not exists public.payment_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.payment_secrets enable row level security;
revoke all on public.payment_secrets from public, anon, authenticated;
grant all on public.payment_secrets to service_role;
create or replace function public.verify_prodamus_sign(serialized text, sign text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_calc text;
begin
  select value into v_secret from public.payment_secrets where name = 'prodamus';
  if v_secret is null or v_secret = '' then
    return jsonb_build_object('valid', false, 'secret_present', false);
  end if;
  v_calc := encode(hmac(serialized, v_secret, 'sha256'), 'hex');
  return jsonb_build_object('valid', lower(sign) = lower(v_calc), 'secret_present', true);
end;
$$;
revoke all on function public.verify_prodamus_sign(text, text) from public, anon, authenticated;
grant execute on function public.verify_prodamus_sign(text, text) to service_role;
