-- Was dibsen per tijdvak (ook nachtwas) en foto-archief naar Google Drive. Idempotent.

-- ───────── Was: tijdvakken ─────────
-- Vervangt het "nu dibsen" van laundry (die tabel blijft staan maar wordt niet meer gebruikt).
create table if not exists laundry_slots (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  machine       text not null check (machine in ('was1','was2','droger1','droger2')),
  member_id     uuid not null default auth.uid() references members(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  check (ends_at > starts_at and ends_at - starts_at <= interval '10 hours') -- 10 uur: genoeg voor een nachtwas
);
alter table laundry_slots enable row level security;
drop policy if exists "wasslot: lezen" on laundry_slots;
drop policy if exists "wasslot: dibsen" on laundry_slots;
drop policy if exists "wasslot: weg" on laundry_slots;
create policy "wasslot: lezen" on laundry_slots for select using (household_id = my_household());
create policy "wasslot: dibsen" on laundry_slots for insert with check (
  household_id = my_household() and member_id = auth.uid()
  and ends_at > now() and starts_at < now() + interval '8 days'
  and not exists (select 1 from laundry_slots l where l.household_id = my_household() and l.machine = laundry_slots.machine
                  and l.starts_at < laundry_slots.ends_at and l.ends_at > laundry_slots.starts_at));
create policy "wasslot: weg" on laundry_slots for delete using (household_id = my_household() and (member_id = auth.uid() or is_admin()));

-- ───────── Fotoalbums naar Google Drive ─────────
-- De beheerder zet de link naar de huis-Drive; na archiveren staat bij de activiteit de link naar haar mapje.
alter table households add column if not exists drive_url text check (length(drive_url) <= 300);
alter table activities add column if not exists drive_url text check (length(drive_url) <= 300);
create or replace function set_house_drive(p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'alleen beheerders'; end if;
  if p_url is not null and p_url <> '' and p_url !~ '^https://drive\.google\.com/' then raise exception 'geen Google Drive-link'; end if;
  update households set drive_url = nullif(trim(p_url), '') where id = my_household();
end $$;
revoke execute on function set_house_drive(text) from public, anon;
grant execute on function set_house_drive(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laundry_slots') then
    alter publication supabase_realtime add table public.laundry_slots;
  end if;
end $$;

-- Archiveren: 's nachts elk uur (02:15–06:15 NL) een stukje; de functie doet niets als er niets te archiveren is
-- of als het Drive-script nog niet is ingesteld.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('v70-drive-archief', '15 1-5 * * *',
      $cron$select net.http_post(url := 'https://bahjkjwvtrfqzrhygdis.supabase.co/functions/v1/notify',
        body := '{"type":"archive"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)$cron$);
  end if;
end $$;
