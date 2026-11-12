import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { addIso, afvalWeek, afvalWeekStart, afvalRooms } from './rota.js';

const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privémodus */ } },
};

// Het overzicht is altijd het startscherm; elk onderdeel heeft een vak op het overzicht.
const TABS = ['home', 'afval', 'thuis', 'uit', 'eten', 'ik', 'was', 'mededelingen', 'albums', 'boetes', 'anytimers', 'act'];
const TAB_LABEL = { home: 'Overzicht', afval: 'Afvaldienst', thuis: 'Wie is thuis', uit: 'Activiteiten & uitgaan', eten: 'Eten', ik: 'Profiel',
  was: 'Was dibsen', mededelingen: 'Mededelingen', albums: "Fotoalbums", boetes: 'Boetes', anytimers: 'Anytimers', act: 'Activiteit' };
const tabFromHash = () => {
  const t = location.hash.slice(1);
  if (t.startsWith('act=')) { state.actId = t.slice(4); return 'act'; }
  return t === 'activiteiten' ? 'uit' : TABS.includes(t) && t !== 'act' ? t : null;
}; // oude meldingen linken nog naar #activiteiten
const state = {
  tab: 'home', actId: null, outOpen: false,
  push: 'unknown', // unconfigured | unsupported | needs-install | denied | off | on
  me: null, household: null, secret: null, session: null,
  members: [], afvalOverrides: [], afvalSwaps: [], pokes: [], laundry: [], news: [], polls: [], pollOptions: [], pollVotes: [],
  povPhotos: [], pastActs: [], fines: [], anytimers: [],
  activities: [], actRsvps: [], dinners: [], dinRsvps: [],
};

state.tab = tabFromHash() || 'home';

// ───────── Helpers ─────────
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
function dayLabel(s) {
  if (s === today()) return 'vandaag';
  if (s === addIso(today(), 1)) return 'morgen';
  const d = new Date(s + 'T12:00:00');
  return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
const hhmm = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
// Korte tijd voor het bord en de vakken: "20:00" vandaag, "morgen", anders "do 20:00".
function whenShort(ts) {
  const d = new Date(ts);
  if (iso(d) === today()) return hhmm(d);
  if (iso(d) === addIso(today(), 1)) return 'morgen';
  return `${DAYS[d.getDay()]} ${hhmm(d)}`;
}
const ago = (ts) => {
  const m = Math.round((Date.now() - new Date(ts)) / 60000);
  return m < 1 ? 'zojuist' : m < 60 ? `${m} min geleden` : m < 1440 ? `${Math.round(m / 60)} uur geleden` : `${Math.round(m / 1440)} d geleden`;
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 2600);
}
const ZONES = { home: 'thuis', nearby: 'in de buurt', away: 'weg', unknown: 'onbekend' };
const fresh = (m) => !m.out_until || new Date(m.out_until) > new Date();
const outActive = (m) => ['wants', 'going'].includes(m.out_status) && fresh(m);
const outNo = (m) => m.out_status === 'no' && fresh(m);
const memberName = (id) => state.members.find((m) => m.id === id)?.name || '?';
const names = (ids, max = 6) => {
  const n = ids.map(memberName).filter((x) => x !== '?');
  if (!n.length) return '–';
  return n.length > max ? `${n.slice(0, max).join(', ')} +${n.length - max}` : n.join(', ');
};

// Avatars: initialen op een vaste toon per persoon (profielfoto's volgen later).
const initials = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
};
const TONES = ['#8E1B35', '#6E1229', '#A3203F', '#5E1022', '#1F6F62', '#7A4A1E', '#7A1530'];
const tone = (id) => TONES[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % TONES.length];
const avatar = (m, cls = '') => `<span class="av ${cls}" style="--tone:${tone(m.id)}" aria-hidden="true">${esc(initials(m.name))}</span>`;
const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
};

// ───────── Afvaldienst (berekend met rota.js; ruilingen staan in afval_overrides) ─────────
const curWeek = () => afvalWeek(today());
const shortDay = (s) => { const d = new Date(s + 'T12:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
const weekLabel = (w) => `${shortDay(afvalWeekStart(w))} – ${shortDay(addIso(afvalWeekStart(w), 6))}`;
// Het duo van week w: per plek (kamer) wie het doet.
const duty = (w) => afvalRooms(w).map((room) => {
  const ws = afvalWeekStart(w), o = state.afvalOverrides.find((x) => x.week_start === ws && x.room === room);
  return { room, id: o ? o.member_id : state.members.find((m) => m.room === room)?.id || null, swapped: !!o };
});
const onDuty = (w, id = state.me.id) => duty(w).some((d) => d.id === id);
// Eerstvolgende week (vanaf deze) waarin iemand dienst heeft, eventueel zonder week `not`.
const nextDuty = (id = state.me.id, not = null) => { for (let w = curWeek(); w < curWeek() + 40; w++) if (w !== not && onDuty(w, id)) return w; return null; };
const duoNames = (w) => duty(w).map((d) => (d.id === state.me.id ? 'jij' : d.id ? memberName(d.id) : 'niemand')).join(' & ');
// Ruilverzoeken die jij kunt accepteren: aan jou, of aan iedereen terwijl jij die week vrij bent.
const swapsForMe = () => state.afvalSwaps.filter((s) => s.from_member !== state.me.id && !(store.get('afvalnee') || '').includes(s.id)
  && (s.to_member === state.me.id || (!s.to_member && !onDuty(afvalWeek(s.week_start)))));

// ───────── Data ─────────
async function ensureSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw r.error;
  return r.data.session;
}

async function loadAll() {
  const t = today();
  const res = await Promise.all([
    sb.from('members').select('*').order('created_at'),
    sb.from('afval_overrides').select('*').gte('week_start', afvalWeekStart(curWeek())),
    sb.from('afval_swaps').select('*').eq('status', 'open').gte('week_start', afvalWeekStart(curWeek())),
    sb.from('activities').select('*').or(`day.is.null,day.gte.${t}`).order('day', { nullsFirst: false }).order('starts_at', { nullsFirst: true }).limit(60),
    sb.from('activity_rsvps').select('*'),
    sb.from('dinners').select('*').gte('day', t).order('day').limit(14),
    sb.from('dinner_rsvps').select('*'),
    sb.from('out_pokes').select('*').eq('day', t),
    sb.from('laundry_slots').select('*').gt('ends_at', new Date().toISOString()).order('starts_at'),
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(40),
    sb.from('date_polls').select('*').eq('closed', false).order('created_at', { ascending: false }),
    sb.from('date_poll_options').select('*').order('day'),
    sb.from('date_poll_votes').select('*'),
    sb.from('pov_photos').select('*').order('created_at').limit(3000),
    sb.from('activities').select('*').lt('day', t).order('day', { ascending: false }).limit(40),
    sb.from('fines').select('*').order('created_at', { ascending: false }),
    sb.from('anytimers').select('*').order('created_at', { ascending: false }),
  ]);
  const err = res.find((r) => r.error)?.error;
  if (err) throw err;
  const [m, ov, sw, a, ar, dn, dr, pk, la, nw, po, opt, pv, ph, past, fi, an] = res.map((x) => x.data);
  Object.assign(state, { members: m, afvalOverrides: ov, afvalSwaps: sw, activities: a, actRsvps: ar, dinners: dn, dinRsvps: dr, pokes: pk,
    laundry: la, news: nw, polls: po, pollOptions: opt, pollVotes: pv, povPhotos: ph, pastActs: past, fines: fi, anytimers: an });
  state.me = state.members.find((x) => x.id === state.session.user.id) || null;
  if (state.me) {
    const [h, sec] = await Promise.all([sb.from('households').select('*').maybeSingle(), sb.from('member_secrets').select('token').maybeSingle()]);
    state.household = h.data;
    state.secret = sec.data?.token || null;
  }
}

let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { try { await loadAll(); render(true); } catch { /* volgende update probeert opnieuw */ } }, 250);
}

function subscribe() {
  const ch = sb.channel('huis');
  ['members', 'afval_overrides', 'afval_swaps', 'activities', 'activity_rsvps', 'dinners', 'dinner_rsvps', 'out_pokes', 'laundry_slots',
    'announcements', 'date_polls', 'date_poll_options', 'date_poll_votes', 'pov_photos', 'fines', 'anytimers']
    .forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, refreshSoon));
  ch.subscribe((status) => $('#conn').classList.toggle('live', status === 'SUBSCRIBED'));
}

// Voert een schrijfactie uit; geeft de data (of true) terug bij succes, anders false.
async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast('Mislukt: ' + error.message); return false; }
  if (okMsg) toast(okMsg);
  try { await loadAll(); } catch { /* realtime haalt het later op */ }
  render();
  return data ?? true;
}

// Push naar huisgenoten. De Edge Function bouwt de tekst zelf op uit de database.
const notify = (type, extra = {}) => sb.functions.invoke('notify', { body: { type, ...extra } }).catch(() => {});

// ───────── Pushmeldingen ─────────
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function detectPush() {
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIos && !standalone ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && (await currentSub()) ? 'on' : 'off';
}
async function saveSub(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) toast('Opslaan mislukt: ' + error.message);
  return !error;
}
async function enablePush() {
  try {
    // iOS: requestPermission moet direct in de klik gebeuren, dus dit is de eerste await.
    if ((await Notification.requestPermission()) !== 'granted') { state.push = await detectPush(); render(); return toast('Meldingen niet toegestaan'); }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC_KEY) }));
    if (!(await saveSub(sub))) return;
    state.push = 'on'; render(); toast('Meldingen staan aan');
  } catch (e) { toast('Aanzetten mislukt: ' + (e.message || e)); }
}
async function disablePush() {
  const sub = await currentSub();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  state.push = 'off'; render(); toast('Meldingen staan uit');
}
async function testPush() {
  const { data, error } = await sb.functions.invoke('notify', { body: { type: 'test' } });
  if (error) return toast('Mislukt: ' + error.message);
  toast(data?.sent ? 'Testmelding verstuurd' : 'Geen toestel gevonden; zet meldingen opnieuw aan');
}

