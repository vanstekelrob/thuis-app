-- V70 is de app van één huis: een nieuw huis aanmaken kan alleen als er nog geen huis bestaat.
-- Staat na init.sql (die create_household elke keer opnieuw aanmaakt), dus deze versie wint.
create or replace function create_household(p_household text, p_name text, p_emoji text default '🙂')
returns text language plpgsql security definer set search_path = public as $$
declare hid uuid; code text;
begin
  if auth.uid() is null then raise exception 'niet ingelogd'; end if;
  if exists (select 1 from members where id = auth.uid()) then raise exception 'al lid van een huis'; end if;
  if exists (select 1 from households) then raise exception 'V70 bestaat al. Vraag een huisgenoot om de uitnodigingslink.'; end if;
  if coalesce(trim(p_household), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'naam ontbreekt'; end if;
  insert into households(name) values (left(trim(p_household), 60)) returning id, join_code into hid, code;
  insert into members(id, household_id, name, emoji, is_admin)
    values (auth.uid(), hid, left(trim(p_name), 30), left(coalesce(nullif(trim(p_emoji), ''), '🙂'), 8), true);
  insert into member_secrets(member_id) values (auth.uid());
  return code;
end $$;
revoke execute on function create_household(text, text, text) from public, anon;
grant execute on function create_household(text, text, text) to authenticated;

-- Eenmalig (12 nov, akkoord Rob): het per ongeluk aangemaakte, lege tweede huis weghalen. Herhalen doet niets.
delete from households where id = '727eece6-68a0-4185-920a-6000cb9200c0';
