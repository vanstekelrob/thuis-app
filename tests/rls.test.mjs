// RLS- en RPC-test op een echte Postgres (PGlite, WASM) met een nagebootste Supabase-omgeving.
// Draaien:  npm test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create publication supabase_realtime;
`);

const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (let i = 0; i < 2; i++) for (const f of migrations) await db.exec(readFileSync(new URL(f, dir), 'utf8')); // 2x: idempotent

const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [A, B, C, D] = [1, 2, 3, 4].map(uid);
await db.exec(`insert into auth.users select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 20) g`);

// Voer SQL uit als een bepaalde gebruiker (zoals PostgREST dat doet).
async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? '']);
    return (await tx.query(sql, params)).rows;
  });
}
const fails = async (p, re) => assert.match((await p.then(() => ({ message: 'GEEN FOUT' }), (e) => e)).message, re);
const today = new Date().toISOString().slice(0, 10);

// ── Huis maken en aansluiten ──
const [{ code }] = await as(A, `select create_household('Huize A', 'Anna', '🦊') as code`);
assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/, 'join-code: 8 tekens zonder verwarrende tekens');
assert.equal((await as(A, `select is_admin from members`))[0].is_admin, true, 'maker is beheerder');
await as(B, `select join_household($1, 'Bob', '')`, [code.toLowerCase()]);
await as(C, `select create_household('Huize C', 'Cas')`);
await fails(as(D, `select join_household('ZZZZZZZZ', 'x')`), /onbekende code/);
await fails(as(D, `select join_household($1, '  ')`, [code]), /naam ontbreekt/);
await fails(as(null, `select create_household('x', 'y')`), /permission denied/);
await fails(as(A, `select create_household('x', 'y')`), /al lid/);
assert.equal((await as(B, `select emoji, is_admin from members where id = $1`, [B]))[0].emoji, '🙂', 'lege emoji → standaard');

// ── Leden zien alleen eigen huis; geen rechten ophogen ──
assert.equal((await as(A, `select * from members`)).length, 2);
assert.equal((await as(C, `select * from members`)).length, 1);
assert.equal((await as(C, `select * from households`)).length, 1);
assert.equal((await as(B, `update members set zone = 'away' where id = $1 returning id`, [A])).length, 0);
await fails(as(B, `update members set is_admin = true where id = $1`, [B]), /permission denied/);
const hidC = (await as(C, `select household_id from members`))[0].household_id;
await fails(as(B, `update members set household_id = $1 where id = $2`, [hidC, B]), /permission denied/);
await as(B, `update members set out_status = 'wants', out_place = 'Stad' where id = $1`, [B]);
await fails(as(B, `select set_admin($1, true)`, [B]), /alleen beheerders/);

// ── Beurtenrooster ──
await fails(as(B, `select create_chore('Afval', '🗑️', $1::date)`, [today]), /alleen beheerders/);
const [{ id: chore }] = await as(A, `select create_chore('Afval buiten zetten', '', $1::date, 7, 1) as id`, [today]);
assert.deepEqual((await as(B, `select member_id from chore_rotation order by position`)).map((r) => r.member_id), [A, B]);
assert.equal((await as(C, `select * from chore_rotation`)).length, 0);
await as(D, `select join_household($1, 'Dirk')`, [code]);
assert.deepEqual((await as(A, `select member_id from chore_rotation order by position`)).map((r) => r.member_id), [A, B, D], 'nieuwkomer achteraan');
await as(A, `select move_rotation($1, $2, -1)`, [chore, D]);
assert.deepEqual((await as(A, `select member_id from chore_rotation order by position`)).map((r) => r.member_id), [A, D, B]);
await fails(as(B, `select move_rotation($1, $2, 1)`, [chore, A]), /alleen beheerders/);
await fails(as(B, `insert into chores(name) values ('stiekem')`), /row-level security/);
await fails(as(B, `insert into chore_overrides(chore_id, period_start, member_id) values ($1, $2, $3)`, [chore, today, B]), /row-level security/);
await fails(as(A, `insert into chore_overrides(chore_id, period_start, member_id) values ($1, $2, $3)`, [chore, today, C]), /row-level security/);
await as(A, `insert into chore_overrides(chore_id, period_start, member_id, reason) values ($1, $2, $3, 'handmatig')`, [chore, today, B]);

// Afvinken
await as(B, `insert into chore_done(chore_id, period_start) values ($1, $2)`, [chore, today]);
await fails(as(C, `insert into chore_done(chore_id, period_start, slot) values ($1, $2, 1)`, [chore, today]), /row-level security|foreign key/);
assert.equal((await as(D, `delete from chore_done returning chore_id`)).length, 0, 'D mag Bobs vinkje niet weghalen');
assert.equal((await as(A, `delete from chore_done returning chore_id`)).length, 1, 'beheerder wel');

// Ruilen
const [sw] = await as(B, `insert into swap_requests(chore_id, period_start, to_member) values ($1, $2, $3) returning id`, [chore, today, D]);
const [sw2] = await as(B, `insert into swap_requests(chore_id, period_start, to_member) values ($1, $2, $3) returning id`, [chore, today, A]);
await fails(as(B, `insert into swap_requests(chore_id, period_start, to_member) values ($1, $2, $3)`, [chore, today, C]), /row-level security/);
await fails(as(B, `insert into swap_requests(chore_id, period_start, to_member) values ($1, $2, $3)`, [chore, today, B]), /check constraint/);
await fails(as(B, `insert into swap_requests(chore_id, period_start, to_member, status) values ($1, $2, $3, 'accepted')`, [chore, today, D]), /row-level security/);
assert.equal((await as(B, `update swap_requests set status = 'accepted' returning id`)).length, 0, 'status alleen via RPC');
await fails(as(B, `select respond_swap($1, 'accept')`, [sw.id]), /niet toegestaan/);
await fails(as(C, `select respond_swap($1, 'accept')`, [sw.id]), /niet gevonden/);
await as(D, `select respond_swap($1, 'accept')`, [sw.id]);
assert.equal((await as(A, `select member_id, reason from chore_overrides`))[0].member_id, D);
assert.equal((await as(A, `select status from swap_requests where id = $1`, [sw2.id]))[0].status, 'cancelled', 'ander open verzoek achterhaald');
await fails(as(D, `select respond_swap($1, 'decline')`, [sw.id]), /al afgehandeld/);

// ── Activiteiten + RSVP ──
const [act] = await as(B, `insert into activities(title) values ('Filmavond') returning id, created_by`);
assert.equal(act.created_by, B);
await fails(as(B, `insert into activities(title, created_by) values ('x', $1)`, [A]), /row-level security/);
assert.equal((await as(A, `select * from activities`)).length, 1);
assert.equal((await as(C, `select * from activities`)).length, 0);
await as(D, `insert into activity_rsvps(activity_id, answer) values ($1, 'mee')`, [act.id]);
await fails(as(A, `insert into activity_rsvps(activity_id, member_id, answer) values ($1, $2, 'niet')`, [act.id, B]), /row-level security/);
await fails(as(C, `insert into activity_rsvps(activity_id, answer) values ($1, 'mee')`, [act.id]), /row-level security/);
assert.equal((await as(D, `delete from activities where id = $1 returning id`, [act.id])).length, 0, 'alleen maker of beheerder');
assert.equal((await as(A, `delete from activities where id = $1 returning id`, [act.id])).length, 1, 'beheerder mag');

// ── Eten ──
await as(A, `insert into dinners(day) values ($1) on conflict (household_id, day) do nothing`, [today]);
const [din] = await as(B, `insert into dinners(day, menu, cook_id) values ($1, 'Pasta', $2) on conflict (household_id, day) do update set menu = excluded.menu, cook_id = excluded.cook_id returning id, menu`, [today, B]);
assert.equal(din.menu, 'Pasta');
await fails(as(B, `update dinners set cook_id = $1`, [C]), /row-level security/);
await as(C, `insert into dinners(day, menu) values ($1, 'Soep') on conflict (household_id, day) do update set menu = excluded.menu`, [today]);
assert.equal((await as(A, `select menu from dinners`))[0].menu, 'Pasta', 'C overschrijft A niet');
await as(B, `insert into dinner_rsvps(dinner_id, answer, guests) values ($1, 'mee', 2)`, [din.id]);
await fails(as(C, `insert into dinner_rsvps(dinner_id, answer) values ($1, 'mee')`, [din.id]), /row-level security/);
await fails(as(B, `insert into dinner_rsvps(dinner_id, answer, guests) values ($1, 'mee', 11) on conflict (dinner_id, member_id) do update set guests = excluded.guests`, [din.id]), /check constraint/);

// ── Shortcut-token ──
assert.equal((await as(B, `select * from member_secrets`)).length, 1);
const [{ token }] = await as(A, `select token from member_secrets`);
await as(null, `select set_zone_by_token($1, 'home')`, [token]);
assert.equal((await as(B, `select zone from members where id = $1`, [A]))[0].zone, 'home');
await fails(as(null, `select set_zone_by_token($1, 'mars')`, [token]), /ongeldige zone/);
await fails(as(null, `select set_zone_by_token('fout', 'home')`), /onbekende token/);

// ── Push-abonnementen ──
await as(A, `select save_push_subscription('https://push.example/1', 'p', 'a')`);
assert.equal((await as(A, `select * from push_subscriptions`)).length, 1);
assert.equal((await as(B, `select * from push_subscriptions`)).length, 0);
await as(B, `select save_push_subscription('https://push.example/1', 'p2', 'a2')`); // zelfde toestel, ander account
assert.equal((await as(B, `select * from push_subscriptions`)).length, 1);
assert.equal((await as(A, `select * from push_subscriptions`)).length, 0);
await fails(as(A, `insert into push_subscriptions values ('https://x', $1, (select household_id from members limit 1), 'p', 'a')`, [A]), /row-level security/);
await fails(as(A, `select save_push_subscription('http://evil', 'p', 'a')`), /ongeldig endpoint/);
await fails(as(null, `select save_push_subscription('https://x', 'p', 'a')`), /permission denied/);

// ── Beheer: huisgenoot verwijderen ──
assert.equal((await as(B, `delete from members where id = $1 returning id`, [D])).length, 0, 'geen beheerder');
assert.equal((await as(A, `delete from members where id = $1 returning id`, [A])).length, 0, 'jezelf niet');
await as(A, `select set_admin($1, true)`, [B]);
await fails(as(A, `select set_admin($1, false)`, [A]), /niet degraderen/);
assert.equal((await as(B, `delete from members where id = $1 returning id`, [D])).length, 1);
assert.deepEqual((await as(A, `select member_id from chore_rotation order by position`)).map((r) => r.member_id), [A, B], 'weg uit rotatie');
assert.equal((await as(B, `select * from push_subscriptions`)).length, 1);

// ── 17 huisgenoten ──
for (let n = 5; n <= 19; n++) await as(uid(n), `select join_household($1, $2)`, [code, `Huisgenoot ${n}`]);
assert.equal((await as(A, `select count(*)::int as n from chore_rotation`))[0].n, 17);

// ── Afvaldienst: kamers en ruilen ──
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const { ws, r0, r1, n0, n1 } = await q1(`select afval_week_start(afval_today()) ws, afval_room(afval_week_start(afval_today()), 0) r0,
  afval_room(afval_week_start(afval_today()), 1) r1, afval_room(afval_week_start(afval_today()) + 7, 0) n0, afval_room(afval_week_start(afval_today()) + 7, 1) n1`);
assert.deepEqual([await q1(`select afval_room('2026-11-10', 0) a, afval_room('2026-11-10', 1) b`)].map((x) => [x.a, x.b])[0], [5, 6], 'start = kamer 5+6');
assert.deepEqual(Object.values(await q1(`select afval_room('2026-12-22', 0) a, afval_room('2026-12-22', 1) b`)), [17, 1], 'na de ronde 17+1');
const [E, F] = [uid(5), uid(6)];
await as(A, `select set_room($1)`, [r0]);
await as(B, `select set_room($1)`, [r1]);
await as(E, `select set_room($1)`, [n0]);
await as(F, `select set_room($1)`, [n1]);
await fails(as(uid(7), `select set_room($1)`, [r0]), /al bezet/);
await fails(as(uid(7), `select set_room(18)`), /1 t\/m 17/);
await as(C, `select set_room($1)`, [r0]); // ander huis: zelfde kamernummer mag
await fails(as(null, `select set_room(3)`), /permission denied/);
await fails(as(A, `select afval_holder($1, $2, $3)`, [hidC, ws, r0]), /permission denied/);
const hidA = (await as(A, `select household_id from members where id = $1`, [A]))[0].household_id;
const holder = async (week, room) => (await q1(`select afval_holder($1, $2::date, $3) h`, [hidA, week, room])).h;
assert.equal(await holder(ws, r0), A);

// Verzoek aan iedereen: partner en ander huis kunnen niet, eerste buur wel
const [{ id: open }] = await as(A, `select afval_request_swap($1::date) as id`, [ws]);
await fails(as(A, `select afval_request_swap($1::date)`, [ws]), /al een open ruilverzoek/);
await fails(as(A, `select afval_request_swap($1::date + 14)`, [ws]), /geen afvaldienst/);
await fails(as(B, `select afval_respond_swap($1, 'accept')`, [open]), /zelf al afvaldienst/);
await fails(as(C, `select afval_respond_swap($1, 'accept')`, [open]), /niet gevonden/);
await fails(as(B, `insert into afval_overrides(week_start, room, member_id) values ($1, $2, $3)`, [ws, r0, B]), /row-level security/);
const [{ mine }] = await as(E, `select afval_respond_swap($1, 'accept') as mine`, [open]);
assert.equal(mine.toISOString?.().slice(0, 10) ?? mine, (await q1(`select ($1::date + 7)::text d`, [ws])).d, 'E ruilt zijn volgende week');
assert.equal(await holder(ws, r0), E, 'E doet nu de week van A, met B');
assert.equal(await holder((await q1(`select ($1::date + 7)::text d`, [ws])).d, n0), A, 'A doet de week van E, met F');
await fails(as(F, `select afval_respond_swap($1, 'accept')`, [open]), /al afgehandeld/);

// Verzoek aan één persoon: alleen die mag reageren
const [{ id: direct }] = await as(B, `select afval_request_swap($1::date, $2) as id`, [ws, uid(8)]);
await fails(as(uid(9), `select afval_respond_swap($1, 'accept')`, [direct]), /niet toegestaan/);
await fails(as(B, `select afval_request_swap($1::date, $2)`, [ws, E]), /al een open|niet ruilen/);
await as(uid(8), `select afval_respond_swap($1, 'decline')`, [direct]);
assert.equal((await as(B, `select status from afval_swaps where id = $1`, [direct]))[0].status, 'declined');
assert.equal((await as(C, `select * from afval_swaps`)).length, 0, 'ander huis ziet niets');

// ── Activiteit zonder tijd, porren ──
const [act2] = await as(B, `insert into activities(title, day) values ('Huisweekend', $1) returning day, starts_at`, [today]);
assert.equal(act2.starts_at, null, 'tijd mag leeg');
const [poke] = await as(A, `insert into out_pokes(to_member) values ($1) returning id, day`, [B]);
assert.ok(poke.id);
await fails(as(A, `insert into out_pokes(to_member) values ($1)`, [B]), /duplicate key|unique/);
await fails(as(A, `insert into out_pokes(to_member) values ($1)`, [C]), /row-level security/);
await fails(as(A, `insert into out_pokes(from_member, to_member) values ($1, $2)`, [B, E]), /row-level security/);
await fails(as(A, `insert into out_pokes(to_member) values ($1)`, [A]), /check constraint|row-level security/);
assert.equal((await as(B, `select * from out_pokes`)).length, 1);
assert.equal((await as(C, `select * from out_pokes`)).length, 0, 'ander huis ziet niets');

// ── Wensenlijst: uitgaan, koken, was, mededelingen, prikker, POV, boetes, anytimers ──
await as(E, `update members set out_status = 'no', out_time = '22:00' where id = $1`, [E]);
await fails(as(E, `update members set out_status = 'raar' where id = $1`, [E]), /check constraint/);
const [dinE] = await as(E, `insert into dinners(day) values ($1) on conflict (household_id, day) do update set day = excluded.day returning id`, [today]);
await as(E, `insert into dinner_rsvps(dinner_id, answer) values ($1, 'kok') on conflict (dinner_id, member_id) do update set answer = 'kok'`, [dinE.id]);

// Was
await as(E, `insert into laundry(machine, until) values ('was1', now() + interval '1 hour')`);
await fails(as(F, `insert into laundry(machine, until) values ('was1', now() + interval '1 hour')`), /duplicate key|row-level security/);
assert.equal((await as(F, `update laundry set member_id = $1, until = now() + interval '1 hour' where machine = 'was1' returning machine`, [F])).length, 0, 'bezette machine niet overnemen');
await fails(as(F, `insert into laundry(machine, until) values ('was2', now() + interval '5 hours')`), /row-level security/);
assert.equal((await as(C, `select * from laundry`)).length, 0);
await as(E, `delete from laundry where machine = 'was1'`);

// Mededelingen
const [ann] = await as(E, `insert into announcements(body) values ('Feest zaterdag') returning id`);
await fails(as(E, `insert into announcements(body, created_by) values ('x', $1)`, [F]), /row-level security/);
assert.equal((await as(C, `select * from announcements`)).length, 0);
assert.equal((await as(F, `delete from announcements where id = $1 returning id`, [ann.id])).length, 0, 'niet van een ander');
assert.equal((await as(A, `delete from announcements where id = $1 returning id`, [ann.id])).length, 1, 'beheerder wel');

// Datumprikker
const [poll] = await as(E, `insert into date_polls(title) values ('Huisweekend') returning id`);
const [opt] = await as(E, `insert into date_poll_options(poll_id, day) values ($1, $2) returning id`, [poll.id, today]);
await fails(as(F, `insert into date_poll_options(poll_id, day) values ($1, $2)`, [poll.id, today]), /row-level security/);
await as(F, `insert into date_poll_votes(option_id, answer) values ($1, 'ja')`, [opt.id]);
await fails(as(C, `insert into date_poll_votes(option_id, answer) values ($1, 'ja')`, [opt.id]), /row-level security/);

// POV: alleen tijdens de activiteit, eigen map, max. 25, pas na de onthulling zichtbaar voor anderen
const [povAct] = await as(E, `insert into activities(title, day, starts_at) values ('Feest', $1, now() - interval '1 hour') returning id`, [today]);
const hidE = (await as(E, `select household_id from members where id = $1`, [E]))[0].household_id;
const pov = (n, who = E) => as(who, `insert into pov_photos(activity_id, path) values ($1, $2)`, [povAct.id, `${hidE}/pov/${who}/${n}.jpg`]);
await pov(0);
await fails(as(E, `insert into pov_photos(activity_id, path) values ($1, $2)`, [povAct.id, `${hidE}/pov/${F}/x.jpg`]), /row-level security/);
assert.equal((await as(F, `select * from pov_photos`)).length, 0, 'nog niet onthuld');
assert.equal((await as(E, `select * from pov_photos`)).length, 1, 'eigen foto wel');
for (let n = 1; n < 25; n++) await pov(n);
await fails(pov(25), /row-level security/);
const [later] = await as(E, `insert into activities(title, day) values ('Later', $1::date + 3) returning id`, [today]);
await fails(as(E, `insert into pov_photos(activity_id, path) values ($1, $2)`, [later.id, `${hidE}/pov/${E}/later.jpg`]), /row-level security/);
await db.query(`update activities set day = $1::date - 2, starts_at = now() - interval '2 days' where id = $2`, [today, povAct.id]);
assert.equal((await as(F, `select * from pov_photos`)).length, 25, 'na onthulling ziet het huis het album');
assert.equal((await as(C, `select * from pov_photos`)).length, 0);

// Boetes: beheerder geeft, alleen de beboete en beheerders zien het
await fails(as(E, `insert into fines(member_id, amount, reason) values ($1, 5, 'x')`, [F]), /row-level security/);
const [fine] = await as(A, `insert into fines(member_id, amount, reason) values ($1, 5, 'Afvaldienst niet gedaan') returning id`, [E]);
assert.equal((await as(E, `select * from fines`)).length, 1);
assert.equal((await as(F, `select * from fines`)).length, 0, 'andermans boete niet zien');
assert.equal((await as(E, `update fines set paid_at = now() returning id`)).length, 0, 'zelf niet afvinken');
await as(A, `update fines set paid_at = now() where id = $1`, [fine.id]);
await fails(as(E, `select set_house_iban('NL00TEST0000000000', 'Huis')`), /alleen beheerders/);
await as(A, `select set_house_iban('nl00 test 0000 0000 00', 'Huis V70')`);
assert.equal((await as(E, `select iban from households`))[0].iban, 'NL00TEST0000000000');

// Anytimers: E heeft er een op F
const [any] = await as(E, `insert into anytimers(debtor) values ($1) returning id`, [F]);
await fails(as(E, `insert into anytimers(debtor, status) values ($1, 'open')`, [F]), /row-level security/);
assert.equal((await as(uid(7), `select * from anytimers`)).length, 0, 'anderen zien niets');
await fails(as(E, `select anytimer_act($1, 'claim')`, [any.id]), /niet toegestaan/);
await fails(as(E, `select anytimer_act($1, 'accept')`, [any.id]), /niet toegestaan/);
await as(F, `select anytimer_act($1, 'accept')`, [any.id]);
await as(E, `select anytimer_act($1, 'claim')`, [any.id]);
await fails(as(F, `select anytimer_act($1, 'proof', $2)`, [any.id, `${hidE}/anytimer/${E}/x.jpg`]), /niet toegestaan/);
await as(F, `select anytimer_act($1, 'proof', $2)`, [any.id, `${hidE}/anytimer/${F}/bewijs.jpg`]);
assert.equal((await as(E, `select status, photo_path from anytimers`))[0].status, 'done');

// Was-tijdvakken
await as(E, `insert into laundry_slots(machine, starts_at, ends_at) values ('was1', now() + interval '1 hour', now() + interval '2 hours')`);
await fails(as(F, `insert into laundry_slots(machine, starts_at, ends_at) values ('was1', now() + interval '90 minutes', now() + interval '3 hours')`), /row-level security/);
await as(F, `insert into laundry_slots(machine, starts_at, ends_at) values ('was1', now() + interval '2 hours', now() + interval '3 hours')`);
await as(F, `insert into laundry_slots(machine, starts_at, ends_at) values ('droger1', now() + interval '10 hours', now() + interval '19 hours')`);
await fails(as(F, `insert into laundry_slots(machine, starts_at, ends_at) values ('was2', now() + interval '1 hour', now() + interval '12 hours')`), /check constraint/);
await fails(as(F, `insert into laundry_slots(machine, starts_at, ends_at) values ('was2', now() - interval '3 hours', now() - interval '1 hour')`), /row-level security/);
assert.equal((await as(F, `delete from laundry_slots where member_id = $1 returning id`, [E])).length, 0, 'andermans dibs niet weghalen');
assert.equal((await as(C, `select * from laundry_slots`)).length, 0);
await fails(as(E, `select set_house_drive('https://drive.google.com/x')`), /alleen beheerders/);
await fails(as(A, `select set_house_drive('https://evil.example/x')`), /geen Google Drive/);
await as(A, `select set_house_drive('https://drive.google.com/drive/folders/abc')`);

// ── Realtime-publicatie compleet ──
const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`)).rows.map((r) => r.tablename).sort();
assert.deepEqual(pub, ['activities', 'activity_rsvps', 'afval_overrides', 'afval_swaps', 'announcements', 'anytimers', 'chore_done', 'chore_overrides', 'chore_rotation', 'chores', 'date_poll_options', 'date_poll_votes', 'date_polls', 'dinner_rsvps', 'dinners', 'fines', 'laundry', 'laundry_slots', 'members', 'out_pokes', 'pov_photos', 'swap_requests']);

console.log('✓ alle RLS/RPC-tests geslaagd');
