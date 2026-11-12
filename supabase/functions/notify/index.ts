// Edge Function 'notify': stuurt Web Push naar huisgenoten.
//  - Vanuit de app (gebruikers-JWT): { type: 'out' | 'por' | 'activity' | 'kok' | 'afvalruil' | 'mededeling' | 'prikker' | 'boete' | 'anytimer' | 'test', id?, day? }
//    De tekst wordt hier uit de database opgebouwd, dus de app kan geen willekeurige berichten sturen.
//  - Vanuit GitHub Actions (header x-service-key = secret key): { type: 'rota' } → beurt-herinneringen.
//  - Vanuit Supabase cron: { type: 'archive' } → oude fotoalbums (na de 5 nieuwste) naar Google Drive.
//  - Vanuit Supabase cron: { type: 'afval' } → herinnering afvaldienst (ma/wo/vr 17:00, max. één keer per dag).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { addIso, afvalRooms, afvalWeek, afvalWeekStart, holders, periodEnd, periodOf, periodStart } from './rota.js'; // kopie van app/rota.js (test bewaakt dat)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, *',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Nieuwe sleutels (SUPABASE_SECRET_KEYS) met terugval op de legacy service_role key.
const secretKeys = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')) as string[];
const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const adminKeys = new Set([...secretKeys, legacyKey].filter(Boolean));
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKeys[0] || legacyKey!, { auth: { persistSession: false } });

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:thuis@example.invalid', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type Msg = { title: string; body: string; tag: string; url: string };
type Member = { id: string; household_id: string; name: string; emoji: string; out_status: string; out_place: string | null; out_note: string | null };
type Chore = { id: string; household_id: string; name: string; emoji: string; start_date: string; period_days: number; team_size: number };

const TZ = 'Europe/Amsterdam';
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD in NL-tijd
const when = (ts: string) =>
  new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
function dayName(day: string) {
  const today = isoDay(new Date());
  if (day === today) return 'vandaag';
  if (day === addIso(today, 1)) return 'morgen';
  return new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00Z'));
}

// Stuurt naar alle toestellen die aan het filter voldoen; ruimt verlopen abonnementen op.
async function send(filter: { household?: string; except?: string; members?: string[] }, msg: Msg) {
  let q = admin.from('push_subscriptions').select('endpoint, p256dh, auth');
  if (filter.household) q = q.eq('household_id', filter.household);
  if (filter.except) q = q.neq('member_id', filter.except);
  if (filter.members) q = q.in('member_id', filter.members);
  const { data: subs, error } = await q;
  if (error) throw error;
  const payload = JSON.stringify(msg);
  const results = await Promise.allSettled((subs ?? []).map((s) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600 })));
  const gone = (subs ?? []).filter((_, i) => {
    const r = results[i];
    return r.status === 'rejected' && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0);
  });
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone.map((s) => s.endpoint));
  results.forEach((r) => r.status === 'rejected' && console.error('push mislukt', (r.reason as Error)?.message ?? r.reason));
  return results.filter((r) => r.status === 'fulfilled').length;
}

// Wie heeft in deze week afvaldienst (per huis), met ruilingen erin verwerkt.
async function afvalHolders(week: string, household?: string) {
  const rooms = afvalRooms(afvalWeek(week));
  let mq = admin.from('members').select('id, household_id, room').in('room', rooms);
  let oq = admin.from('afval_overrides').select('household_id, room, member_id').eq('week_start', week);
  if (household) { mq = mq.eq('household_id', household); oq = oq.eq('household_id', household); }
  const [{ data: ms, error }, { data: ovs }] = await Promise.all([mq, oq]);
  if (error) throw error;
  const houses = new Set([...(ms ?? []), ...(ovs ?? [])].map((x) => x.household_id));
  return [...houses].flatMap((h) => rooms.map((r) =>
    (ovs ?? []).find((o) => o.household_id === h && o.room === r)?.member_id ?? (ms ?? []).find((m) => m.household_id === h && m.room === r)?.id)
    .filter(Boolean)) as string[];
}
const weekLabel = (week: string) => `${dayName(week)} – ${dayName(addIso(week, 6))}`;

