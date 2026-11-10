-- Activiteiten & uitgaan: datum en tijd los en optioneel, en huisgenoten "porren" om mee uit te gaan.
-- Idempotent, net als init.sql.

-- ───────── Activiteiten: datum zonder tijd ─────────
-- day = datum (optioneel); starts_at alleen als er ook een tijd is.
alter table activities add column if not exists day date;
update activities set day = (starts_at at time zone 'Europe/Amsterdam')::date where day is null and starts_at is not null;

-- ───────── Porren ─────────
-- Eén keer per avond per persoon: de unieke sleutel voorkomt spam.
create table if not exists out_pokes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default my_household() references households(id) on delete cascade,
  from_member   uuid not null default auth.uid() references members(id) on delete cascade,
  to_member     uuid not null references members(id) on delete cascade,
  day           date not null default (now() at time zone 'Europe/Amsterdam')::date,
  created_at    timestamptz not null default now(),
  unique (from_member, to_member, day),
  check (from_member <> to_member)
);
alter table out_pokes enable row level security;
drop policy if exists "pokes: lezen" on out_pokes;
drop policy if exists "pokes: porren" on out_pokes;
create policy "pokes: lezen"  on out_pokes for select using (household_id = my_household());
create policy "pokes: porren" on out_pokes for insert
  with check (from_member = auth.uid() and household_id = my_household() and in_my_household(to_member)
              and day = (now() at time zone 'Europe/Amsterdam')::date);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'out_pokes') then
    alter publication supabase_realtime add table public.out_pokes;
  end if;
end $$;
