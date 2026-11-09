-- Afvaldienst V70: elke week (dinsdag t/m maandag) twee buren. De kamers schuiven door: 5+6, 7+8, …, 15+16, 17+1, 2+3, …
-- Zelfde regels als AFVAL in app/rota.js (week van 2026-11-10 = kamer 5+6, 17 kamers): pas ze samen aan.
-- Idempotent, net als init.sql.

-- ───────── Kamers ─────────
alter table members add column if not exists room int check (room between 1 and 17);
create unique index if not exists members_room_key on members (household_id, room) where room is not null;

create or replace function set_room(p_room int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_household() is null then raise exception 'geen lid van een huis'; end if;
  if p_room is null or p_room not between 1 and 17 then raise exception 'kies een kamer van 1 t/m 17'; end if;
  if exists (select 1 from members where household_id = my_household() and room = p_room and id <> auth.uid()) then
    raise exception 'kamer % is al bezet', p_room;
  end if;
  update members set room = p_room where id = auth.uid();
end $$;

-- ───────── Rooster ─────────
-- Ruil-uitzonderingen: in de week week_start doet member_id de plek van kamer room.
create table if not exists afval_overrides (
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  week_start    date not null,
  room          int  not null,
  member_id     uuid not null references members(id) on delete cascade,
  primary key (household_id, week_start, room)
);

-- to_member leeg = verzoek aan iedereen; wie als eerste accepteert, ruilt.
create table if not exists afval_swaps (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  from_member   uuid not null references members(id) on delete cascade,
  week_start    date not null,
  to_member     uuid references members(id) on delete cascade,
  status        text not null default 'open' check (status in ('open','accepted','declined','cancelled')),
  accepted_by   uuid references members(id) on delete set null,
  other_week    date,
  created_at    timestamptz not null default now()
);

-- Op welke dagen de herinnering al is verstuurd (alleen de Edge Function schrijft hier).
create table if not exists afval_reminders (
  day      date primary key,
  sent_at  timestamptz not null default now()
);

alter table afval_overrides enable row level security;
alter table afval_swaps enable row level security;
alter table afval_reminders enable row level security;
drop policy if exists "afval_overrides: lezen" on afval_overrides;
drop policy if exists "afval_swaps: lezen" on afval_swaps;
create policy "afval_overrides: lezen" on afval_overrides for select using (household_id = my_household());
create policy "afval_swaps: lezen"     on afval_swaps     for select using (household_id = my_household());
-- (schrijven gaat alleen via de RPC's hieronder)

create or replace function afval_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Amsterdam')::date $$;

create or replace function afval_week_start(p_day date) returns date
language sql immutable set search_path = public as $$ select date '2026-11-10' + 7 * floor((p_day - date '2026-11-10') / 7.0)::int $$;

-- Kamer op plek k (0 of 1) in de week die begint op p_week.
create or replace function afval_room(p_week date, k int) returns int
language sql immutable set search_path = public as $$ select ((((4 + 2 * ((p_week - date '2026-11-10') / 7) + k) % 17) + 17) % 17) + 1 $$;

create or replace function afval_holder(p_hh uuid, p_week date, p_room int) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select member_id from afval_overrides where household_id = p_hh and week_start = p_week and room = p_room),
                  (select id from members where household_id = p_hh and room = p_room))
$$;

