-- Synthetic schema additions and captured production trigger behavior, no real users.
do $$begin if current_database()<>'mg_stream_visibility_test' then raise exception 'disposable_fixture_required';end if;end$$;
alter table public.users add column email text,add column "Name" text;
alter table public.chats add column creator uuid,add column forced_group boolean default false;
create function public.tg_stream_bought_add_to_chat() returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat uuid;begin
 select chat into v_chat from public.streams where backing_course_id=NEW.course and chat is not null limit 1;
 if v_chat is not null and NEW."user" is not null then
  update public.chats set users=array_append(coalesce(users,'{}'::uuid[]),NEW."user"),read=array_append(coalesce(read,'{}'::uuid[]),NEW."user") where id=v_chat and not(NEW."user"=any(coalesce(users,'{}'::uuid[])));
 end if;return NEW;end$$;
create function public.tg_stream_bought_grant_recording() returns trigger language plpgsql security definer set search_path=public as $$
declare v_rec uuid;begin
 select recording_course into v_rec from public.streams where backing_course_id=NEW.course and recording_course is not null limit 1;
 if v_rec is not null and NEW."user" is not null and not exists(select 1 from public.user_course where "user"=NEW."user" and course=v_rec) then
  insert into public.user_course("user",course,"Free") values(NEW."user",v_rec,false);
 end if;return NEW;end$$;
create trigger trg_stream_bought_add_to_chat after insert on public.user_course for each row execute function public.tg_stream_bought_add_to_chat();
create trigger trg_stream_bought_grant_recording after insert on public.user_course for each row execute function public.tg_stream_bought_grant_recording();
-- Model purchase notifications using the actual NEW.buy predicate; no network calls.
drop trigger test_notice on public.user_course;
create trigger test_notice after insert on public.user_course for each row when(NEW.buy is true) execute function public.test_notice();
