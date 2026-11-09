-- Manual, additive scoped Full HD pilot. Requires pending_stream_video_quality.sql.
-- Apply only in an idle window; does not enable the global flag or change HD profiles.
begin;
set local lock_timeout='3s';
do $$begin
 if not exists(select 1 from public.stream_video_quality_settings where singleton and full_hd_enabled=false and max_full_hd_live=1) then raise exception 'unexpected_video_quality_settings'; end if;
 if exists(select 1 from public.stream_video_start_reservations) or exists(select 1 from public.streams where status='live') then raise exception 'apply_in_idle_window'; end if;
end$$;
create table public.stream_full_hd_test_grants (
 stream_id uuid primary key references public.streams(id) on delete cascade,
 owner_id uuid not null references public.users(id) on delete cascade,
 enabled boolean not null default false,
 expires_at timestamptz not null,
 granted_at timestamptz not null default now()
);
-- Exactly one designated pilot, even if an old enabled grant has expired.
create unique index stream_full_hd_one_enabled on public.stream_full_hd_test_grants(enabled) where enabled;
alter table public.stream_full_hd_test_grants enable row level security;
revoke all on public.stream_full_hd_test_grants from public,anon,authenticated,service_role;
grant select on public.stream_full_hd_test_grants to service_role;
alter table public.stream_video_start_reservations add column owner_id uuid not null references public.users(id);
create function public.stream_full_hd_test_allowed(p_stream_id uuid,p_owner_id uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.streams s join public.stream_full_hd_test_grants g on g.stream_id=s.id and g.owner_id=s.author
 where s.id=p_stream_id and s.author=p_owner_id and s.mode='multi' and g.enabled and g.expires_at>clock_timestamp())
$$;
revoke all on function public.stream_full_hd_test_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stream_full_hd_test_allowed(uuid,uuid) to service_role;
-- Only the authenticated owner can learn whether THIS stream has a pilot grant.
-- Non-owner and nonexistent IDs have the same response. No grant-management RPC.
create function public.stream_video_quality_for_stream(p_stream_id uuid) returns jsonb
language sql volatile security definer set search_path=pg_catalog as $$
 select jsonb_build_object('version',2,'full_hd_allowed',coalesce(public.stream_full_hd_test_allowed(p_stream_id,auth.uid()),false))
$$;
revoke all on function public.stream_video_quality_for_stream(uuid) from public,anon;
grant execute on function public.stream_video_quality_for_stream(uuid) to authenticated,service_role;
create or replace function public.guard_stream_video_quality() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.video_quality='full_hd' then
  perform 1 from public.stream_full_hd_test_grants where stream_id=new.id for share;
  -- On UPDATE the row must still belong to this owner; the grant cannot transfer.
  if not public.stream_full_hd_test_allowed(new.id,new.author) or new.mode<>'multi' then raise exception 'full_hd_not_enabled'; end if;
 end if;
 return new;
end$$;
drop trigger guard_stream_video_quality on public.streams;
create trigger guard_stream_video_quality before insert or update of video_quality,author,mode on public.streams for each row execute function public.guard_stream_video_quality();
create function public.invalidate_stream_full_hd_owner() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.author is distinct from old.author then update public.stream_full_hd_test_grants set enabled=false where stream_id=new.id; end if;
 return new;