// ───────── Zone (alleen grove zone, coördinaten verlaten je telefoon nooit) ─────────
const dist = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const getPos = (precise = false) => new Promise((res, rej) => (navigator.geolocation
  ? navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), rej,
    { enableHighAccuracy: precise, timeout: 15000, maximumAge: precise ? 0 : 60000 })
  : rej(new Error('geen locatie'))));
const homePos = () => { try { return JSON.parse(store.get('homePos') || 'null'); } catch { return null; } };

async function setZone(zone, quiet = false) {
  await run(sb.from('members').update({ zone, zone_updated_at: new Date().toISOString() }).eq('id', state.me.id), quiet ? null : `Je staat op ${ZONES[zone]}`);
}
async function locate(quiet = false) {
  const home = homePos();
  if (!home) { if (!quiet) toast('Tik eerst op "Dit is huis" als je thuis bent'); return; }
  try {
    const d = dist(await getPos(), home);
    const zone = d < 150 ? 'home' : d < 2500 ? 'nearby' : 'away';
    const fresh = Date.now() - new Date(state.me.zone_updated_at) < 30 * 60e3;
    if (quiet && zone === state.me.zone && fresh) return; // niets veranderd: huisgenoten niet onnodig verversen
    await setZone(zone, quiet);
  } catch { if (!quiet) toast('Locatie niet beschikbaar'); }
}
// Bij openen checken, maar alleen voor wie "Dit is huis" heeft gezet en locatie niet heeft geweigerd.
// (iOS vergeet de toestemming soms; dan vraagt het opnieuw, wat past bij de eigen opt-in.)
async function autoLocate() {
  if (!state.me || !homePos()) return;
  const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
  if (perm?.state !== 'denied') await locate(true);
}
async function saveHome() {
  try {
    store.set('homePos', JSON.stringify(await getPos(true)));
    await setZone('home', true);
    toast('Thuispunt opgeslagen. Je staat op thuis.');
  } catch (e) { toast(e?.code === 1 ? 'Locatie geweigerd. Sta locatie toe voor V70 in je instellingen.' : 'Locatie niet beschikbaar'); }
}
async function forgetHome() {
  store.set('homePos', '');
  await setZone('unknown', true);
  toast('Thuispunt gewist op dit toestel');
}

// ───────── Overzicht ─────────
const dinnerToday = () => state.dinners.find((x) => x.day === today());
const eaters = (d) => (d ? state.dinRsvps.filter((x) => x.dinner_id === d.id && ['mee', 'kok'].includes(x.answer)).reduce((s, x) => s + 1 + x.guests, 0) : 0);
const cooksOf = (d) => (d ? state.dinRsvps.filter((x) => x.dinner_id === d.id && x.answer === 'kok').map((x) => x.member_id) : []);
const actDay = (a) => a.day || (a.starts_at ? iso(new Date(a.starts_at)) : null);
// Kort: "20:00" vandaag, "morgen", "do 20:00"; zonder tijd alleen de dag.
const actWhen = (a) => (a.starts_at ? whenShort(a.starts_at) : actDay(a) === today() ? 'vandaag' : dayLabel(actDay(a)));
// Eerstvolgende activiteit met datum (een activiteit met tijd telt tot 2 uur na de start).
const nextActivity = () => state.activities.find((a) => actDay(a) && (a.starts_at ? new Date(a.starts_at) > Date.now() - 2 * 3600e3 : actDay(a) >= today()));
// Porren die jij vandaag kreeg en nog niet wegtikte.
const pokesForMe = () => state.pokes.filter((p) => p.to_member === state.me.id && !(store.get('pornee') || '').includes(p.id));
const actMee = (a) => state.actRsvps.filter((r) => r.activity_id === a.id && r.answer === 'mee').length;

// Het bord: wat er nu en vandaag speelt. lvl 0 = nu (amber), 1 = straks, 2 = later.
function boardRows() {
  const me = state.me, t = today(), rows = [];
  swapsForMe().forEach((s) =>
    rows.push({ k: 'swap' + s.id, lvl: 0, t: 'nu', w: 'Ruilverzoek afval', who: `van ${memberName(s.from_member)}`, tab: 'afval' }));
  if (onDuty(curWeek())) {
    const reminderDay = [1, 3, 5].includes(new Date().getDay()); // ma/wo/vr: dan komt ook de herinnering
    rows.push({ k: 'afval', lvl: reminderDay ? 0 : 1, t: 't/m ma', w: 'Afvaldienst', who: 'jij', tab: 'afval' });
  }
  const out = state.members.filter(outActive);
  if (out.length) {
    const going = out.some((m) => m.out_status === 'going');
    const place = out.find((m) => m.out_place)?.out_place;
    rows.push({ k: 'out', lvl: going ? 0 : 1, t: going ? 'nu' : 'vanavond', w: place ? `Uit · ${place}` : 'Uit', who: `${out.length} ${going ? 'gaan' : 'willen'}`, tab: 'uit' });
  }
  const d = dinnerToday(), n = eaters(d);
  if (cooksOf(d).length) rows.push({ k: 'eten', lvl: 1, t: 'vanavond', w: d?.menu ? `Eten · ${d.menu}` : `${names(cooksOf(d), 2)} kookt`, who: `${n} mee`, tab: 'eten' });
  if (!outActive(me)) pokesForMe().forEach((p) =>
    rows.push({ k: 'por' + p.id, lvl: 0, t: 'nu', w: 'Mee uit?', who: `${memberName(p.from_member)} port je`, tab: 'uit' }));
  const a = nextActivity();
  if (a && actDay(a) <= addIso(t, 6)) {
    rows.push({ k: 'act' + a.id, lvl: actDay(a) === t ? 1 : 2, t: actWhen(a), w: a.title, who: `${actMee(a)} mee`, tab: 'uit' });
  }
  state.laundry.filter((l) => l.member_id === me.id && new Date(l.starts_at) - Date.now() < 3 * 3600e3).slice(0, 1).forEach((l) =>
    rows.push({ k: 'was' + l.id, lvl: new Date(l.starts_at) <= new Date() ? 0 : 1, t: hhmm(new Date(l.starts_at)), w: machName(l.machine), who: 'jij', tab: 'was' }));
  state.anytimers.filter((x) => x.debtor === me.id && x.status === 'claimed').forEach((x) =>
    rows.push({ k: 'any' + x.id, lvl: 0, t: 'nu', w: 'Anytimer!', who: `van ${memberName(x.holder)}`, tab: 'anytimers' }));
  state.anytimers.filter((x) => x.debtor === me.id && x.status === 'pending').forEach((x) =>
    rows.push({ k: 'anyp' + x.id, lvl: 1, t: 'nu', w: 'Anytimer bevestigen', who: memberName(x.holder), tab: 'anytimers' }));
  state.news.filter((n) => n.created_by !== me.id && Date.now() - new Date(n.created_at) < 864e5).slice(0, 1).forEach((n) =>
    rows.push({ k: 'news' + n.id, lvl: 1, t: 'nieuw', w: n.body, who: memberName(n.created_by), tab: 'mededelingen' }));
  state.polls.filter((p) => !state.pollOptions.some((o) => o.poll_id === p.id && state.pollVotes.some((v) => v.option_id === o.id && v.member_id === me.id))).slice(0, 1)
    .forEach((p) => rows.push({ k: 'poll' + p.id, lvl: 1, t: 'prikken', w: p.title, who: memberName(p.created_by), tab: 'uit' }));
  return rows.sort((x, y) => x.lvl - y.lvl).slice(0, 4);
}

// Regels klappen alleen om (splitflap) als hun inhoud sinds de vorige keer veranderd is.
let lastBoard = {};
const sig = (r) => `${r.t}|${r.w}|${r.who}`;
function board() {
  const rows = boardRows();
  const html = rows.map((r, i) => `<button class="brow lvl${r.lvl}${lastBoard[r.k] === sig(r) ? '' : ' flip'}" style="--i:${i}" data-act="tab" data-tab="${r.tab}">
    <span>${esc(r.t)}</span><span>${esc(r.w)}</span><span>${esc(r.who)}</span></button>`).join('');
  lastBoard = Object.fromEntries(rows.map((r) => [r.k, sig(r)]));
  return `<section class="board"><h2>Vandaag in V70</h2>${html || '<p class="quiet">Rustig in huis. Nog niets gepland vandaag.</p>'}</section>`;
}

const HERE = { home: 'Jij bent thuis', nearby: 'Jij bent in de buurt', away: 'Jij bent weg', unknown: 'Waar ben je?' };
function hereStrip() {
  if (!homePos()) {
    return `<button class="here setup" data-act="sethome"><span class="pin">${ICON.pin}</span>
      <span class="grow"><b>Dit is huis</b><small>Ben je nu thuis? Tik hier. Daarna checkt V70 bij het openen of je thuis bent.</small></span></button>`;
  }
  const z = state.me.zone;
  return `<button class="here ${z}" data-act="locate"><span class="pin">${ICON.pin}</span>
    <span class="grow"><b>${HERE[z]}</b><small>bijgewerkt ${ago(state.me.zone_updated_at)} · tik om te checken</small></span>${ICON.refresh}</button>`;
}