async function afvalReminder() {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', hour12: false })
    .formatToParts(now).map((x) => [x.type, x.value]));
  if (!['Mon', 'Wed', 'Fri'].includes(p.weekday) || p.hour !== '17') return { skipped: 'niet ma/wo/vr 17:00' };
  const day = isoDay(now);
  const { error: dup } = await admin.from('afval_reminders').insert({ day });
  if (dup) return { skipped: 'vandaag al verstuurd' };
  const week = afvalWeekStart(afvalWeek(day));
  const ids = await afvalHolders(week);
  const sent = ids.length ? await send({ members: ids }, { title: 'Denk aan je afvaldienst', body: `Afvalzakken, karton, glas en vaatdoeken · t/m ${dayName(addIso(week, 6))}`, tag: `afval-${day}`, url: './#afval' }) : 0;
  return { day, week, sent };
}

// Fotoalbums: per huis blijven de 5 nieuwste ontwikkelde albums in de app; oudere gaan via het Apps Script naar Drive.
// Per aanroep max. 40 foto's (tijdslimiet); de cron roept 's nachts elk uur aan tot alles over is.
const KEEP_ALBUMS = 5, BATCH = 40;
async function archive() {
  const url = Deno.env.get('DRIVE_SCRIPT_URL'), token = Deno.env.get('DRIVE_SCRIPT_TOKEN');
  if (!url || !token) return { skipped: 'Drive-script niet ingesteld' };
  const { data: photos, error } = await admin.from('pov_photos').select('id, household_id, activity_id, member_id, path, created_at').order('created_at');
  if (error) throw error;
  const ids = [...new Set((photos ?? []).map((p) => p.activity_id))];
  if (!ids.length) return { archived: 0 };
  const { data: acts } = await admin.from('activities').select('id, household_id, title, day, starts_at').in('id', ids);
  const dayOf = (a: { day: string | null; starts_at: string | null }) => a.day || isoDay(new Date(a.starts_at!));
  const revealed = (acts ?? []).filter((a) => addIso(dayOf(a), 1) < isoDay(new Date())); // ontwikkeld (dag erna 10:00) en dat is al gisteren of eerder
  const old = [...new Set(revealed.map((a) => a.household_id))].flatMap((h) =>
    revealed.filter((a) => a.household_id === h).sort((x, y) => dayOf(y).localeCompare(dayOf(x))).slice(KEEP_ALBUMS));
  const act = old.sort((x, y) => dayOf(x).localeCompare(dayOf(y)))[0];
  if (!act) return { archived: 0 };
  const batch = (photos ?? []).filter((p) => p.activity_id === act.id).slice(0, BATCH);
  const { data: signed } = await admin.storage.from('v70').createSignedUrls(batch.map((p) => p.path), 3600);
  const files = batch.map((p, i) => ({ name: `${dayOf(act)} ${String(i + 1).padStart(2, '0')} ${p.id.slice(0, 8)}.jpg`, url: signed?.[i]?.signedUrl })).filter((f) => f.url);
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ token, folder: `${dayOf(act)} ${act.title}`, files }) });
  const out = await res.json().catch(() => ({ ok: false }));
  if (!out.ok || out.saved !== files.length) return { error: 'Drive-script faalde', out };
  await admin.storage.from('v70').remove(batch.map((p) => p.path));
  await admin.from('pov_photos').delete().in('id', batch.map((p) => p.id));
  await admin.from('activities').update({ drive_url: out.folderUrl }).eq('id', act.id);
  return { archived: batch.length, activity: act.title };
}

