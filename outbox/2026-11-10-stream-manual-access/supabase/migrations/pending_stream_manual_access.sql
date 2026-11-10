-- OWNER MANUAL ONLY. No payment, order, sale or balance writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.grant_stream_access_by_email(p_stream_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid:=auth.uid();s public.streams%rowtype;target uuid;matches integer;
 v_email text:=lower(btrim(p_email));access public.user_course%rowtype;existing integer;
 months integer;local_now timestamp:=transaction_timestamp() at time zone 'UTC';ends timestamptz;
begin
 if actor is null then raise exception 'auth_required' using errcode='42501';end if;
 select * into s from public.streams where id=p_stream_id for update;
 if not found or s.author is distinct from actor then raise exception 'not_stream_owner' using errcode='42501';end if;
 if s.price<=0 or s.backing_course_id is null then raise exception 'not_paid_stream';end if;
 if v_email is null or length(v_email)>320 or v_email!~'^[^[:space:]@]+@[^[:space:]@]+$' then raise exception 'invalid_email';end if;
 -- Verify linkage before INSERT triggers can grant chat or recording access.
 if not exists(select 1 from public.course where id=s.backing_course_id and owner=actor)
  or (select count(*) from public.streams where backing_course_id=s.backing_course_id)<>1 then raise exception 'invalid_stream_access_configuration';end if;
 if s.chat_enabled then
  if s.chat is null or not exists(select 1 from public.chats where id=s.chat and creator=actor and forced_group is true) then raise exception 'invalid_stream_access_configuration';end if;
 elsif s.chat is not null then raise exception 'invalid_stream_access_configuration';end if;
 if s.recording_course_enabled then
  if s.recording_course is null or s.recording_course=s.backing_course_id or not exists(select 1 from public.course where id=s.recording_course and owner=actor) then raise exception 'invalid_stream_access_configuration';end if;
 elsif s.recording_course is not null then raise exception 'invalid_stream_access_configuration';end if;
 select count(*),(array_agg(id))[1] into matches,target from public.users where lower(btrim(users.email))=v_email;
 if matches=0 then raise exception 'registered_user_not_found';end if;
 if matches<>1 then raise exception 'ambiguous_email';end if;
 -- Same author row and per-buyer/course lock as verified BuyCourse fulfillment.
 perform 1 from public.users where id=actor for update;
 perform pg_advisory_xact_lock(hashtextextended('order-access:'||target::text||':'||s.backing_course_id::text,0));
 select count(*) into existing from public.user_course where "user"=target and course=s.backing_course_id;
 if existing>1 then raise exception 'ambiguous_existing_access';end if;
 if existing=1 then
  select * into access from public.user_course where "user"=target and course=s.backing_course_id for update;
  if access.buy is true or access."Free" is true then return jsonb_build_object('status','already_has_access','access_id',access.id);end if;
  update public.user_course set "Free"=true where id=access.id returning * into access;
 else
  select coalesce("DurationLong",0)::integer into months from public.course where id=s.backing_course_id;
  if months<>0 then
   -- Same new-access UTC date convention and JS month rollover as BuyCourse.
   ends:=date_trunc('day',date_trunc('month',local_now)+make_interval(months=>months)+(extract(day from local_now)::integer-1)*interval '1 day') at time zone 'UTC';
  end if;
  insert into public.user_course("user",course,"Free",buy,end_period) values(target,s.backing_course_id,true,false,ends) returning * into access;
 end if;
 -- Existing INSERT triggers handle new rows. Reconcile UPDATE of an old placeholder too.
 if s.chat_enabled then
  update public.chats set users=array_append(coalesce(users,'{}'::uuid[]),target),read=array_append(coalesce(read,'{}'::uuid[]),target)
   where id=s.chat and not(target=any(coalesce(users,'{}'::uuid[])));
 end if;
 if s.recording_course_enabled then
  perform pg_advisory_xact_lock(hashtextextended('order-access:'||target::text||':'||s.recording_course::text,0));
  if not exists(select 1 from public.user_course where "user"=target and course=s.recording_course) then
   -- Exactly the existing tg_stream_bought_grant_recording entitlement shape.
   insert into public.user_course("user",course,"Free") values(target,s.recording_course,false);
  end if;
 end if;
 return jsonb_build_object('status','granted','access_id',access.id);
end$$;
revoke all on function public.grant_stream_access_by_email(uuid,text) from public,anon,authenticated;
grant execute on function public.grant_stream_access_by_email(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
