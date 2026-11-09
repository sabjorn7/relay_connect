-- OWNER MANUAL ONLY. Replace both UUID placeholders; no secret required.
-- Use an existing, idle, hidden free multi-host test stream; never a real customer's event.
begin;
set local lock_timeout='3s';
select pg_advisory_xact_lock(78403191);
do $$
declare test_stream uuid:='REPLACE_STREAM_UUID'; test_owner uuid:='REPLACE_OWNER_UUID'; s public.streams%rowtype;
begin
 select * into s from public.streams where id=test_stream for update;
 if not found or s.author is distinct from test_owner or s.mode<>'multi' or s.status='live' or s.visibility<>'unlisted' or coalesce(s.price,-1)<>0 or coalesce(s.hidden,true) then raise exception 'select_an_idle_owned_hidden_free_multi_test_stream'; end if;
 if not exists(select 1 from public.stream_video_quality_settings where singleton and not full_hd_enabled and max_full_hd_live=1) then raise exception 'unexpected_global_settings'; end if;
 if exists(select 1 from public.stream_video_start_reservations) or exists(select 1 from public.stream_video_runs r join public.streams t on t.id=r.stream_id and t.livekit_egress_id=r.egress_id where t.status='live' and r.ended_at is null and r.profile='full_hd') then raise exception 'resolve_existing_full_hd_or_reservation_first'; end if;
 -- No implicit reassignment of another enabled test grant.
 if exists(select 1 from public.stream_full_hd_test_grants where enabled and stream_id<>test_stream) then raise exception 'explicitly_revoke_previous_test_grant_first'; end if;
 insert into public.stream_full_hd_test_grants(stream_id,owner_id,enabled,expires_at)
 values(test_stream,test_owner,true,clock_timestamp()+interval '2 hours')
 on conflict(stream_id) do update set owner_id=excluded.owner_id,enabled=true,expires_at=excluded.expires_at,granted_at=clock_timestamp();
end$$;
commit;
-- Does NOT change streams.video_quality. Organizer chooses Full HD in existing edit form.