async function fromApp(body: { type?: string; id?: string; day?: string }, me: Member) {
  const toOthers = (msg: Msg) => send({ household: me.household_id, except: me.id }, msg);
  const nameOf = async (id: string) => (await admin.from('members').select('name').eq('id', id).maybeSingle()).data?.name ?? '?';
  switch (body.type) {
    case 'test':
      return send({ members: [me.id] }, { title: 'Meldingen werken', body: `Hoi ${me.name}, dit toestel krijgt meldingen van V70.`, tag: 'test', url: './#ik' });
    case 'out': {
      if (me.out_status === 'none') return 0;
      const what = me.out_status === 'going' ? 'gaat uit' : 'wil uit';
      const text = [me.out_place, me.out_note].filter(Boolean).join(' · ') || 'Wie gaat er mee?';
      return toOthers({ title: `${me.name} ${what}`, body: text, tag: `out-${me.id}`, url: './#uit' });
    }
    case 'por': {
      const { data: p } = await admin.from('out_pokes').select('*').eq('id', body.id ?? '').eq('from_member', me.id).maybeSingle();
      if (!p) return 0;
      return send({ members: [p.to_member] }, { title: `${me.name} port je`, body: `Ga je vanavond mee uit${me.out_place ? ` naar ${me.out_place}` : ''}?`, tag: `por-${p.id}`, url: './#uit' });
    }
    case 'activity': {
      const { data: a } = await admin.from('activities').select('*').eq('id', body.id ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!a) return 0;
      const op = a.starts_at ? ' · ' + when(a.starts_at) : a.day ? ' · ' + dayName(a.day) : '';
      return toOthers({ title: a.title, body: `${me.name} plant iets${op}. Doe je mee?`, tag: `act-${a.id}`, url: './#uit' });
    }
    case 'kok': {
      const { data: d } = await admin.from('dinners').select('*').eq('day', body.day ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!d) return 0;
      return toOthers({ title: `${me.name} gaat koken ${dayName(d.day)}`, body: `${d.menu ? d.menu + '. ' : ''}Eet je mee?`, tag: `kok-${d.day}`, url: './#eten' });
    }
    case 'mededeling': {
      const { data: a } = await admin.from('announcements').select('*').eq('id', body.id ?? '').eq('created_by', me.id).maybeSingle();
      if (!a) return 0;
      return toOthers({ title: `Mededeling van ${me.name}`, body: a.body.slice(0, 140), tag: `mededeling-${a.id}`, url: './#mededelingen' });
    }
    case 'prikker': {
      const { data: p } = await admin.from('date_polls').select('*').eq('id', body.id ?? '').eq('created_by', me.id).maybeSingle();
      if (!p) return 0;
      return toOthers({ title: `Datumprikker: ${p.title}`, body: `${me.name} zoekt een datum. Wanneer kun jij?`, tag: `prikker-${p.id}`, url: './#uit' });
    }
    case 'boete': {
      if (!me.is_admin) return 0;
      const { data: f } = await admin.from('fines').select('*').eq('id', body.id ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!f) return 0;
      return send({ members: [f.member_id] }, { title: `Boete: € ${Number(f.amount).toFixed(2).replace('.', ',')}`, body: f.reason, tag: `boete-${f.id}`, url: './#boetes' });
    }
    case 'anytimer': {
      const { data: a } = await admin.from('anytimers').select('*').eq('id', body.id ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!a) return 0;
      const tag = `anytimer-${a.id}`;
      if (a.status === 'pending' && a.holder === me.id) return send({ members: [a.debtor] }, { title: `${me.name} zegt een anytimer op je te hebben`, body: a.reason || 'Klopt dat? Tik om te bevestigen.', tag, url: './#anytimers' });
      if (a.status === 'claimed' && a.holder === me.id) return send({ members: [a.debtor] }, { title: `${me.name} zet een anytimer in!`, body: 'Drinken en een foto als bewijs sturen.', tag, url: './#anytimers' });
      if (a.status === 'done' && a.debtor === me.id) return send({ members: [a.holder] }, { title: `${me.name} heeft de anytimer gedaan`, body: 'Bekijk het bewijs.', tag, url: './#anytimers' });
      return 0;
    }
    case 'swap': {
      const { data: s } = await admin.from('swap_requests').select('*, chores(name, emoji)').eq('id', body.id ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!s) return 0;
      const chore = `${s.chores?.emoji ?? ''} ${s.chores?.name ?? 'een taak'}`.trim();
      const tag = `swap-${s.id}`;
      if (s.status === 'open' && s.from_member === me.id) {
        return send({ members: [s.to_member] }, { title: `↔ ${me.name} vraagt of je wilt ruilen`, body: `Neem jij ${chore} over (${dayName(s.period_start)})?`, tag, url: './#home' });
      }
      if (['accepted', 'declined'].includes(s.status) && s.to_member === me.id) {
        const ok = s.status === 'accepted';
        return send({ members: [s.from_member] }, { title: ok ? `✅ ${me.name} neemt je beurt over` : `❌ ${me.name} kan niet ruilen`, body: `${chore} (${dayName(s.period_start)})`, tag, url: './#home' });
      }
      return 0;
    }
    case 'afvalruil': {
      const { data: s } = await admin.from('afval_swaps').select('*').eq('id', body.id ?? '').eq('household_id', me.household_id).maybeSingle();
      if (!s) return 0;
      const tag = `afvalruil-${s.id}`;
      if (s.status === 'open' && s.from_member === me.id) {
        const busy = await afvalHolders(s.week_start, me.household_id); // wie die week al dienst heeft, kan niet ruilen
        const to = s.to_member ? [s.to_member]
          : ((await admin.from('members').select('id').eq('household_id', me.household_id)).data ?? []).map((m) => m.id).filter((id) => !busy.includes(id));
        return to.length ? send({ members: to }, { title: `${me.name} wil afvaldienst ruilen`, body: `Week ${weekLabel(s.week_start)}. Tik om te reageren.`, tag, url: './#afval' }) : 0;
      }
      if (s.status === 'accepted' && s.accepted_by === me.id) {
        return send({ members: [s.from_member] }, { title: `${me.name} ruilt met je`, body: `${me.name} doet jouw afvaldienst (${weekLabel(s.week_start)}). Jij doet ${weekLabel(s.other_week)}.`, tag, url: './#afval' });
      }
      if (s.status === 'declined' && s.to_member === me.id) {
        return send({ members: [s.from_member] }, { title: `${me.name} kan niet ruilen`, body: `Afvaldienst ${weekLabel(s.week_start)}`, tag, url: './#afval' });
      }
      return 0;
    }
    default:
      throw new Error('onbekend type');
  }
}