function tiles() {
  const me = state.me, w = curWeek(), mineNow = onDuty(w), next = nextDuty(me.id, mineNow ? w : null);
  const afvalMeta = mineNow ? '<span class="m act">jij hebt deze week dienst</span>'
    : !me.room ? '<span class="m act">kies je kamer om ingeroosterd te worden</span>'
      : `<span class="m">jij: ${next === null ? 'nog niet ingeroosterd' : weekLabel(next)}</span>`;

  const home = state.members.filter((m) => m.zone === 'home');
  const stack = home.slice(0, 5).map((m) => avatar(m)).join('') + (home.length > 5 ? `<span class="av more">+${home.length - 5}</span>` : '');

  const d = dinnerToday(), myDinner = d && state.dinRsvps.find((x) => x.dinner_id === d.id && x.member_id === me.id);
  const cooks = cooksOf(d);
  const out = state.members.filter(outActive);
  const a = nextActivity();

  return `<button class="tile wide" data-act="tab" data-tab="afval"><span class="tt">Afvaldienst · ${weekLabel(w)}</span>
      <span class="v">${esc(duoNames(w))}</span>${afvalMeta}</button>
    <button class="tile" data-act="tab" data-tab="thuis"><span class="tt">Wie is thuis</span>
      <span class="v teal">${home.length}<small>/ ${state.members.length}</small></span><span class="stack">${stack}</span></button>
    <button class="tile" data-act="tab" data-tab="eten"><span class="tt">Eten vanavond</span>
      <span class="v">${eaters(d)}<small>mee</small></span><span class="m">${esc(cooks.length ? `kok: ${names(cooks, 2)}` : 'nog niemand kookt')}</span>
      ${cooks.length && !myDinner ? '<span class="m act">jij: nog niet gereageerd</span>' : ''}</button>
    <button class="tile" data-act="tab" data-tab="uit"><span class="tt">Uitgaan vanavond</span>
      <span class="v${out.length ? ' amber' : ''}">${out.length}<small>${out.length === 1 ? 'persoon' : 'personen'}</small></span>
      <span class="m">${esc(out.length ? names(out.map((m) => m.id), 3) : 'niemand gaat uit')}</span>
      ${!outActive(me) && pokesForMe().length ? `<span class="m act">${esc(memberName(pokesForMe()[0].from_member))} port je</span>` : ''}</button>
    <button class="tile" data-act="tab" data-tab="uit"><span class="tt">Activiteiten</span>
      <span class="v">${a ? esc(actWhen(a)) : 'Niks'}</span>
      <span class="m">${a ? `${esc(a.title)} · ${actMee(a)} mee` : 'plan iets leuks'}</span></button>`;
}

function miniTiles() {
  const me = state.me, free = MACHINES.filter((mc) => !machineBusy(mc.id)).length;
  const myFines = state.fines.filter((f) => f.member_id === me.id && !f.paid_at);
  const onMe = state.anytimers.filter((x) => x.debtor === me.id && x.status !== 'done' && x.status !== 'pending').length;
  const mine = state.anytimers.filter((x) => x.holder === me.id && x.status === 'open').length;
  const albums = albumActs().length;
  const mini = (tab, tt, v, m = '', cls = '') => `<button class="tile mini" data-act="tab" data-tab="${tab}"><span class="tt">${tt}</span><span class="v ${cls}">${v}</span>${m ? `<span class="m">${m}</span>` : ''}</button>`;
  return mini('was', 'Was', `${free}<small>/ 4 vrij</small>`, '', free ? 'teal' : 'amber')
    + mini('mededelingen', 'Mededelingen', `${state.news.length}`, esc(state.news[0]?.body.slice(0, 28) || 'nog niets'))
    + mini('albums', 'Fotoalbums', `${albums}`)
    + mini('boetes', 'Boetes', euro(myFines.reduce((t, f) => t + Number(f.amount), 0)), myFines.length ? 'open' : '', myFines.length ? 'amber' : '')
    + mini('anytimers', 'Anytimers', `${mine}<small>/ ${onMe}</small>`, 'van jou / op jou');
}

function viewHome() {
  return `${board()}${hereStrip()}<div class="tiles">${tiles()}</div><div class="tiles minis">${miniTiles()}</div>`;
}

// ───────── Views ─────────
function viewSetup() {
  return `<section class="welcome"><div class="logo">V70</div>
    <p class="tag">Nog niet gekoppeld aan de database. Volg de stappen in de README van de repository.</p></section>`;
}

