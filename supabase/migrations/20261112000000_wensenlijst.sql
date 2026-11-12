-- V70 wensenlijst (12 nov): uitgaan-details, meerdere koks, was dibsen, mededelingen, datumprikker,
-- POV-fotoalbums per activiteit, boetes en anytimers. Idempotent, net als init.sql.

-- ───────── Uitgaan: hoe laat, en "ik ga niet mee" ─────────
alter table members add column if not exists out_time text check (length(out_time) <= 5);
alter table members drop constraint if exists members_out_status_check;
alter table members add constraint members_out_status_check check (out_status in ('none','wants','going','no'));
grant update (out_time) on members to authenticated; -- init.sql zet de kolomrechten opnieuw, dus hier na init

-- ───────── Eten: wie kookt (meerdere koks per avond) ─────────
alter table dinner_rsvps drop constraint if exists dinner_rsvps_answer_check;
alter table dinner_rsvps add constraint dinner_rsvps_answer_check check (answer in ('mee','niet','misschien','kok'));

-- ───────── Was: 2 wasmachines en 2 drogers dibsen ─────────
create table if not exists laundry (
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  machine       text not null check (machine in ('was1','was2','droger1','droger2')),
  member_id     uuid not null default auth.uid() references members(id) on delete cascade,
  until         timestamptz not null,
  primary key (household_id, machine)
);

-- ───────── Mededelingen ─────────
create table if not exists announcements (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  created_by    uuid default auth.uid() references members(id) on delete set null,
  body          text not null check (length(trim(body)) between 1 and 1000),
  created_at    timestamptz not null default now()
);

-- ───────── Datumprikker ─────────
create table if not exists date_polls (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  title         text not null check (length(title) <= 120),
  created_by    uuid default auth.uid() references members(id) on delete set null,
  closed        boolean not null default false,
  created_at    timestamptz not null default now()
);
create table if not exists date_poll_options (
  id            uuid primary key default gen_random_uuid(),
  poll_id       uuid not null references date_polls(id) on delete cascade,
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  day           date not null,
  time          text check (length(time) <= 5)
);
create table if not exists date_poll_votes (
  option_id     uuid not null references date_poll_options(id) on delete cascade,
  member_id     uuid not null default auth.uid() references members(id) on delete cascade,
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  answer        text not null check (answer in ('ja','misschien','nee')),
  primary key (option_id, member_id)
);