// Elke avond: "morgen begint jouw beurt" en "vandaag laatste dag, nog niet afgevinkt".
async function rotaReminders() {
  const today = isoDay(new Date());
  const tomorrow = addIso(today, 1);
  const [{ data: chores, error }, { data: rot }, { data: ovs }, { data: done }] = await Promise.all([
    admin.from('chores').select('*'),
    admin.from('chore_rotation').select('chore_id, member_id, position').order('position'),
    admin.from('chore_overrides').select('*').gte('period_start', addIso(today, -31)),
    admin.from('chore_done').select('chore_id, period_start, slot').gte('period_start', addIso(today, -31)),
  ]);
  if (error) throw error;
  let sent = 0;
  for (const c of (chores ?? []) as Chore[]) {
    const rotation = (rot ?? []).filter((r) => r.chore_id === c.id).map((r) => r.member_id);
    const label = `${c.emoji} ${c.name}`;
    const pTomorrow = periodOf(c, tomorrow);
    if (pTomorrow >= 0 && periodStart(c, pTomorrow) === tomorrow) {
      const ids = holders(c, pTomorrow, rotation, ovs ?? []).map((h) => h.id).filter(Boolean) as string[];
      const until = c.period_days > 1 ? ` (t/m ${dayName(periodEnd(c, pTomorrow))})` : '';
      if (ids.length) sent += await send({ members: ids }, { title: `Morgen ben jij aan de beurt`, body: `${label}${until}`, tag: `rota-${c.id}-${tomorrow}`, url: './#home' });
    }
    const pToday = periodOf(c, today);
    if (pToday >= 0 && c.period_days > 1 && periodEnd(c, pToday) === today) {
      const open = holders(c, pToday, rotation, ovs ?? [])
        .filter((h) => h.id && !(done ?? []).some((d) => d.chore_id === c.id && d.period_start === h.ps && d.slot === h.slot))
        .map((h) => h.id) as string[];
      if (open.length) sent += await send({ members: open }, { title: `⏰ Vandaag laatste dag`, body: `${label} staat nog niet op klaar.`, tag: `rota-last-${c.id}-${today}`, url: './#home' });
    }
  }
  return { today, chores: chores?.length ?? 0, sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'alleen POST' }, 405);
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'VAPID-sleutels ontbreken' }, 500);
    const body = await req.json().catch(() => ({}));

    if (body.type === 'archive') return json(await archive()); // veilig openbaar: archiveert alleen wat toch al weg moet
    if (body.type === 'afval') return json(await afvalReminder()); // beveiligd door tijdstip + één keer per dag

    if (body.type === 'rota') {
      if (!adminKeys.has(req.headers.get('x-service-key') ?? '')) return json({ error: 'verboden' }, 403);
      return json(await rotaReminders());
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: 'niet ingelogd' }, 401);
    const { data: me } = await admin.from('members').select('*').eq('id', user.id).maybeSingle();
    if (!me) return json({ error: 'geen lid van een huis' }, 403);
    return json({ sent: await fromApp(body, me) });
  } catch (e) {
    console.error(e);
    const msg = (e as Error)?.message ?? String(e);
    return json({ error: msg }, msg === 'onbekend type' ? 400 : 500);
  }
});