const roomSelect = (cur) => `<select name="room" required aria-label="Je kamer"><option value="">Welke kamer heb je?</option>${
  Array.from({ length: 17 }, (_, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>Kamer ${i + 1}</option>`).join('')}</select>`;

function viewOnboarding() {
  const code = (location.hash.match(/code=([A-Za-z0-9]+)/) || [])[1] || '';
  return `<section class="welcome"><div class="logo">V70</div><p class="tag">Verbs 70 · de app van ons huis</p>
    <div class="board"><h2>${code ? 'Je bent uitgenodigd' : 'Instappen'}</h2>
      <form data-form="join"><input name="code" placeholder="Code uit de uitnodiging" value="${esc(code)}" required autocapitalize="characters" autocomplete="off" aria-label="Uitnodigingscode">
        <input name="name" placeholder="Je naam" required maxlength="30" autocomplete="given-name" aria-label="Je naam">
        ${roomSelect()}<button class="primary">Kom erbij</button></form>
      ${code ? '' : '<p class="muted">Geen code? Vraag een huisgenoot om de uitnodigingslink.</p>'}</div>
    </section>`;
}

function viewAfval() {
  const me = state.me, w0 = curWeek(), next = nextDuty();
  const roomCard = me.room ? '' : `<div class="card today"><b>Kies je kamer</b><p class="muted">Dan weet V70 wanneer jij afvaldienst hebt.</p>
    <form data-form="room">${roomSelect()}<button class="primary">Opslaan</button></form></div>`;
  const incoming = swapsForMe().map((s) => {
    const theirs = afvalWeek(s.week_start), mine = nextDuty(me.id, theirs);
    const partner = duty(theirs).find((d) => d.id !== s.from_member)?.id;
    const from = esc(memberName(s.from_member));
    return `<div class="card today"><b>${from}</b> wil ruilen${s.to_member ? ' met jou' : ''}: week <b>${weekLabel(theirs)}</b>${partner ? ` met ${esc(memberName(partner))}` : ''}.
      <p class="muted">${mine === null ? 'Jij hebt nog geen week om terug te geven.' : `Jij doet dan die week, ${from} jouw week van ${weekLabel(mine)}.`}</p>
      <div class="row wrap">${mine === null ? '' : `<button class="primary" data-act="afvalswap" data-id="${s.id}" data-ans="accept">Akkoord, ruilen</button>`}
      ${s.to_member ? `<button data-act="afvalswap" data-id="${s.id}" data-ans="decline">Nee</button>` : `<button data-act="afvalnee" data-id="${s.id}">Nee</button>`}</div></div>`;
  }).join('');
  const mineOpen = state.afvalSwaps.filter((s) => s.from_member === me.id);
  const outgoing = mineOpen.map((s) => `<div class="card"><p class="muted">Je ruilverzoek voor ${weekLabel(afvalWeek(s.week_start))} (aan ${s.to_member ? esc(memberName(s.to_member)) : 'iedereen'}) wacht op antwoord.</p>
    <button data-act="afvalswap" data-id="${s.id}" data-ans="cancel">Intrekken</button></div>`).join('');
  const person = (d) => {
    const m = state.members.find((x) => x.id === d.id);
    return `<div class="row person">${m ? avatar(m, 'lg') : '<span class="av lg off">–</span>'}
      <div class="grow"><b>${m ? esc(m.name) : 'Leeg'}</b>${d.swapped ? '<div class="muted">geruild</div>' : ''}</div>
      ${d.id === me.id ? '<span class="chip warn">jij</span>' : ''}</div>`;
  };
  const partnerNext = next === null ? null : duty(next).find((d) => d.id !== me.id);
  const turn = next === null ? `<p class="muted">${me.room ? 'Nog niet ingeroosterd.' : 'Kies eerst je kamer.'}</p>`
    : `<div class="dayhead"><b>${weekLabel(next)}</b><span class="muted">met ${partnerNext?.id ? esc(memberName(partnerNext.id)) : 'niemand'}</span></div>
      ${mineOpen.some((s) => afvalWeek(s.week_start) === next) ? '' : `<div id="afvalruil"><button data-act="afvalruilform" data-week="${afvalWeekStart(next)}">Ruilen</button></div>`}`;
  const rows = Array.from({ length: 12 }, (_, k) => w0 + k).map((w) => `<div class="brow${onDuty(w) ? ' lvl0' : ''}">
    <span>${shortDay(afvalWeekStart(w))}</span><span>${esc(duoNames(w))}</span><span></span></div>`).join('');
  return `${roomCard}${incoming}${outgoing}
    <h2>Deze week · ${weekLabel(w0)}</h2><div class="card${onDuty(w0) ? ' today' : ''}">${duty(w0).map(person).join('')}
      <p class="muted">Afvalzakken weg · karton legen · glas weg · vaatdoeken wassen en opgevouwen terugleggen</p></div>
    <h2>Jouw beurt</h2><div class="card">${turn}</div>
    <section class="board"><h2>Komende weken</h2>${rows}</section>`;
}

function viewThuis() {
  const order = { home: 0, nearby: 1, away: 2, unknown: 3 };
  const list = [...state.members].sort((a, b) => order[a.zone] - order[b.zone] || a.name.localeCompare(b.name));
  const people = list.map((m) => `<div class="row person">${avatar(m, m.zone === 'home' ? 'lg' : 'lg off')}
    <div class="grow"><b>${esc(m.name)}</b>${m.id === state.me.id ? ' <span class="chip warn">jij</span>' : ''}<div class="muted">${m.room ? `kamer ${m.room} · ` : ''}${ago(m.zone_updated_at)}</div></div>
    <span class="chip ${m.zone}">${ZONES[m.zone]}</span></div>`).join('');
  const home = state.members.filter((m) => m.zone === 'home').length;
  const mine = ['home', 'nearby', 'away'].map((z) => `<button data-act="zone" data-zone="${z}" class="${state.me.zone === z ? 'on' : ''}">${ZONES[z]}</button>`).join('');
  const hook = `${SUPABASE_URL}/rest/v1/rpc/set_zone_by_token`;
  return `${hereStrip()}
    <h2>${home} van ${state.members.length} thuis</h2><div class="card">${people}</div>
    <h2>Zelf aangeven</h2><div class="card"><div class="row wrap">${mine}</div>
      ${homePos() ? '<button class="ghost" data-act="forgethome">Thuispunt wissen op dit toestel</button>' : ''}</div>
    <h2>Automatisch, ook als de app dicht is</h2><details class="card"><summary>Zo stel je het in op je telefoon</summary>
      <p class="muted">Een web-app kan je locatie niet volgen als hij dicht is. Je telefoon kan dat wel. Maak in de Opdrachten-app een persoonlijke automation <b>Bij aankomst</b> bij je huis, met de actie <b>Haal inhoud van URL op</b>, methode POST:</p>
      <p class="muted">URL</p><code>${esc(hook)}</code>
      <p class="muted">Header <b>apikey</b></p><code>${esc(SUPABASE_KEY)}</code>
      <p class="muted">Header <b>Content-Type</b>: application/json. Body (JSON):</p><code>{"p_token":"${esc(state.secret)}","p_zone":"home"}</code>
      <p class="muted">Maak er nog een voor <b>Bij vertrek</b> met "away" en zet "Vraag voor uitvoeren" uit. Op Android kan het met een automation-app. Deel je token met niemand.</p></details>`;
}

function viewUit() {
  const me = state.me, out = outActive(me);
  const pokes = out ? '' : pokesForMe().map((p) => {
    const from = state.members.find((m) => m.id === p.from_member);
    return `<div class="card today"><b>${esc(from?.name)}</b> wil vanavond uit${from?.out_place ? ` naar ${esc(from.out_place)}` : ''} en port jou.
      <div class="row wrap" style="margin-top:8px"><button class="primary" data-act="joinout" data-id="${p.from_member}">Ik ga mee</button>
      <button data-act="pornee" data-id="${p.id}">Niet vanavond</button></div></div>`;
  }).join('');
  const going = state.members.filter(outActive).sort((a, b) => (a.out_status === 'going' ? 0 : 1) - (b.out_status === 'going' ? 0 : 1));
  const no = state.members.filter(outNo);
  const open = state.members.filter((m) => !outActive(m) && !outNo(m));
  const line = (m) => `<div class="row person">${avatar(m, 'lg')}<div class="grow"><b>${esc(m.name)}</b> ${m.out_status === 'going' ? 'gaat' : 'wil'} uit
    <div class="muted">${[m.out_place, m.out_time && `om ${m.out_time}`, m.out_note].filter(Boolean).map(esc).join(' · ') || 'nog geen plek of tijd'}</div></div>
    ${m.id === me.id ? '<span class="chip warn">jij</span>' : ''}</div>`;
  const summary = going.length
    ? `<button class="outsum" data-act="outopen"><span class="stack">${going.slice(0, 6).map((m) => avatar(m)).join('')}</span>
        <span class="grow"><b>${going.length} ${going.length === 1 ? 'gaat' : 'gaan'} uit</b><small>${esc(going.find((m) => m.out_place)?.out_place || '')}${going.find((m) => m.out_time) ? ` · vanaf ${going.find((m) => m.out_time).out_time}` : ''} · tik voor wie, waar en hoe laat</small></span></button>
      ${!out && !outNo(me) ? `<div class="row wrap" style="margin-top:10px"><button class="primary" data-act="joinout" data-id="${going[0].id}">Ik ga mee</button><button data-act="outno">Ik ga niet mee</button></div>` : ''}`
    : '<p class="muted">Nog niemand. Wees de eerste.</p>';
  const detail = state.outOpen && going.length ? `<div class="outdetail">${going.map(line).join('')}
      ${no.length ? `<p class="muted">Gaan niet mee: ${esc(names(no.map((m) => m.id), 17))}</p>` : ''}
      ${open.length ? `<p class="muted">Nog niet gereageerd: ${esc(names(open.map((m) => m.id), 17))}</p>` : ''}</div>` : '';
  const mine = out
    ? `<div class="row"><div class="grow"><b>Jij ${me.out_status === 'going' ? 'gaat' : 'wil'} uit</b><div class="muted">${[me.out_place, me.out_time && `om ${me.out_time}`, me.out_note].filter(Boolean).map(esc).join(' · ') || 'vanavond'}</div></div>
       <form data-form="out"><button name="status" value="none">Toch niet</button></form></div>`
    : `<form data-form="out">
      <input name="place" placeholder="Waar? (bijv. stad, kroeg)" maxlength="80">
      <div class="row"><label class="grow">Hoe laat?<input name="time" type="time"></label></div>
      <input name="note" placeholder="Opmerking (met wie, hoe, …)" maxlength="200">
      <div class="row wrap"><button class="primary" name="status" value="wants">Ik wil uit</button><button name="status" value="going">Ik ga uit</button></div></form>
      ${outNo(me) ? '<p class="muted">Je gaat vanavond niet mee.</p>' : ''}`;
  const poked = state.pokes.filter((p) => p.from_member === me.id).map((p) => p.to_member);
  const canPoke = state.members.filter((m) => m.id !== me.id && !outActive(m) && !poked.includes(m.id));
  const por = out && canPoke.length ? `<h2>Iemand porren</h2><div class="card"><form data-form="por" class="row">
      <select name="to" class="grow" aria-label="Wie wil je porren?"><option value="">Kies een huisgenoot</option>${canPoke.map((m) => `<option value="${m.id}">${esc(m.name)} (${ZONES[m.zone]})</option>`).join('')}</select>
      <button class="primary">Por</button></form>${poked.length ? `<p class="muted">Al gepord: ${esc(names(poked, 17))}</p>` : ''}</div>` : '';
  return `${pokes}<h2>Vanavond uit</h2><div class="card">${summary}${detail}</div>
    <h2>Jij</h2><div class="card">${mine}</div>${por}
    <h2>Agenda</h2>${agenda()}
    ${polls()}
    <details class="card"><summary><b>Activiteit toevoegen</b></summary><form data-form="activity">
      <input name="title" placeholder="Wat? (huisavond, filmavond, Catan, borrel)" required maxlength="120">
      <div class="row"><label class="grow">Datum (mag leeg)<input name="day" type="date" min="${today()}"></label>
        <label class="grow">Tijd (mag leeg)<input name="time" type="time"></label></div>
      <input name="note" placeholder="Opmerking" maxlength="500"><button class="primary">Toevoegen</button></form></details>
    <details class="card"><summary><b>Datumprikker maken</b></summary><form data-form="poll">
      <input name="title" placeholder="Waarvoor? (huisweekend, kerstdiner)" required maxlength="120">
      ${[0, 1, 2, 3].map((i) => `<div class="row"><label class="grow">Optie ${i + 1}<input name="d${i}" type="date" min="${today()}" ${i ? '' : 'required'}></label><label class="grow">Tijd<input name="t${i}" type="time"></label></div>`).join('')}
      <button class="primary">Rondsturen</button></form></details>`;
}

// Huisagenda: per dag, zonder datum onderaan. Tik op een activiteit voor details en wie er meegaat.
function agenda() {
  const row = (a) => {
    const my = state.actRsvps.find((x) => x.activity_id === a.id && x.member_id === state.me.id)?.answer;
    return `<button class="actrow" data-act="openact" data-id="${a.id}"><span class="grow"><b>${esc(a.title)}</b>
      <small>${a.starts_at ? hhmm(new Date(a.starts_at)) + ' · ' : ''}${actMee(a)} mee${my ? ` · jij: ${my}` : ''}</small></span>${ICON.chevron}</button>`;
  };
  const days = [...new Set(state.activities.map(actDay).filter(Boolean))].sort();
  const undated = state.activities.filter((a) => !actDay(a));
  const groups = days.map((d) => `<div class="card${d === today() ? ' today' : ''}"><div class="agday">${d === today() ? 'Vandaag' : d === addIso(today(), 1) ? 'Morgen' : dayLabel(d)}</div>
    ${state.activities.filter((a) => actDay(a) === d).map(row).join('')}</div>`).join('');
  const rest = undated.length ? `<div class="card"><div class="agday">Datum volgt</div>${undated.map(row).join('')}</div>` : '';
  return groups + rest || '<div class="card"><p class="muted">Nog niets gepland. Voeg hieronder iets toe: huisavond, filmavond, spelletjes…</p></div>';
}

function polls() {
  if (!state.polls.length) return '';
  const me = state.me;
  return `<h2>Datumprikker</h2>` + state.polls.map((p) => {
    const opts = state.pollOptions.filter((o) => o.poll_id === p.id);
    const rows = opts.map((o) => {
      const vs = state.pollVotes.filter((v) => v.option_id === o.id), mine = vs.find((v) => v.member_id === me.id)?.answer;
      const ja = vs.filter((v) => v.answer === 'ja').length, mis = vs.filter((v) => v.answer === 'misschien').length;
      return `<div class="pollrow"><div class="grow"><b>${dayLabel(o.day)}${o.time ? ` ${o.time}` : ''}</b><div class="muted">${ja} ja · ${mis} misschien</div></div>
        <div class="seg">${['ja', 'misschien', 'nee'].map((a) => `<button class="${mine === a ? 'on' : ''}" data-act="vote" data-id="${o.id}" data-ans="${a}">${a === 'misschien' ? '?' : a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>
        ${p.created_by === me.id || me.is_admin ? `<button class="ghost" data-act="pollact" data-id="${o.id}">Kies</button>` : ''}</div>`;
    }).join('');
    return `<div class="card"><div class="dayhead"><b>${esc(p.title)}</b><span class="muted">${esc(memberName(p.created_by))}</span></div>${rows}
      ${p.created_by === me.id || me.is_admin ? `<button class="ghost" data-act="pollclose" data-id="${p.id}">Sluiten zonder activiteit</button>` : ''}</div>`;
  }).join('');
}

