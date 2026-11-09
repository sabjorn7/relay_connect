-- Local proposal only. Additive; existing streams remain HD. Do not apply automatically.
begin;
set local lock_timeout='3s';
alter table public.streams add column video_quality text not null default 'hd'
  check (video_quality in ('hd','full_hd'));
create table public.stream_video_quality_settings (
  singleton boolean primary key default true check(singleton),
  full_hd_enabled boolean not null default false,
  max_full_hd_live integer not null default 1 check(max_full_hd_live between 1 and 20)
);
insert into public.stream_video_quality_settings(singleton) values(true);
alter table public.stream_video_quality_settings enable row level security;
revoke all on public.stream_video_quality_settings from public,anon,authenticated;
grant select,update on public.stream_video_quality_settings to service_role;
create table public.stream_video_runs (
  egress_id text primary key,
  stream_id uuid not null references public.streams(id) on delete cascade,
  profile text not null check(profile in ('hd','full_hd')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.stream_video_runs enable row level security;
revoke all on public.stream_video_runs from public,anon,authenticated;
grant select,insert,update on public.stream_video_runs to service_role;
create table public.stream_video_start_reservations (
 stream_id uuid primary key references public.streams(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(),
 profile text not null check(profile in ('hd','full_hd')),
 expires_at timestamptz not null default (now()+interval '2 minutes')
);
alter table public.stream_video_start_reservations enable row level security;
revoke all on public.stream_video_start_reservations from public,anon,authenticated;
grant select,delete on public.stream_video_start_reservations to service_role;
create function public.reserve_stream_video_start(p_stream_id uuid,p_expected_quality text,p_expected_egress_id text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare s public.streams%rowtype; cfg public.stream_video_quality_settings%rowtype; reservation uuid;
begin
 perform pg_advisory_xact_lock(78403191);
 select * into s from public.streams where id=p_stream_id for update;
 if not found then raise exception 'stream_not_found'; end if;
 if s.video_quality is distinct from p_expected_quality or s.livekit_egress_id is distinct from p_expected_egress_id then raise exception 'stream_settings_changed'; end if;
 delete from public.stream_video_start_reservations where expires_at<now();
 if exists(select 1 from public.stream_video_start_reservations where stream_id=p_stream_id) then raise exception 'stream_start_in_progress'; end if;
 select * into cfg from public.stream_video_quality_settings where singleton;
 if p_expected_quality='full_hd' then
  if not coalesce(cfg.full_hd_enabled,false) then raise exception 'full_hd_not_enabled'; end if;
  if (select count(*) from public.stream_video_runs r join public.streams t on t.id=r.stream_id and t.livekit_egress_id=r.egress_id
      where t.status='live' and r.ended_at is null and r.profile='full_hd')
     +(select count(*) from public.stream_video_start_reservations where profile='full_hd')>=cfg.max_full_hd_live then raise exception 'full_hd_capacity'; end if;
 end if;
 insert into public.stream_video_start_reservations(stream_id,profile) values(p_stream_id,p_expected_quality) returning token into reservation;
 return reservation;
end $$;
revoke all on function public.reserve_stream_video_start(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_stream_video_start(uuid,text,text) to service_role;
-- Hold capacity before a potentially indeterminate external create request.
-- No automatic expiry once media creation may have begun; reconcile explicitly on API failure.
create function public.hold_stream_video_start(p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 update public.stream_video_start_reservations set expires_at='infinity'::timestamptz
 where token=p_token and expires_at>now();
 if not found then raise exception 'video_reservation_expired'; end if;
end $$;
revoke all on function public.hold_stream_video_start(uuid) from public,anon,authenticated;
grant execute on function public.hold_stream_video_start(uuid) to service_role;
create function public.stream_video_quality_capabilities() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('version',1,'full_hd_enabled',s.full_hd_enabled)
 from public.stream_video_quality_settings s where singleton
$$;
revoke all on function public.stream_video_quality_capabilities() from public;
grant execute on function public.stream_video_quality_capabilities() to anon,authenticated,service_role;
create function public.guard_stream_video_quality() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.video_quality='full_hd' and not coalesce((select full_hd_enabled from public.stream_video_quality_settings where singleton),false) then
  -- Permit unrelated edits of an existing Full HD stream after feature rollback.
  if tg_op='INSERT' then raise exception 'full_hd_not_enabled'; end if;
  if old.video_quality is distinct from new.video_quality then raise exception 'full_hd_not_enabled'; end if;
 end if;
 return new;
end $$;
create trigger guard_stream_video_quality before insert or update of video_quality on public.streams
for each row execute function public.guard_stream_video_quality();
create function public.mark_stream_video_started(p_stream_id uuid,p_expected_quality text,p_expected_egress_id text,p_egress_id text,p_video_id uuid,p_reservation uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.streams%rowtype; cfg public.stream_video_quality_settings%rowtype;
begin
 if p_expected_quality not in ('hd','full_hd') or p_expected_quality is null or nullif(p_egress_id,'') is null or p_video_id is null then raise exception 'bad_video_run'; end if;
 -- Serialize admission, not active media. Never reconfigure/stop a running egress here.
 perform pg_advisory_xact_lock(78403191);
 select * into s from public.streams where id=p_stream_id for update;
 if not found then raise exception 'stream_not_found'; end if;
 if s.video_quality is distinct from p_expected_quality or s.livekit_egress_id is distinct from p_expected_egress_id then raise exception 'stream_settings_changed'; end if;
 if not exists(select 1 from public.stream_video_start_reservations where stream_id=p_stream_id and token=p_reservation and profile=p_expected_quality and expires_at>now()) then raise exception 'video_reservation_expired'; end if;
 select * into cfg from public.stream_video_quality_settings where singleton;
 if p_expected_quality='full_hd' then
  if not coalesce(cfg.full_hd_enabled,false) then raise exception 'full_hd_not_enabled'; end if;
  if (select count(*) from public.stream_video_runs r join public.streams t on t.id=r.stream_id and t.livekit_egress_id=r.egress_id
      where t.status='live' and r.ended_at is null and r.profile='full_hd')>=cfg.max_full_hd_live then raise exception 'full_hd_capacity'; end if;
 end if;
 insert into public.stream_video_runs(egress_id,stream_id,profile) values(p_egress_id,p_stream_id,p_expected_quality);
 update public.streams set livekit_egress_id=p_egress_id,peertube_video_id=p_video_id,mode='multi',status='live',livekit_room=p_stream_id::text where id=p_stream_id;
 delete from public.stream_video_start_reservations where token=p_reservation;
end $$;
revoke all on function public.mark_stream_video_started(uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_stream_video_started(uuid,text,text,text,uuid,uuid) to service_role;
-- A stale orchestrator must not mark a Full HD stream live using its hard-coded HD preset.
create function public.guard_stream_video_run() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.mode='multi' and new.video_quality='full_hd' and new.livekit_egress_id is not null
    and new.livekit_egress_id is distinct from old.livekit_egress_id
    and not exists(select 1 from public.stream_video_runs r where r.stream_id=new.id and r.egress_id=new.livekit_egress_id and r.profile=new.video_quality) then
  raise exception 'video_profile_contract_required';
 end if;
 return new;
end $$;
create trigger guard_stream_video_run before update of livekit_egress_id on public.streams
for each row execute function public.guard_stream_video_run();
commit;