-- Welke plek (oorspronkelijke kamer) heeft dit lid in die week? null = geen dienst.
create or replace function afval_slot(p_hh uuid, p_week date, p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select r from (values (afval_room(p_week, 0)), (afval_room(p_week, 1))) v(r)
  where afval_holder(p_hh, p_week, r) = p_member limit 1
$$;

-- Eerstvolgende week vanaf p_from waarin dit lid dienst heeft, behalve p_not.
create or replace function afval_next_week(p_hh uuid, p_member uuid, p_from date, p_not date) returns date
language plpgsql stable security definer set search_path = public as $$
declare w date := afval_week_start(p_from);
begin
  for i in 0..40 loop
    if w is distinct from p_not and afval_slot(p_hh, w, p_member) is not null then return w; end if;
    w := w + 7;
  end loop;
  return null;
end $$;

-- Ruilverzoek voor een eigen week; p_to leeg = aan iedereen.
create or replace function afval_request_swap(p_week date, p_to uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid := my_household(); sid uuid;
begin
  if hid is null then raise exception 'geen lid van een huis'; end if;
  if p_week < afval_week_start(afval_today()) then raise exception 'die week is al voorbij'; end if;
  if afval_slot(hid, p_week, auth.uid()) is null then raise exception 'je hebt die week geen afvaldienst'; end if;
  if p_to is not null and (p_to = auth.uid() or not in_my_household(p_to) or afval_slot(hid, p_week, p_to) is not null) then
    raise exception 'met die persoon kun je niet ruilen';
  end if;
  if exists (select 1 from afval_swaps where from_member = auth.uid() and week_start = p_week and status = 'open') then
    raise exception 'je hebt al een open ruilverzoek voor die week';
  end if;
  insert into afval_swaps(household_id, from_member, week_start, to_member) values (hid, auth.uid(), p_week, p_to) returning id into sid;
  return sid;
end $$;

-- 'accept': de accepteerder neemt de week van de aanvrager, de aanvrager de eerstvolgende week van de accepteerder.
-- 'decline' (alleen bij een verzoek aan jou) en 'cancel' (alleen de aanvrager). Geeft bij accept de geruilde week terug.
create or replace function afval_respond_swap(p_id uuid, p_action text)
returns date language plpgsql security definer set search_path = public as $$
declare s afval_swaps; hid uuid := my_household(); mine date; slot_from int; slot_me int;
begin
  select * into s from afval_swaps where id = p_id and household_id = hid and status = 'open' for update;
  if s.id is null then raise exception 'verzoek niet gevonden of al afgehandeld'; end if;
  if p_action = 'cancel' and s.from_member = auth.uid() then
    update afval_swaps set status = 'cancelled' where id = p_id; return null;
  end if;
  if p_action = 'decline' and s.to_member = auth.uid() then
    update afval_swaps set status = 'declined' where id = p_id; return null;
  end if;
  if p_action <> 'accept' or s.from_member = auth.uid() or (s.to_member is not null and s.to_member <> auth.uid()) then
    raise exception 'niet toegestaan';
  end if;
  slot_from := afval_slot(hid, s.week_start, s.from_member);
  if slot_from is null or s.week_start < afval_week_start(afval_today()) then raise exception 'dit verzoek klopt niet meer'; end if;
  if afval_slot(hid, s.week_start, auth.uid()) is not null then raise exception 'je hebt die week zelf al afvaldienst'; end if;
  mine := afval_next_week(hid, auth.uid(), afval_today(), s.week_start);
  if mine is null then raise exception 'je hebt geen afvaldienst om te ruilen'; end if;
  if afval_slot(hid, mine, s.from_member) is not null then raise exception 'jullie hebben die week al samen dienst'; end if;
  slot_me := afval_slot(hid, mine, auth.uid());
  insert into afval_overrides(household_id, week_start, room, member_id) values (hid, s.week_start, slot_from, auth.uid())
    on conflict (household_id, week_start, room) do update set member_id = excluded.member_id;
  insert into afval_overrides(household_id, week_start, room, member_id) values (hid, mine, slot_me, s.from_member)
    on conflict (household_id, week_start, room) do update set member_id = excluded.member_id;
  update afval_swaps set status = 'accepted', accepted_by = auth.uid(), other_week = mine where id = p_id;
  return mine;
end $$;

do $$
declare f text;
begin
  -- Hulpfuncties alleen intern (de RPC's draaien als eigenaar).
  foreach f in array array['afval_holder(uuid,date,int)', 'afval_slot(uuid,date,uuid)', 'afval_next_week(uuid,uuid,date,date)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['set_room(int)', 'afval_request_swap(date,uuid)', 'afval_respond_swap(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['afval_overrides', 'afval_swaps'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = f) then
      execute format('alter publication supabase_realtime add table public.%I', f);
    end if;
  end loop;
end $$;

-- ───────── Herinnering ma/wo/vr 17:00 ─────────
-- pg_cron draait in UTC: 15:00 en 16:00 UTC dekt zomer- en wintertijd. De Edge Function stuurt alleen als het in
-- Amsterdam 17:00 is en maar één keer per dag (afval_reminders), dus de functie mag openbaar aanroepbaar zijn.
-- Projectadres staat hier vast (het staat ook openbaar in app/config.js).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('v70-afvaldienst', '0 15,16 * * 1,3,5',
      $cron$select net.http_post(url := 'https://bahjkjwvtrfqzrhygdis.supabase.co/functions/v1/notify',
        body := '{"type":"afval"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)$cron$);
  end if;
end $$;