function rsvpButtons(kind, id, mineAnswer) {
  return ['mee', 'misschien', 'niet'].map((a) => `<button data-act="${kind}" data-id="${id}" data-ans="${a}" class="${mineAnswer === a ? 'on' : ''}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('');
}

// ───────── Activiteit: details, wie gaat mee, POV-album ─────────
const allActs = () => [...state.activities, ...state.pastActs];
const povStart = (a) => (a.starts_at ? new Date(a.starts_at) : actDay(a) ? new Date(actDay(a) + 'T00:00:00') : null);
const povReveal = (a) => (actDay(a) ? new Date(addIso(actDay(a), 1) + 'T10:00:00') : null);
const albumActs = () => allActs().filter((a) => state.povPhotos.some((p) => p.activity_id === a.id) || (povStart(a) && povStart(a) <= new Date() && new Date() < povReveal(a)));
const photoGrid = (ps) => `<div class="photos">${ps.map((p) => `<img data-path="${esc(p.path)}" data-act="openphoto" alt="Foto van ${esc(memberName(p.member_id))}">`).join('')}</div>`;

function viewAct() {
  const a = allActs().find((x) => x.id === state.actId);
  if (!a) return '<div class="card"><p class="muted">Deze activiteit bestaat niet meer.</p><button data-act="tab" data-tab="uit">Terug naar activiteiten</button></div>';
  const me = state.me, rs = state.actRsvps.filter((x) => x.activity_id === a.id), my = rs.find((x) => x.member_id === me.id)?.answer;
  const by = (ans) => rs.filter((x) => x.answer === ans).map((x) => x.member_id);
  const none = state.members.filter((m) => !rs.some((x) => x.member_id === m.id)).map((m) => m.id);
  const group = (title, ids) => (ids.length ? `<div class="grp"><div class="agday">${title} (${ids.length})</div><div class="stack wrap">${ids.map((id) => state.members.find((m) => m.id === id)).filter(Boolean).map((m) => `<span class="pill">${avatar(m)}${esc(m.name)}</span>`).join('')}</div></div>` : '');
  const start = povStart(a), reveal = povReveal(a), now = new Date();
  const mine = state.povPhotos.filter((p) => p.activity_id === a.id && p.member_id === me.id), all = state.povPhotos.filter((p) => p.activity_id === a.id);
  const pov = !start ? '<p class="muted">Geef de activiteit een datum, dan komt er automatisch een fotoalbum bij.</p>'
    : now < start ? `<p class="muted">Het album gaat open bij de start: ${a.starts_at ? whenShort(a.starts_at) : dayLabel(actDay(a))}. Iedereen kan dan ${POV_MAX} foto's maken.</p>`
      : now < reveal ? `<p class="muted">Nog ${POV_MAX - mine.length} van ${POV_MAX} foto's. Het album ontwikkelt ${dayLabel(addIso(actDay(a), 1))} om 10:00; tot dan zie je alleen je eigen foto's.</p>
        ${mine.length < POV_MAX ? `<label class="btn primary">Foto maken<input type="file" accept="image/*" capture="environment" data-photo="pov" data-id="${a.id}" hidden></label>` : ''}
        ${photoGrid(mine)}`
        : a.drive_url ? `<p class="muted">De foto's van deze activiteit staan in de Drive.</p><a class="btn" href="${esc(a.drive_url)}" target="_blank" rel="noopener">Bekijk in Google Drive</a>`
        : all.length ? `<p class="muted">${all.length} foto's van ${new Set(all.map((p) => p.member_id)).size} huisgenoten.</p>${photoGrid(all)}` : '<p class="muted">Er zijn geen foto\'s gemaakt.</p>';
  return `<button class="ghost" data-act="tab" data-tab="uit">Terug naar activiteiten</button>
    <div class="card"><div class="dayhead"><b class="big">${esc(a.title)}</b></div>
      <p class="muted">${actDay(a) ? `${dayLabel(actDay(a))}${a.starts_at ? ' om ' + hhmm(new Date(a.starts_at)) : ''}` : 'Datum volgt'} · gepland door ${esc(memberName(a.created_by))}</p>
      ${a.note ? `<p>${esc(a.note)}</p>` : ''}
      <div class="row wrap">${rsvpButtons('arsvp', a.id, my)}</div></div>
    <h2>Wie gaat er mee</h2><div class="card">${group('Mee', by('mee'))}${group('Misschien', by('misschien'))}${group('Niet', by('niet'))}${group('Nog niet gereageerd', none)}</div>
    <h2>Fotoalbum</h2><div class="card">${pov}</div>
    ${a.created_by === me.id || me.is_admin ? `<button class="ghost" data-act="delact" data-id="${a.id}">Activiteit verwijderen</button>` : ''}`;
}

function viewAlbums() {
  const acts = albumActs().sort((x, y) => (actDay(y) || '').localeCompare(actDay(x) || '')).slice(0, 5);
  const drive = state.household?.drive_url ? `<a class="btn primary drivebtn" href="${esc(state.household.drive_url)}" target="_blank" rel="noopener">Naar de huis-Drive</a>
    <p class="muted">De app toont de 5 nieuwste albums. Oudere albums gaan automatisch naar een eigen mapje in de Drive.</p>` : '';
  return drive + (acts.map((a) => {
    const ps = state.povPhotos.filter((p) => p.activity_id === a.id), busy = new Date() < povReveal(a);
    return `<button class="card album" data-act="openact" data-id="${a.id}"><div class="dayhead"><b>${esc(a.title)}</b><span class="muted">${dayLabel(actDay(a))}</span></div>
      <span class="muted">${busy ? `album ontwikkelt ${dayLabel(addIso(actDay(a), 1))} 10:00 · jij hebt er ${ps.filter((p) => p.member_id === state.me.id).length}` : `${ps.length} foto's`}</span>
      ${busy ? '' : photoGrid(ps.slice(0, 6))}</button>`;
  }).join('') || '<div class="card"><p class="muted">Nog geen albums. Bij elke activiteit met een datum komt er automatisch een album: vanaf de start kan iedereen 25 foto\'s maken, en de dag erna om 10:00 ontwikkelt het album.</p></div>');
}

// ───────── Eten: eerst een kok, dan pas mee-eten ─────────
function viewEten() {
  const me = state.me;
  return Array.from({ length: 7 }, (_, i) => addIso(today(), i)).map((day) => {
    const d = state.dinners.find((x) => x.day === day), cooks = cooksOf(d);
    const r = d ? state.dinRsvps.filter((x) => x.dinner_id === d.id) : [], my = r.find((x) => x.member_id === me.id);
    const eat = r.filter((x) => x.answer === 'mee').map((x) => x.member_id), amCook = cooks.includes(me.id);
    const body = !cooks.length
      ? `<p class="muted">Nog niemand kookt.</p><button class="primary" data-act="kok" data-id="${day}">Ik ga koken</button>`
      : `<div><b>Kok${cooks.length > 1 ? 's' : ''}: ${esc(names(cooks, 5))}</b>${d.menu ? ` · ${esc(d.menu)}` : ''}</div>
        <div class="row wrap" style="margin:8px 0">${amCook
          ? `<button data-act="nokok" data-id="${day}">Ik kook toch niet</button>`
          : `${['mee', 'niet'].map((a) => `<button data-act="drsvp" data-id="${day}" data-ans="${a}" class="${my?.answer === a ? 'on' : ''}">${a === 'mee' ? 'Ik eet mee' : 'Niet'}</button>`).join('')}
             <button data-act="guest" data-id="${day}">+ gast (${my?.guests || 0})</button><button data-act="kok" data-id="${day}">Ik kook ook</button>`}</div>
        <div class="muted">Mee: ${esc(names(eat, 8))} · nog niet gereageerd: ${state.members.length - r.length}</div>
        ${amCook ? `<details><summary>Menu</summary><form data-form="dinner" data-day="${day}"><input name="menu" placeholder="Wat eten we?" maxlength="120" value="${esc(d.menu)}"><button>Opslaan</button></form></details>` : ''}`;
    return `<div class="card ${day === today() ? 'today' : ''}"><div class="dayhead"><b>${dayLabel(day)}</b><span class="chip">${eaters(d)} eters</span></div>${body}</div>`;
  }).join('');
}

// ───────── Was: 2 wasmachines, 2 drogers ─────────
const MACHINES = [{ id: 'was1', name: 'Wasmachine 1' }, { id: 'was2', name: 'Wasmachine 2' }, { id: 'droger1', name: 'Droger 1' }, { id: 'droger2', name: 'Droger 2' }];
const machineBusy = (id) => state.laundry.find((l) => l.machine === id && new Date(l.starts_at) <= new Date() && new Date(l.ends_at) > new Date());
const machName = (id) => MACHINES.find((m) => m.id === id)?.name || id;
const slotLabel = (l) => `${dayLabel(iso(new Date(l.starts_at)))} ${hhmm(new Date(l.starts_at))}–${hhmm(new Date(l.ends_at))}`;
function viewWas() {
  const me = state.me;
  const cards = MACHINES.map((mc) => {
    const now = machineBusy(mc.id), next = state.laundry.filter((l) => l.machine === mc.id && l !== now);
    return `<div class="card"><div class="dayhead"><b>${mc.name}</b>${now ? `<span class="chip ${now.member_id === me.id ? 'warn' : 'away'}">bezet tot ${hhmm(new Date(now.ends_at))}</span>` : '<span class="chip home">nu vrij</span>'}</div>
      ${[now, ...next].filter(Boolean).map((l) => `<div class="row person"><span class="grow">${slotLabel(l)} · ${l.member_id === me.id ? '<b>jij</b>' : esc(memberName(l.member_id))}</span>
        ${l.member_id === me.id || me.is_admin ? `<button class="ghost" data-act="release" data-id="${l.id}">Weg</button>` : ''}</div>`).join('')}</div>`;
  }).join('');
  const t = new Date(Math.ceil(Date.now() / 9e5) * 9e5); // eerstvolgende kwartier
  return `<h2>Dibsen</h2><div class="card"><form data-form="was">
      <select name="machine" required aria-label="Machine">${MACHINES.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
      <div class="row"><label class="grow">Dag<select name="day">${[0, 1, 2, 3].map((i) => `<option value="${addIso(today(), i)}">${dayLabel(addIso(today(), i))}</option>`).join('')}</select></label>
        <label class="grow">Vanaf<input name="time" type="time" step="900" value="${hhmm(t)}"></label></div>
      <label>Hoe lang<select name="dur"><option value="60">1 uur</option><option value="90" selected>1,5 uur</option><option value="120">2 uur</option><option value="150">2,5 uur</option><option value="180">3 uur</option><option value="night">Nachtwas (23:00 – 08:00)</option></select></label>
      <button class="primary">Dibs</button></form></div>
    <h2>Machines</h2>${cards}`;
}

// ───────── Mededelingen ─────────
function viewNews() {
  const list = state.news.map((n) => {
    const m = state.members.find((x) => x.id === n.created_by);
    return `<div class="card"><div class="row">${m ? avatar(m) : ''}<b class="grow">${esc(m?.name || 'Oud-huisgenoot')}</b><span class="muted">${ago(n.created_at)}</span></div>
      <p class="newsbody">${esc(n.body)}</p>${n.created_by === state.me.id || state.me.is_admin ? `<button class="ghost" data-act="delnews" data-id="${n.id}">Verwijderen</button>` : ''}</div>`;
  }).join('') || '<div class="card"><p class="muted">Nog geen mededelingen.</p></div>';
  return `<div class="card"><form data-form="news"><textarea name="body" rows="3" maxlength="1000" required placeholder="Iets belangrijks voor het hele huis?"></textarea>
    <button class="primary">Plaatsen (iedereen krijgt een melding)</button></form></div>${list}`;
}

// ───────── Boetes ─────────
const euro = (n) => `€ ${Number(n).toFixed(2).replace('.', ',')}`;
function viewFines() {
  const me = state.me, h = state.household;
  const mine = state.fines.filter((f) => f.member_id === me.id), open = mine.filter((f) => !f.paid_at);
  const total = open.reduce((t, f) => t + Number(f.amount), 0);
  const desc = `Boete V70 ${me.name}`;
  const pay = !open.length ? '<p class="muted">Je hebt geen openstaande boetes.</p>'
    : !h?.iban ? '<p class="muted">De beheerder heeft nog geen huisrekening ingevuld (Profiel → Beheer).</p>'
      : `<div class="paybox"><div><span class="muted">Naar</span><b>${esc(h.iban)}</b>${h.iban_name ? `<span class="muted">t.n.v. ${esc(h.iban_name)}</span>` : ''}</div>
        <div><span class="muted">Bedrag</span><b>${euro(total)}</b></div><div><span class="muted">Omschrijving</span><b>${esc(desc)}</b></div></div>
        <div class="row wrap"><button class="primary" data-act="copy" data-text="${esc(h.iban)}">Kopieer IBAN</button>
        <button data-act="copy" data-text="${total.toFixed(2).replace('.', ',')}">Kopieer bedrag</button><button data-act="copy" data-text="${esc(desc)}">Kopieer omschrijving</button></div>
        <p class="muted">Maak het over in je bank-app. De beheerder vinkt je boete af zodra het geld binnen is.</p>`;
  const row = (f, admin) => `<div class="row person"><div class="grow"><b>${euro(f.amount)}</b> · ${esc(f.reason)}<div class="muted">${admin ? esc(memberName(f.member_id)) + ' · ' : ''}${dayLabel(iso(new Date(f.created_at)))}${f.paid_at ? ' · betaald' : ''}</div></div>
    ${admin && !f.paid_at ? `<button data-act="finepaid" data-id="${f.id}">Betaald</button><button class="ghost" data-act="finedel" data-id="${f.id}">Weg</button>` : ''}</div>`;
  const admin = me.is_admin ? `<h2>Beheer: boete geven</h2><div class="card"><form data-form="fine">
      <select name="member" required aria-label="Wie"><option value="">Wie?</option>${state.members.map((m) => `<option value="${m.id}">${esc(m.name)}${m.room ? ` (kamer ${m.room})` : ''}</option>`).join('')}</select>
      <div class="row"><label class="grow">Bedrag (€)<input name="amount" inputmode="decimal" value="5" required></label></div>
      <input name="reason" list="redenen" value="Afvaldienst niet gedaan" maxlength="120" required><datalist id="redenen"><option value="Afvaldienst niet gedaan"></datalist>
      <button class="primary">Boete geven</button></form></div>
    <h2>Alle open boetes</h2><div class="card">${state.fines.filter((f) => !f.paid_at).map((f) => row(f, true)).join('') || '<p class="muted">Geen open boetes.</p>'}</div>` : '';
  return `<div class="card"><div class="dayhead"><b>Open</b><b class="big ${total ? 'amberText' : ''}">${euro(total)}</b></div>${open.map((f) => row(f)).join('')}${pay}</div>
    ${mine.some((f) => f.paid_at) ? `<details class="card"><summary>Betaald</summary>${mine.filter((f) => f.paid_at).map((f) => row(f)).join('')}</details>` : ''}${admin}`;
}

// ───────── Anytimers ─────────
function viewAnytimers() {
  const me = state.me, onMe = state.anytimers.filter((x) => x.debtor === me.id), mine = state.anytimers.filter((x) => x.holder === me.id);
  const who = (id) => esc(memberName(id));
  const per = (list, key) => [...new Set(list.map((x) => x[key]))].map((id) => [id, list.filter((x) => x[key] === id)]);
  const times = (n) => (n > 1 ? ` <span class="chip">${n}×</span>` : '');
  const pend = (x, mine) => `<div class="row person"><div class="grow"><b>${who(mine ? x.debtor : x.holder)}</b>${x.reason ? ` · ${esc(x.reason)}` : ''}
      <div class="muted">${mine ? 'wacht op bevestiging' : 'zegt een anytimer op je te hebben'}</div></div>
    ${mine ? `<button class="ghost" data-act="anyact" data-id="${x.id}" data-ans="cancel">Intrekken</button>`
      : `<button class="primary" data-act="anyact" data-id="${x.id}" data-ans="accept">Klopt</button><button data-act="anyact" data-id="${x.id}" data-ans="reject">Klopt niet</button>`}</div>`;
  const onMeRows = onMe.filter((x) => x.status === 'pending').map((x) => pend(x, false)).join('')
    + onMe.filter((x) => x.status === 'claimed').map((x) => `<div class="row person"><div class="grow"><b>${who(x.holder)}</b><div class="muted">zet er een in!</div></div>
      <label class="btn primary">Bewijs sturen<input type="file" accept="image/*" capture="user" data-photo="anytimer" data-id="${x.id}" hidden></label></div>`).join('')
    + per(onMe.filter((x) => x.status === 'open'), 'holder').map(([id, xs]) => `<div class="row person"><div class="grow"><b>${who(id)}</b>${times(xs.length)}
      <div class="muted">heeft er ${xs.length} op jou</div></div></div>`).join('');
  const mineRows = mine.filter((x) => x.status === 'pending').map((x) => pend(x, true)).join('')
    + per(mine.filter((x) => ['open', 'claimed'].includes(x.status)), 'debtor').map(([id, xs]) => {
      const open = xs.filter((x) => x.status === 'open'), claimed = xs.length - open.length;
      return `<div class="row person"><div class="grow"><b>${who(id)}</b>${times(xs.length)}
        <div class="muted">${[open.length && `${open.length} klaar om in te zetten`, claimed && `${claimed} ingezet, wacht op bewijs`].filter(Boolean).join(' · ')}</div></div>
        ${open.length ? `<button class="primary" data-act="anyact" data-id="${open[0].id}" data-ans="claim">Inzetten</button>` : ''}</div>`;
    }).join('');
  const doneRow = (x) => `<div class="row person"><div class="grow"><b>${who(x.debtor)}</b><div class="muted">gedaan ${ago(x.done_at)}</div>
      ${x.photo_path ? photoGrid([{ path: x.photo_path, member_id: x.debtor }]) : ''}</div></div>`;
  const others = state.members.filter((m) => m.id !== me.id);
  return `${onMe.some((x) => x.status === 'claimed') ? '<div class="card today"><b>Er is een anytimer op je ingezet.</b><p class="muted">Drinken, foto maken en als bewijs sturen. Alleen de gever ziet de foto.</p></div>' : ''}
    <h2>Op jou (${onMe.filter((x) => x.status !== 'done').length})</h2><div class="card">${onMeRows || '<p class="muted">Niemand heeft er een op jou.</p>'}</div>
    <h2>Van jou (${mine.filter((x) => x.status !== 'done').length})</h2><div class="card">${mineRows || '<p class="muted">Je hebt er nog geen.</p>'}</div>
    <details class="card"><summary><b>Anytimer toevoegen</b></summary><form data-form="anytimer">
      <select name="debtor" required aria-label="Op wie"><option value="">Ik heb een anytimer op…</option>${others.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
      <input name="reason" maxlength="120" placeholder="Waarvoor? (weddenschap verloren, …)"><button class="primary">Toevoegen</button>
      <p class="muted">De ander moet bevestigen dat het klopt.</p></form></details>
    ${mine.some((x) => x.status === 'done') ? `<details class="card"><summary>Gedaan (met bewijs)</summary>${mine.filter((x) => x.status === 'done').map(doneRow).join('')}</details>` : ''}`;
}

// ───────── Foto's: verkleinen, uploaden en tonen ─────────
const POV_MAX = 25;
// shortcut: 1280 px / JPEG 0,72 (~150–250 kB); bij 1 GB gratis opslag past dat ~5000 foto's, daarna oude albums opruimen.
async function compress(file, max = 1280, q = 0.72) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', q));
}
const photoPath = (kind) => `${state.me.household_id}/${kind}/${state.me.id}/${crypto.randomUUID()}.jpg`;
async function addPov(actId, files) {
  let n = 0;
  for (const file of files) {
    const path = photoPath('pov');
    const row = await sb.from('pov_photos').insert({ activity_id: actId, path }); // eerst de rij: de database bewaakt max. 25 en het tijdvak
    if (row.error) { toast('Kan geen foto meer toevoegen (max. 25, of het album is dicht)'); break; }
    const up = await sb.storage.from('v70').upload(path, await compress(file), { contentType: 'image/jpeg' });
    if (up.error) { await sb.from('pov_photos').delete().eq('path', path); toast('Uploaden mislukt: ' + up.error.message); break; }
    n++;
  }
  if (n) { toast(n === 1 ? 'Foto toegevoegd' : `${n} foto's toegevoegd`); await loadAll(); render(); }
}
async function anytimerProof(id, file) {
  const path = photoPath('anytimer');
  const up = await sb.storage.from('v70').upload(path, await compress(file), { contentType: 'image/jpeg' });
  if (up.error) return toast('Uploaden mislukt: ' + up.error.message);
  if (await run(sb.rpc('anytimer_act', { p_id: id, p_action: 'proof', p_photo: path }), 'Bewijs verstuurd')) notify('anytimer', { id });
}
const urls = new Map();
async function hydratePhotos() {
  const imgs = [...document.querySelectorAll('img[data-path]')].filter((i) => !i.src);
  if (!imgs.length || !sb) return;
  const need = [...new Set(imgs.map((i) => i.dataset.path))].filter((p) => !urls.has(p));
  if (need.length) {
    const { data } = await sb.storage.from('v70').createSignedUrls(need, 3600);
    (data || []).forEach((d) => d.signedUrl && urls.set(d.path, d.signedUrl));
  }
  imgs.forEach((i) => { if (urls.has(i.dataset.path)) i.src = urls.get(i.dataset.path); });
}

function viewPush() {
  const why = '<p class="muted">Je krijgt een melding als jouw beurt eraan komt, iemand met je wil ruilen, een huisgenoot uit wil, een activiteit plant of het avondeten invult.</p>';
  const body = {
    unknown: '<p class="muted">Bezig met controleren…</p>',
    unconfigured: '<p class="muted">Meldingen zijn nog niet ingesteld op de server.</p>',
    unsupported: '<p class="muted">Deze browser ondersteunt geen meldingen.</p>',
    'needs-install': '<p>Op iPhone werken meldingen alleen vanaf het beginscherm: Safari → Deel → <b>Zet op beginscherm</b>. Open V70 daarna via het icoon.</p>',
    denied: '<p>Meldingen zijn geblokkeerd. Zet ze aan via de instellingen van je telefoon (Meldingen → V70) en open de app opnieuw.</p>',
    off: '<button class="primary" data-act="pushon">Meldingen aanzetten</button>',
    on: '<p>Meldingen staan aan op dit toestel.</p><div class="row wrap"><button data-act="pushtest">Testmelding</button><button data-act="pushoff">Uitzetten</button></div>',
  }[state.push];
  return `<h2>Meldingen</h2><div class="card">${why}${body}</div>`;
}

function adminPanel() {
  const people = state.members.map((m) => `<div class="row person">${avatar(m)}<span class="grow">${esc(m.name)}${m.room ? ` <span class="muted">kamer ${m.room}</span>` : ''} ${m.is_admin ? '<span class="chip">beheerder</span>' : ''}</span>
    ${m.id === state.me.id ? '' : `<button data-act="admin" data-id="${m.id}" data-val="${!m.is_admin}">${m.is_admin ? 'Geen beheerder' : 'Beheerder'}</button>
    <button data-act="rmmember" data-id="${m.id}">Verwijder</button>`}</div>`).join('');
  return `<h2>Beheer: huisrekening</h2><div class="card"><form data-form="iban">
      <label>IBAN voor boetes<input name="iban" value="${esc(state.household?.iban)}" placeholder="NL00 BANK 0000 0000 00" autocomplete="off"></label>
      <label>Ten name van<input name="name" value="${esc(state.household?.iban_name)}" placeholder="Naam op de rekening"></label>
      <button>Opslaan</button></form></div>
    <h2>Beheer: huis-Drive</h2><div class="card"><form data-form="drive">
      <label>Link naar de gedeelde Google Drive-map<input name="url" value="${esc(state.household?.drive_url)}" placeholder="https://drive.google.com/drive/folders/…"></label>
      <button>Opslaan</button></form></div>
    <h2>Beheer: huisgenoten</h2><div class="card">${people}</div>`;
}

function viewIk() {
  return `<div class="card profile">${avatar(state.me, 'xl')}<div class="grow"><b>${esc(state.me.name)}</b>
      <div class="muted">${esc(state.household?.name)}${state.me.room ? ` · kamer ${state.me.room}` : ''}${state.me.is_admin ? ' · beheerder' : ''}</div></div></div>
    <h2>Jouw kamer</h2><div class="card"><form data-form="room">${roomSelect(state.me.room)}<button>Opslaan</button></form></div>
    <h2>Huisgenoten uitnodigen</h2><div class="card"><p class="muted">Stuur de link naar een nieuwe huisgenoot. De code is <b class="code">${esc(state.household?.join_code)}</b></p>
      <button class="primary" data-act="invite">Deel uitnodigingslink</button></div>
    ${viewPush()}
    ${state.me.is_admin ? adminPanel() : ''}`;
}

const VIEWS = { home: viewHome, afval: viewAfval, thuis: viewThuis, uit: viewUit, eten: viewEten, ik: viewIk,
  was: viewWas, mededelingen: viewNews, albums: viewAlbums, boetes: viewFines, anytimers: viewAnytimers, act: viewAct };

function render(skipIfBusy = false) {
  const onboarding = !state.me;
  $('#tabs').hidden = onboarding;
  $('#top').hidden = onboarding;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (!onboarding) {
    $('#sub').textContent = state.tab === 'home'
      ? `Verbs 70 · ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' })}` : TAB_LABEL[state.tab];
    $('#me').textContent = initials(state.me.name);
  }
  document.title = onboarding || state.tab === 'home' ? 'V70' : `${TAB_LABEL[state.tab]} · V70`;
  // Realtime-update mag typen of een open formulier niet onderbreken.
  if (skipIfBusy && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || $('#view form details[open], #view details[open] form, #afvalruil form'))) return;
  $('#view').innerHTML = onboarding ? viewOnboarding() : (VIEWS[state.tab] || viewHome)();
  hydratePhotos();
}

// ───────── Acties ─────────
async function ensureDinner(day) {
  const d = state.dinners.find((x) => x.day === day);
  if (d) return d;
  const r = await sb.from('dinners').upsert({ day }, { onConflict: 'household_id,day' }).select().single();
  if (r.error) { toast(r.error.message); return null; }
  return r.data;
}
// "Uit" geldt voor vanavond en verloopt om 06:00 de volgende ochtend.
const outUntil = () => { const d = new Date(); if (d.getHours() >= 6) d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d.toISOString(); };
function setTab(tab) { state.tab = tab; history.replaceState(null, '', '#' + (tab === 'act' ? `act=${state.actId}` : tab)); render(); scrollTo(0, 0); }

const actions = {
  tab(el) { setTab(el.dataset.tab); },
  zone(el) { return setZone(el.dataset.zone); },
  locate: () => locate(false), sethome: saveHome, forgethome: forgetHome,
  pushon: enablePush, pushoff: disablePush, pushtest: testPush,
  async invite() {
    const url = `${location.origin}${location.pathname}#code=${state.household?.join_code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'V70', text: 'Kom erbij in de V70-app van ons huis', url });
      else { await navigator.clipboard.writeText(url); toast('Link gekopieerd'); }
    } catch { /* delen geannuleerd */ }
  },
  async joinout(el) {
    const o = state.members.find((m) => m.id === el.dataset.id);
    if (await run(sb.from('members').update({ out_status: 'going', out_place: o?.out_place || null, out_time: o?.out_time || null, out_note: null, out_until: outUntil() }).eq('id', state.me.id), 'Top, je gaat mee')) notify('out');
  },
  async por(el) {
    const p = await run(sb.from('out_pokes').insert({ to_member: el.dataset.id }).select('id').single(), `${memberName(el.dataset.id)} gepord`);
    if (p) notify('por', { id: p.id });
  },
  pornee(el) { store.set('pornee', `${store.get('pornee') || ''} ${el.dataset.id}`.slice(-2000)); render(); },
  outopen() { state.outOpen = !state.outOpen; render(); },
  outno() { return run(sb.from('members').update({ out_status: 'no', out_place: null, out_time: null, out_note: null, out_until: outUntil() }).eq('id', state.me.id), 'Oké, je gaat niet mee'); },
  openact(el) { state.actId = el.dataset.id; setTab('act'); },
  async kok(el) {
    const d = await ensureDinner(el.dataset.id); if (!d) return;
    const cur = state.dinRsvps.find((x) => x.dinner_id === d.id && x.member_id === state.me.id);
    if (await run(sb.from('dinner_rsvps').upsert({ dinner_id: d.id, answer: 'kok', guests: cur?.guests || 0 }, { onConflict: 'dinner_id,member_id' }), 'Top, jij kookt. Iedereen krijgt een melding.')) notify('kok', { day: el.dataset.id });
  },
  nokok(el) {
    const d = state.dinners.find((x) => x.day === el.dataset.id);
    return d && run(sb.from('dinner_rsvps').delete().eq('dinner_id', d.id).eq('member_id', state.me.id), 'Je kookt niet meer');
  },
  release(el) { return run(sb.from('laundry_slots').delete().eq('id', el.dataset.id), 'Dibs weggehaald'); },
  afvalnee(el) { store.set('afvalnee', `${store.get('afvalnee') || ''} ${el.dataset.id}`.slice(-2000)); render(); },
  delnews(el) { if (confirm('Mededeling verwijderen?')) return run(sb.from('announcements').delete().eq('id', el.dataset.id), 'Verwijderd'); },
  vote(el) {
    const cur = state.pollVotes.find((v) => v.option_id === el.dataset.id && v.member_id === state.me.id);
    return cur?.answer === el.dataset.ans
      ? run(sb.from('date_poll_votes').delete().eq('option_id', el.dataset.id).eq('member_id', state.me.id))
      : run(sb.from('date_poll_votes').upsert({ option_id: el.dataset.id, answer: el.dataset.ans }, { onConflict: 'option_id,member_id' }));
  },
  pollclose(el) { if (confirm('Datumprikker sluiten?')) return run(sb.from('date_polls').update({ closed: true }).eq('id', el.dataset.id), 'Gesloten'); },
  async pollact(el) {
    const o = state.pollOptions.find((x) => x.id === el.dataset.id), p = state.polls.find((x) => x.id === o?.poll_id);
    if (!o || !confirm(`${p.title} op ${dayLabel(o.day)} zetten?`)) return;
    const a = await run(sb.from('activities').insert({ title: p.title, day: o.day, starts_at: o.time ? new Date(`${o.day}T${o.time}`).toISOString() : null }).select('id').single(), 'Activiteit gepland');
    if (!a) return;
    await run(sb.from('date_polls').update({ closed: true }).eq('id', p.id));
    notify('activity', { id: a.id });
  },
  finepaid(el) { return run(sb.from('fines').update({ paid_at: new Date().toISOString() }).eq('id', el.dataset.id), 'Afgevinkt als betaald'); },
  finedel(el) { if (confirm('Boete verwijderen?')) return run(sb.from('fines').delete().eq('id', el.dataset.id), 'Verwijderd'); },
  async copy(el) { try { await navigator.clipboard.writeText(el.dataset.text); toast('Gekopieerd'); } catch { toast(el.dataset.text); } },
  async anyact(el) {
    const msg = { accept: 'Bevestigd', reject: 'Weggehaald', cancel: 'Ingetrokken', claim: 'Ingezet! Hij krijgt een melding.' }[el.dataset.ans];
    if (await run(sb.rpc('anytimer_act', { p_id: el.dataset.id, p_action: el.dataset.ans }), msg) && el.dataset.ans === 'claim') notify('anytimer', { id: el.dataset.id });
  },
  openphoto(el) {
    if (!el.src) return;
    const box = Object.assign(document.createElement('div'), { className: 'lightbox' });
    box.innerHTML = `<img src="${el.src}" alt="">`;
    box.onclick = () => box.remove();
    document.body.append(box);
  },
  arsvp(el) { return run(sb.from('activity_rsvps').upsert({ activity_id: el.dataset.id, answer: el.dataset.ans }, { onConflict: 'activity_id,member_id' })); },
  delact(el) { if (confirm('Activiteit verwijderen?')) return run(sb.from('activities').delete().eq('id', el.dataset.id), 'Verwijderd'); },
  async drsvp(el) {
    const d = await ensureDinner(el.dataset.id); if (!d) return;
    const cur = state.dinRsvps.find((x) => x.dinner_id === d.id && x.member_id === state.me.id);
    return run(sb.from('dinner_rsvps').upsert({ dinner_id: d.id, answer: el.dataset.ans, guests: cur?.guests || 0 }, { onConflict: 'dinner_id,member_id' }));
  },
  async guest(el) {
    const d = await ensureDinner(el.dataset.id); if (!d) return;
    const cur = state.dinRsvps.find((x) => x.dinner_id === d.id && x.member_id === state.me.id);
    const guests = ((cur?.guests || 0) + 1) % 6; // 0..5, daarna weer 0
    return run(sb.from('dinner_rsvps').upsert({ dinner_id: d.id, answer: cur?.answer || 'mee', guests }, { onConflict: 'dinner_id,member_id' }));
  },
  // — afvaldienst —
  afvalruilform(el) {
    const week = el.dataset.week, busy = duty(afvalWeek(week)).map((d) => d.id);
    const opts = state.members.filter((m) => !busy.includes(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('#afvalruil').innerHTML = `<form data-form="afvalruil" data-week="${week}"><select name="to" aria-label="Met wie ruilen?"><option value="">Iedereen (wie het eerst accepteert)</option>${opts}</select>
      <div class="row wrap"><button class="primary">Vraag ruil aan</button><button type="button" data-act="afvalruilclose">Annuleren</button></div></form>`;
  },
  afvalruilclose() { render(); },
  async afvalswap(el) {
    const ok = await run(sb.rpc('afval_respond_swap', { p_id: el.dataset.id, p_action: el.dataset.ans }),
      { accept: 'Geruild', decline: 'Geweigerd', cancel: 'Ingetrokken' }[el.dataset.ans]);
    if (ok && el.dataset.ans !== 'cancel') notify('afvalruil', { id: el.dataset.id });
  },
  admin(el) { return run(sb.rpc('set_admin', { p_member: el.dataset.id, p_value: el.dataset.val === 'true' })); },
  rmmember(el) { if (confirm(`${memberName(el.dataset.id)} uit het huis verwijderen?`)) return run(sb.from('members').delete().eq('id', el.dataset.id), 'Verwijderd'); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
addEventListener('hashchange', () => { const t = tabFromHash(); if (t && t !== state.tab && state.me) setTab(t); });
addEventListener('scroll', () => $('#top').classList.toggle('scrolled', scrollY > 6), { passive: true });

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true; // dubbel tikken = één actie
  try {
    const v = Object.fromEntries(new FormData(f));
    const kind = f.dataset.form;
    if (kind === 'join') {
      const r = await sb.rpc('join_household', { p_code: v.code, p_name: v.name });
      if (r.error) return toast(r.error.message);
      const room = await sb.rpc('set_room', { p_room: Number(v.room) });
      if (room.error) toast(room.error.message + '. Kies een andere kamer onder Profiel.');
      state.tab = 'home'; history.replaceState(null, '', '#home'); // code niet in de adresbalk laten staan
      await loadAll(); state.push = await detectPush(); render();
      toast('Welkom in V70');
    } else if (kind === 'out') {
      const status = btn?.value || 'wants';
      const ok = await run(sb.from('members').update({
        out_status: status, out_place: status === 'none' ? null : v.place || null, out_note: status === 'none' ? null : v.note || null,
        out_time: status === 'none' ? null : v.time || null, out_until: status === 'none' ? null : outUntil(),
      }).eq('id', state.me.id), 'Status bijgewerkt');
      if (ok && status !== 'none') notify('out');
    } else if (kind === 'activity') {
      const day = v.day || (v.time ? today() : null); // alleen een tijd = vandaag
      const a = await run(sb.from('activities').insert({ title: v.title, note: v.note || null, day, starts_at: day && v.time ? new Date(`${day}T${v.time}`).toISOString() : null }).select('id').single(), 'Toegevoegd');
      if (a) notify('activity', { id: a.id });
    } else if (kind === 'dinner') {
      await run(sb.from('dinners').upsert({ day: f.dataset.day, menu: v.menu || null }, { onConflict: 'household_id,day' }), 'Menu opgeslagen');
    } else if (kind === 'por') {
      if (!v.to) return toast('Kies wie je wilt porren');
      const p = await run(sb.from('out_pokes').insert({ to_member: v.to }).select('id').single(), `${memberName(v.to)} gepord`);
      if (p) notify('por', { id: p.id });
    } else if (kind === 'news') {
      const n = await run(sb.from('announcements').insert({ body: v.body.trim() }).select('id').single(), 'Geplaatst');
      if (n) notify('mededeling', { id: n.id });
    } else if (kind === 'poll') {
      const days = [0, 1, 2, 3].map((i) => ({ day: v['d' + i], time: v['t' + i] || null })).filter((x) => x.day);
      if (!days.length) return toast('Kies minstens één datum');
      const p = await run(sb.from('date_polls').insert({ title: v.title }).select('id').single());
      if (!p) return;
      await run(sb.from('date_poll_options').insert(days.map((x) => ({ poll_id: p.id, ...x }))), 'Datumprikker gemaakt');
      notify('prikker', { id: p.id });
    } else if (kind === 'fine') {
      const fi = await run(sb.from('fines').insert({ member_id: v.member, amount: Number(String(v.amount).replace(',', '.')), reason: v.reason }).select('id').single(), 'Boete gegeven');
      if (fi) notify('boete', { id: fi.id });
    } else if (kind === 'was') {
      const night = v.dur === 'night';
      const start = new Date(`${v.day}T${night ? '23:00' : v.time || '00:00'}`);
      const end = night ? new Date(`${addIso(v.day, 1)}T08:00`) : new Date(start.getTime() + Number(v.dur) * 60000);
      const r = await sb.from('laundry_slots').insert({ machine: v.machine, starts_at: start.toISOString(), ends_at: end.toISOString() });
      if (r.error) return toast(r.error.message.includes('row-level') ? 'Die tijd is al gedibst (of ligt in het verleden)' : r.error.message);
      toast(`${machName(v.machine)} gedibst: ${hhmm(start)}–${hhmm(end)}`); await loadAll(); render();
    } else if (kind === 'drive') {
      await run(sb.rpc('set_house_drive', { p_url: v.url }), 'Drive-link opgeslagen');
    } else if (kind === 'iban') {
      await run(sb.rpc('set_house_iban', { p_iban: v.iban, p_name: v.name }), 'Huisrekening opgeslagen');
    } else if (kind === 'anytimer') {
      const a = await run(sb.from('anytimers').insert({ debtor: v.debtor, reason: v.reason || null }).select('id').single(), 'Verstuurd, wacht op bevestiging');
      if (a) notify('anytimer', { id: a.id });
    } else if (kind === 'room') {
      await run(sb.rpc('set_room', { p_room: Number(v.room) }), `Kamer ${v.room} opgeslagen`);
    } else if (kind === 'afvalruil') {
      const id = await run(sb.rpc('afval_request_swap', { p_week: f.dataset.week, p_to: v.to || null }), 'Ruilverzoek verstuurd');
      if (id) notify('afvalruil', { id });
    }
  } finally { if (btn?.isConnected) btn.disabled = false; }
});

document.addEventListener('change', (e) => {
  const inp = e.target.closest('input[type=file][data-photo]'); if (!inp?.files?.length) return;
  const files = [...inp.files]; inp.value = '';
  if (inp.dataset.photo === 'pov') addPov(inp.dataset.id, files);
  else anytimerProof(inp.dataset.id, files[0]);
});

// ───────── Start ─────────
(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!sb) { $('#view').innerHTML = viewSetup(); return; }
  try {
    state.session = await ensureSession();
    await loadAll(); render(); subscribe();
    autoLocate();
    state.push = await detectPush(); if (state.tab === 'ik') render();
    if (state.push === 'on' && state.me) currentSub().then((s) => s && saveSub(s)); // server-kant up-to-date houden
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshSoon(); autoLocate(); } });
  } catch (err) {
    $('#view').innerHTML = `<section class="welcome"><div class="logo">V70</div><div class="card"><b>Kan niet verbinden</b><p class="muted">${esc(err.message || err)}</p>
      <button class="primary" onclick="location.reload()">Opnieuw proberen</button></div></section>`;
  }
})();