end$$;
revoke all on function public.invalidate_stream_full_hd_owner() from public,anon,authenticated;
create trigger invalidate_stream_full_hd_owner after update of author on public.streams for each row execute function public.invalidate_stream_full_hd_owner();
create function public.reserve_stream_video_start_scoped(p_stream_id uuid,p_actor_id uuid,p_expected_quality text,p_expected_egress_id text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare s public.streams%rowtype; cfg public.stream_video_quality_settings%rowtype; reservation uuid;
begin
 perform pg_advisory_xact_lock(78403191);
 select * into s from public.streams where id=p_stream_id for update;
 if not found then raise exception 'stream_not_found'; end if;
 if p_actor_id is null or s.author is distinct from p_actor_id then raise exception 'not_owner'; end if;
 if s.video_quality is distinct from p_expected_quality or s.livekit_egress_id is distinct from p_expected_egress_id then raise exception 'stream_settings_changed'; end if;
 delete from public.stream_video_start_reservations where expires_at<now();
 if exists(select 1 from public.stream_video_start_reservations where stream_id=p_stream_id) then raise exception 'stream_start_in_progress'; end if;
 select * into cfg from public.stream_video_quality_settings where singleton for share;
 if p_expected_quality='full_hd' then
  perform 1 from public.stream_full_hd_test_grants where stream_id=p_stream_id for share;
  if not public.stream_full_hd_test_allowed(s.id,p_actor_id) then raise exception 'full_hd_not_enabled'; end if;
  if cfg.max_full_hd_live is null or (select count(*) from public.stream_video_runs r join public.streams t on t.id=r.stream_id and t.livekit_egress_id=r.egress_id where t.status='live' and r.ended_at is null and r.profile='full_hd')
   +(select count(*) from public.stream_video_start_reservations where profile='full_hd')>=cfg.max_full_hd_live then raise exception 'full_hd_capacity'; end if;
 end if;
 insert into public.stream_video_start_reservations(stream_id,profile,owner_id) values(s.id,p_expected_quality,p_actor_id) returning token into reservation;
 return reservation;
end$$;
revoke all on function public.reserve_stream_video_start_scoped(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_stream_video_start_scoped(uuid,uuid,text,text) to service_role;
-- Legacy callers retain HD only. Full HD requires the authenticated actor contract.
create or replace function public.reserve_stream_video_start(p_stream_id uuid,p_expected_quality text,p_expected_egress_id text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_expected_quality is distinct from 'hd' then raise exception 'full_hd_actor_contract_required'; end if;
 return public.reserve_stream_video_start_scoped(p_stream_id,(select author from public.streams where id=p_stream_id),p_expected_quality,p_expected_egress_id);
end$$;
create or replace function public.hold_stream_video_start(p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.streams%rowtype; r public.stream_video_start_reservations%rowtype;
begin
 perform pg_advisory_xact_lock(78403191);
 select t.* into s from public.streams t join public.stream_video_start_reservations v on v.stream_id=t.id where v.token=p_token for update of t;
 select * into r from public.stream_video_start_reservations where token=p_token for update;
 if not found or r.expires_at<=now() then raise exception 'video_reservation_expired'; end if;
 if r.owner_id is distinct from s.author or r.profile is distinct from s.video_quality then raise exception 'stream_settings_changed'; end if;
 if r.profile='full_hd' then
  perform 1 from public.stream_full_hd_test_grants where stream_id=s.id for share;
  if not public.stream_full_hd_test_allowed(s.id,r.owner_id) then raise exception 'full_hd_not_enabled'; end if;
 end if;
 update public.stream_video_start_reservations set expires_at='infinity'::timestamptz where token=p_token;
end$$;
create function public.mark_stream_video_started_scoped(p_stream_id uuid,p_actor_id uuid,p_expected_quality text,p_expected_egress_id text,p_egress_id text,p_video_id uuid,p_reservation uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare s public.streams%rowtype; cfg public.stream_video_quality_settings%rowtype;
begin
 if p_expected_quality not in ('hd','full_hd') or p_expected_quality is null or nullif(p_egress_id,'') is null or p_video_id is null then raise exception 'bad_video_run'; end if;
 perform pg_advisory_xact_lock(78403191);
 select * into s from public.streams where id=p_stream_id for update;
 if not found then raise exception 'stream_not_found'; end if;
 if p_actor_id is null or s.author is distinct from p_actor_id then raise exception 'not_owner'; end if;
 if s.video_quality is distinct from p_expected_quality or s.livekit_egress_id is distinct from p_expected_egress_id then raise exception 'stream_settings_changed'; end if;
 perform 1 from public.stream_video_start_reservations where stream_id=p_stream_id and token=p_reservation and owner_id=p_actor_id and profile=p_expected_quality and expires_at>now() for update;
 if not found then raise exception 'video_reservation_expired'; end if;
 select * into cfg from public.stream_video_quality_settings where singleton for share;
 if p_expected_quality='full_hd' then
  perform 1 from public.stream_full_hd_test_grants where stream_id=s.id for share;
  if not public.stream_full_hd_test_allowed(s.id,p_actor_id) then raise exception 'full_hd_not_enabled'; end if;
  if cfg.max_full_hd_live is null or (select count(*) from public.stream_video_runs r join public.streams t on t.id=r.stream_id and t.livekit_egress_id=r.egress_id where t.status='live' and r.ended_at is null and r.profile='full_hd')>=cfg.max_full_hd_live then raise exception 'full_hd_capacity'; end if;
 end if;
 insert into public.stream_video_runs(egress_id,stream_id,profile) values(p_egress_id,p_stream_id,p_expected_quality);
 update public.streams set livekit_egress_id=p_egress_id,peertube_video_id=p_video_id,mode='multi',status='live',livekit_room=p_stream_id::text where id=p_stream_id;
 delete from public.stream_video_start_reservations where token=p_reservation;
end$$;
revoke all on function public.mark_stream_video_started_scoped(uuid,uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_stream_video_started_scoped(uuid,uuid,text,text,text,uuid,uuid) to service_role;
create or replace function public.mark_stream_video_started(p_stream_id uuid,p_expected_quality text,p_expected_egress_id text,p_egress_id text,p_video_id uuid,p_reservation uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_expected_quality is distinct from 'hd' then raise exception 'full_hd_actor_contract_required'; end if;
 perform public.mark_stream_video_started_scoped(p_stream_id,(select author from public.streams where id=p_stream_id),p_expected_quality,p_expected_egress_id,p_egress_id,p_video_id,p_reservation);
end$$;
commit;