-- ───────── POV-album per activiteit ─────────
-- Foto's maken mag vanaf de start van de activiteit tot het album "ontwikkelt": de dag erna om 10:00.
-- Tot dan ziet iedereen alleen zijn eigen foto's. Max. 25 per persoon per activiteit.
create table if not exists pov_photos (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  activity_id   uuid not null references activities(id) on delete cascade,
  member_id     uuid not null default auth.uid() references members(id) on delete cascade,
  path          text not null unique,
  created_at    timestamptz not null default now()
);
create or replace function pov_start(p_activity uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(starts_at, (day::timestamp at time zone 'Europe/Amsterdam')) from activities where id = p_activity
$$;
create or replace function pov_reveal(p_activity uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ((coalesce(day, (starts_at at time zone 'Europe/Amsterdam')::date) + 1)::timestamp + interval '10 hours') at time zone 'Europe/Amsterdam'
  from activities where id = p_activity
$$;

-- ───────── Boetes ─────────
alter table households add column if not exists iban text check (length(iban) <= 40);
alter table households add column if not exists iban_name text check (length(iban_name) <= 70);
create table if not exists fines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  member_id     uuid not null references members(id) on delete cascade,
  amount        numeric(6,2) not null check (amount > 0 and amount <= 500),
  reason        text not null check (length(reason) between 1 and 120),
  created_by    uuid default auth.uid() references members(id) on delete set null,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create or replace function set_house_iban(p_iban text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'alleen beheerders'; end if;
  update households set iban = nullif(upper(replace(trim(p_iban), ' ', '')), ''), iban_name = nullif(trim(p_name), '') where id = my_household();
end $$;

-- ───────── Anytimers ─────────
-- holder heeft een anytimer op debtor. pending → (debtor accepteert) open → (holder zet in) claimed → (debtor stuurt foto) done.
create table if not exists anytimers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  holder        uuid not null default auth.uid() references members(id) on delete cascade,
  debtor        uuid not null references members(id) on delete cascade,
  reason        text check (length(reason) <= 120),
  status        text not null default 'pending' check (status in ('pending','open','claimed','done')),
  photo_path    text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  done_at       timestamptz,
  check (holder <> debtor)
);
create or replace function anytimer_act(p_id uuid, p_action text, p_photo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a anytimers;
begin
  select * into a from anytimers where id = p_id and household_id = my_household() for update;
  if a.id is null then raise exception 'anytimer niet gevonden'; end if;
  if p_action = 'accept' and a.debtor = auth.uid() and a.status = 'pending' then
    update anytimers set status = 'open' where id = p_id;
  elsif p_action = 'reject' and a.debtor = auth.uid() and a.status = 'pending' then
    delete from anytimers where id = p_id;
  elsif p_action = 'cancel' and a.holder = auth.uid() and a.status in ('pending','open') then
    delete from anytimers where id = p_id;
  elsif p_action = 'claim' and a.holder = auth.uid() and a.status = 'open' then
    update anytimers set status = 'claimed', claimed_at = now() where id = p_id;
  elsif p_action = 'proof' and a.debtor = auth.uid() and a.status = 'claimed'
        and p_photo like my_household()::text || '/anytimer/' || auth.uid()::text || '/%' then
    update anytimers set status = 'done', photo_path = p_photo, done_at = now() where id = p_id;
  else
    raise exception 'niet toegestaan';
  end if;
end $$;

-- ───────── Rechten (RLS) ─────────
do $$
declare t text;
begin
  foreach t in array array['laundry','announcements','date_polls','date_poll_options','date_poll_votes','pov_photos','fines','anytimers'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists "was: lezen" on laundry;
drop policy if exists "was: dibsen" on laundry;
drop policy if exists "was: overnemen" on laundry;
drop policy if exists "was: vrijgeven" on laundry;
create policy "was: lezen"     on laundry for select using (household_id = my_household());
create policy "was: dibsen"    on laundry for insert with check (household_id = my_household() and member_id = auth.uid() and until <= now() + interval '4 hours');
create policy "was: overnemen" on laundry for update using (household_id = my_household() and (member_id = auth.uid() or until < now()))
  with check (household_id = my_household() and member_id = auth.uid() and until <= now() + interval '4 hours');
create policy "was: vrijgeven" on laundry for delete using (household_id = my_household() and member_id = auth.uid());

drop policy if exists "mededeling: lezen" on announcements;
drop policy if exists "mededeling: plaatsen" on announcements;
drop policy if exists "mededeling: weg" on announcements;
create policy "mededeling: lezen"    on announcements for select using (household_id = my_household());
create policy "mededeling: plaatsen" on announcements for insert with check (household_id = my_household() and created_by = auth.uid());
create policy "mededeling: weg"      on announcements for delete using (household_id = my_household() and (created_by = auth.uid() or is_admin()));

drop policy if exists "prikker: lezen" on date_polls;
drop policy if exists "prikker: maken" on date_polls;
drop policy if exists "prikker: sluiten" on date_polls;
drop policy if exists "prikker: weg" on date_polls;
create policy "prikker: lezen"   on date_polls for select using (household_id = my_household());
create policy "prikker: maken"   on date_polls for insert with check (household_id = my_household() and created_by = auth.uid());
create policy "prikker: sluiten" on date_polls for update using (household_id = my_household() and (created_by = auth.uid() or is_admin())) with check (household_id = my_household());
create policy "prikker: weg"     on date_polls for delete using (household_id = my_household() and (created_by = auth.uid() or is_admin()));
drop policy if exists "opties: lezen" on date_poll_options;
drop policy if exists "opties: maken" on date_poll_options;
create policy "opties: lezen" on date_poll_options for select using (household_id = my_household());
create policy "opties: maken" on date_poll_options for insert
  with check (household_id = my_household() and exists (select 1 from date_polls p where p.id = poll_id and p.created_by = auth.uid()));
drop policy if exists "stemmen: lezen" on date_poll_votes;
drop policy if exists "stemmen: stemmen" on date_poll_votes;
drop policy if exists "stemmen: wijzigen" on date_poll_votes;
drop policy if exists "stemmen: weg" on date_poll_votes;
create policy "stemmen: lezen"    on date_poll_votes for select using (household_id = my_household());
create policy "stemmen: stemmen"  on date_poll_votes for insert
  with check (member_id = auth.uid() and household_id = my_household() and exists (select 1 from date_poll_options o where o.id = option_id and o.household_id = my_household()));
create policy "stemmen: wijzigen" on date_poll_votes for update using (member_id = auth.uid()) with check (member_id = auth.uid() and household_id = my_household());
create policy "stemmen: weg"      on date_poll_votes for delete using (member_id = auth.uid());

drop policy if exists "pov: lezen" on pov_photos;
drop policy if exists "pov: maken" on pov_photos;
drop policy if exists "pov: weg" on pov_photos;
create policy "pov: lezen" on pov_photos for select
  using (member_id = auth.uid() or (household_id = my_household() and now() >= pov_reveal(activity_id)));
create policy "pov: maken" on pov_photos for insert
  with check (member_id = auth.uid() and household_id = my_household()
              and path like my_household()::text || '/pov/' || auth.uid()::text || '/%'
              and exists (select 1 from activities a where a.id = activity_id and a.household_id = my_household())
              and now() between pov_start(activity_id) and pov_reveal(activity_id)
              and (select count(*) from pov_photos p where p.activity_id = pov_photos.activity_id and p.member_id = auth.uid()) < 25);
create policy "pov: weg" on pov_photos for delete using (member_id = auth.uid());

drop policy if exists "boete: lezen" on fines;
drop policy if exists "boete: geven" on fines;
drop policy if exists "boete: betaald" on fines;
drop policy if exists "boete: weg" on fines;
create policy "boete: lezen"   on fines for select using (household_id = my_household() and (member_id = auth.uid() or is_admin()));
create policy "boete: geven"   on fines for insert with check (household_id = my_household() and is_admin() and in_my_household(member_id) and paid_at is null);
create policy "boete: betaald" on fines for update using (household_id = my_household() and is_admin()) with check (household_id = my_household());
create policy "boete: weg"     on fines for delete using (household_id = my_household() and is_admin());

drop policy if exists "anytimer: lezen" on anytimers;
drop policy if exists "anytimer: claimen" on anytimers;
create policy "anytimer: lezen"   on anytimers for select using (household_id = my_household() and (holder = auth.uid() or debtor = auth.uid()));
create policy "anytimer: claimen" on anytimers for insert
  with check (household_id = my_household() and holder = auth.uid() and in_my_household(debtor) and status = 'pending' and photo_path is null);
-- (verder alleen via anytimer_act)

do $$
declare f text;
begin
  foreach f in array array['set_house_iban(text,text)', 'anytimer_act(uuid,text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['laundry','announcements','date_polls','date_poll_options','date_poll_votes','pov_photos','fines','anytimers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = f) then
      execute format('alter publication supabase_realtime add table public.%I', f);
    end if;
  end loop;
end $$;

-- ───────── Opslag voor foto's (Supabase Storage) ─────────
-- Pad: <huis>/<pov|anytimer>/<gebruiker>/<naam>.jpg. Lezen mag als je de bijbehorende rij mag zien
-- (pov_photos / anytimers RLS bepaalt dat: anytimer-bewijs alleen voor gever en doener).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('v70', 'v70', false) on conflict (id) do nothing;
    drop policy if exists "v70: lezen" on storage.objects;
    drop policy if exists "v70: uploaden" on storage.objects;
    drop policy if exists "v70: weg" on storage.objects;
    create policy "v70: lezen" on storage.objects for select to authenticated using (
      bucket_id = 'v70' and (exists (select 1 from public.pov_photos p where p.path = name)
                          or exists (select 1 from public.anytimers a where a.photo_path = name)));
    create policy "v70: uploaden" on storage.objects for insert to authenticated with check (
      bucket_id = 'v70' and (storage.foldername(name))[1] = public.my_household()::text
      and (storage.foldername(name))[2] in ('pov', 'anytimer') and (storage.foldername(name))[3] = auth.uid()::text);
    create policy "v70: weg" on storage.objects for delete to authenticated using (
      bucket_id = 'v70' and (storage.foldername(name))[3] = auth.uid()::text);
  end if;
end $$;
