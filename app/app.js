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
const TABS = ['home', 'afval', 'thuis', 'uit', 'activiteiten', 'eten', 'ik'];
const TAB_LABEL = { home: 'Overzicht', afval: 'Afvaldienst', thuis: 'Wie is thuis', uit: 'Uit', activiteiten: 'Activiteiten', eten: 'Eten', ik: 'Profiel' };
const state = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home',
  push: 'unknown', // unconfigured | unsupported | needs-install | denied | off | on
  me: null, household: null, secret: null, session: null,
  members: [], afvalOverrides: [], afvalSwaps: [],
  activities: [], actRsvps: [], dinners: [], dinRsvps: [],
};

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
const timeFmt = (ts) => (ts ? new Date(ts).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ago = (ts) => {
  const m = Math.round((Date.now() - new Date(ts)) / 60000);
  return m < 1 ? 'zojuist' : m < 60 ? `${m} min geleden` : m < 1440 ? `${Math.round(m / 60)} uur geleden` : `${Math.round(m / 1440)} d geleden`;
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 2600);
}
const ZONES = { home: 'thuis', nearby: 'in de buurt', away: 'weg', unknown: 'onbekend' };
const OUT_HOURS = 12; // "wil uit" verloopt vanzelf, anders blijft het dagen staan
const outActive = (m) => m.out_status !== 'none' && (!m.out_until || new Date(m.out_until) > new Date());
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
const duoNames = (w) => duty(w).map((d) => (d.id === state.me.id ? 'jij' : d.id ? memberName(d.id) : `kamer ${d.room} leeg`)).join(' & ');
// Ruilverzoeken die jij kunt accepteren: aan jou, of aan iedereen terwijl jij die week vrij bent.
const swapsForMe = () => state.afvalSwaps.filter((s) => s.from_member !== state.me.id
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
  const actSince = new Date(Date.now() - 6 * 3600e3).toISOString(); // activiteiten van vandaag blijven nog even staan
  const res = await Promise.all([
    sb.from('members').select('*').order('created_at'),
    sb.from('afval_overrides').select('*').gte('week_start', afvalWeekStart(curWeek())),
    sb.from('afval_swaps').select('*').eq('status', 'open').gte('week_start', afvalWeekStart(curWeek())),
    sb.from('activities').select('*').or(`starts_at.is.null,starts_at.gte.${actSince}`).order('starts_at', { nullsFirst: false }).limit(50),
    sb.from('activity_rsvps').select('*'),
    sb.from('dinners').select('*').gte('day', t).order('day').limit(14),
    sb.from('dinner_rsvps').select('*'),
  ]);
  const err = res.find((r) => r.error)?.error;
  if (err) throw err;
  const [m, ov, sw, a, ar, dn, dr] = res.map((x) => x.data);
  Object.assign(state, { members: m, afvalOverrides: ov, afvalSwaps: sw, activities: a, actRsvps: ar, dinners: dn, dinRsvps: dr });
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
  ['members', 'afval_overrides', 'afval_swaps', 'activities', 'activity_rsvps', 'dinners', 'dinner_rsvps']
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
const eaters = (d) => (d ? state.dinRsvps.filter((x) => x.dinner_id === d.id && x.answer === 'mee').reduce((s, x) => s + 1 + x.guests, 0) : 0);
const nextActivity = () => state.activities.find((a) => a.starts_at && new Date(a.starts_at) > Date.now() - 2 * 3600e3);
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
  if (d?.menu || n) rows.push({ k: 'eten', lvl: 1, t: 'vanavond', w: d?.menu ? `Eten · ${d.menu}` : 'Eten', who: `${n} mee`, tab: 'eten' });
  const a = nextActivity();
  if (a && new Date(a.starts_at) - Date.now() < 7 * 864e5) {
    rows.push({ k: 'act' + a.id, lvl: iso(new Date(a.starts_at)) === t ? 1 : 2, t: whenShort(a.starts_at), w: a.title, who: `${actMee(a)} mee`, tab: 'activiteiten' });
  }
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
  const cook = d?.cook_id ? memberName(d.cook_id) : null; // het menu staat al op het bord
  const out = state.members.filter(outActive);
  const a = nextActivity();

  return `<button class="tile wide" data-act="tab" data-tab="afval"><span class="tt">Afvaldienst · ${weekLabel(w)}</span>
      <span class="v">${esc(duoNames(w))}</span>${afvalMeta}</button>
    <button class="tile" data-act="tab" data-tab="thuis"><span class="tt">Wie is thuis</span>
      <span class="v teal">${home.length}<small>/ ${state.members.length}</small></span><span class="stack">${stack}</span></button>
    <button class="tile" data-act="tab" data-tab="eten"><span class="tt">Eten vanavond</span>
      <span class="v">${eaters(d)}<small>mee</small></span><span class="m">${esc(cook ? `kok: ${cook}` : d?.menu || 'nog geen menu')}</span>
      ${myDinner ? '' : '<span class="m act">jij: nog niet gereageerd</span>'}</button>
    <button class="tile" data-act="tab" data-tab="uit"><span class="tt">Uit</span>
      <span class="v${out.length ? ' amber' : ''}">${out.length}<small>${out.length === 1 ? 'persoon' : 'personen'}</small></span>
      <span class="m">${esc(out.length ? names(out.map((m) => m.id), 3) : 'niemand gaat uit')}</span></button>
    <button class="tile" data-act="tab" data-tab="activiteiten"><span class="tt">Activiteiten</span>
      <span class="v">${a ? esc(whenShort(a.starts_at)) : 'Niks'}</span>
      <span class="m">${a ? `${esc(a.title)} · ${actMee(a)} mee` : 'plan iets leuks'}</span></button>`;
}

function viewHome() {
  return `${board()}${hereStrip()}<div class="tiles">${tiles()}</div>`;
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
    <details><summary>Huis opzetten (alleen de eerste keer)</summary>
      <form data-form="create"><input name="household" value="Verbs 70" required maxlength="60" aria-label="Naam van het huis">
        <input name="name" placeholder="Je naam" required maxlength="30" aria-label="Je naam">${roomSelect()}<button>Huis opzetten</button></form></details></section>`;
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
      ${s.to_member ? `<button data-act="afvalswap" data-id="${s.id}" data-ans="decline">Nee</button>` : ''}</div></div>`;
  }).join('');
  const mineOpen = state.afvalSwaps.filter((s) => s.from_member === me.id);
  const outgoing = mineOpen.map((s) => `<div class="card"><p class="muted">Je ruilverzoek voor ${weekLabel(afvalWeek(s.week_start))} (aan ${s.to_member ? esc(memberName(s.to_member)) : 'iedereen'}) wacht op antwoord.</p>
    <button data-act="afvalswap" data-id="${s.id}" data-ans="cancel">Intrekken</button></div>`).join('');
  const person = (d) => {
    const m = state.members.find((x) => x.id === d.id);
    return `<div class="row person">${m ? avatar(m, 'lg') : '<span class="av lg off">–</span>'}
      <div class="grow"><b>${m ? esc(m.name) : 'Leeg'}</b><div class="muted">kamer ${d.room}${d.swapped ? ' · geruild' : ''}</div></div>
      ${d.id === me.id ? '<span class="chip warn">jij</span>' : ''}</div>`;
  };
  const partnerNext = next === null ? null : duty(next).find((d) => d.id !== me.id);
  const turn = next === null ? `<p class="muted">${me.room ? 'Nog niet ingeroosterd.' : 'Kies eerst je kamer.'}</p>`
    : `<div class="dayhead"><b>${weekLabel(next)}</b><span class="muted">met ${partnerNext?.id ? esc(memberName(partnerNext.id)) : `kamer ${partnerNext?.room} (leeg)`}</span></div>
      ${mineOpen.some((s) => afvalWeek(s.week_start) === next) ? '' : `<div id="afvalruil"><button data-act="afvalruilform" data-week="${afvalWeekStart(next)}">Ruilen</button></div>`}`;
  const rows = Array.from({ length: 12 }, (_, k) => w0 + k).map((w) => `<div class="brow${onDuty(w) ? ' lvl0' : ''}">
    <span>${shortDay(afvalWeekStart(w))}</span><span>${afvalRooms(w).join(' + ')}</span><span>${esc(duoNames(w))}</span></div>`).join('');
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
  const mine = state.me;
  const others = state.members.filter((m) => m.id !== mine.id && outActive(m));
  const list = others.map((m) => `<div class="card"><div class="row">${avatar(m, 'lg')}
    <div class="grow"><b>${esc(m.name)}</b> ${m.out_status === 'going' ? 'gaat' : 'wil'} uit${m.out_place ? ` · ${esc(m.out_place)}` : ''}
    <div class="muted">${esc(m.out_note)}</div></div>
    <button data-act="joinout" data-id="${m.id}">Ik ook</button></div></div>`).join('') || '<div class="card"><p class="muted">Niemand heeft nu plannen.</p></div>';
  const now = !outActive(mine) ? 'geen plannen' : mine.out_status === 'wants' ? 'wil uit' : 'gaat uit';
  return `<h2>Mijn status</h2><div class="card"><form data-form="out">
    <input name="place" placeholder="Waar? (bijv. stad, bioscoop)" maxlength="80" value="${esc(outActive(mine) ? mine.out_place : '')}">
    <input name="note" placeholder="Opmerking" maxlength="200" value="${esc(outActive(mine) ? mine.out_note : '')}">
    <div class="row wrap"><button class="primary" name="status" value="wants">Ik wil uit</button>
    <button name="status" value="going">Ik ga uit</button><button name="status" value="none">Niet meer</button></div></form>
    <p class="muted">Nu: ${now}</p></div>
    <h2>Huisgenoten</h2>${list}`;
}

function rsvpButtons(kind, id, mineAnswer) {
  return ['mee', 'misschien', 'niet'].map((a) => `<button data-act="${kind}" data-id="${id}" data-ans="${a}" class="${mineAnswer === a ? 'on' : ''}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('');
}

function viewActiviteiten() {
  const items = state.activities.map((a) => {
    const r = state.actRsvps.filter((x) => x.activity_id === a.id);
    const my = r.find((x) => x.member_id === state.me.id)?.answer;
    const mee = r.filter((x) => x.answer === 'mee').map((x) => x.member_id);
    return `<div class="card"><div class="dayhead"><b>${esc(a.title)}</b><span class="muted">${timeFmt(a.starts_at)}</span></div>
      <div class="muted">${esc(a.note)}</div>
      <div class="row wrap" style="margin:8px 0">${rsvpButtons('arsvp', a.id, my)}</div>
      <div class="muted"><b>${mee.length}</b> mee: ${esc(names(mee, 8))}</div>
      ${a.created_by === state.me.id || state.me.is_admin ? `<button data-act="delact" data-id="${a.id}">Verwijderen</button>` : ''}</div>`;
  }).join('') || '<div class="card"><p class="muted">Nog geen activiteiten. Voeg er een toe: film, spelletjes, klussen…</p></div>';
  return `<h2>Nieuwe activiteit</h2><div class="card"><form data-form="activity">
    <input name="title" placeholder="Wat? (filmavond, Catan, tuin opruimen)" required maxlength="120">
    <input name="starts_at" type="datetime-local"><input name="note" placeholder="Opmerking" maxlength="500"><button class="primary">Toevoegen</button></form></div>
    <h2>Gepland</h2>${items}`;
}

function viewEten() {
  const days = Array.from({ length: 7 }, (_, i) => addIso(today(), i));
  return days.map((day) => {
    const d = state.dinners.find((x) => x.day === day);
    const r = d ? state.dinRsvps.filter((x) => x.dinner_id === d.id) : [];
    const my = r.find((x) => x.member_id === state.me.id);
    const eat = r.filter((x) => x.answer === 'mee');
    const open = state.members.length - r.length;
    return `<div class="card ${day === today() ? 'today' : ''}"><div class="dayhead"><b>${dayLabel(day)}</b>
      <span class="chip">${eaters(d)} eters</span></div>
      <div>${d?.menu ? esc(d.menu) : '<span class="muted">Nog geen menu</span>'}${d?.cook_id ? ` · kok: ${esc(memberName(d.cook_id))}` : ''}</div>
      <div class="row wrap" style="margin:8px 0">${rsvpButtons('drsvp', day, my?.answer)}
      <button data-act="guest" data-id="${day}">+gast (${my?.guests || 0})</button></div>
      <div class="muted">Mee: ${esc(names(eat.map((x) => x.member_id), 8))} · nog niet gereageerd: ${open}</div>
      <details><summary>Menu / kok</summary><form data-form="dinner" data-day="${day}">
        <input name="menu" placeholder="Wat eten we?" maxlength="120" value="${esc(d?.menu)}">
        <select name="cook"><option value="">Wie kookt?</option>${state.members.map((m) => `<option value="${m.id}" ${d?.cook_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <button>Opslaan</button></form></details></div>`;
  }).join('');
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
  return `    <h2>Beheer: huisgenoten</h2><div class="card">${people}</div>`;
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

const VIEWS = { home: viewHome, afval: viewAfval, thuis: viewThuis, uit: viewUit, activiteiten: viewActiviteiten, eten: viewEten, ik: viewIk };

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
}

// ───────── Acties ─────────
async function ensureDinner(day) {
  const d = state.dinners.find((x) => x.day === day);
  if (d) return d;
  const r = await sb.from('dinners').upsert({ day }, { onConflict: 'household_id,day' }).select().single();
  if (r.error) { toast(r.error.message); return null; }
  return r.data;
}
const outUntil = () => new Date(Date.now() + OUT_HOURS * 3600e3).toISOString();
function setTab(tab) { state.tab = tab; history.replaceState(null, '', '#' + tab); render(); scrollTo(0, 0); }

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
    if (await run(sb.from('members').update({ out_status: 'going', out_place: o.out_place, out_note: o.out_note, out_until: o.out_until || outUntil() }).eq('id', state.me.id), 'Top, je gaat mee')) notify('out');
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
    const opts = state.members.filter((m) => !busy.includes(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}${m.room ? ` (kamer ${m.room})` : ''}</option>`).join('');
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
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== state.tab && state.me) setTab(t); });
addEventListener('scroll', () => $('#top').classList.toggle('scrolled', scrollY > 6), { passive: true });

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const btn = e.submitter; if (btn) btn.disabled = true; // dubbel tikken = één actie
  try {
    const v = Object.fromEntries(new FormData(f));
    const kind = f.dataset.form;
    if (kind === 'create' || kind === 'join') {
      const r = kind === 'create'
        ? await sb.rpc('create_household', { p_household: v.household, p_name: v.name })
        : await sb.rpc('join_household', { p_code: v.code, p_name: v.name });
      if (r.error) return toast(r.error.message);
      const room = await sb.rpc('set_room', { p_room: Number(v.room) });
      if (room.error) toast(room.error.message + '. Kies een andere kamer onder Profiel.');
      state.tab = 'home'; history.replaceState(null, '', '#home'); // code niet in de adresbalk laten staan
      await loadAll(); state.push = await detectPush(); render();
      toast(kind === 'create' ? 'Huis opgezet. Deel de uitnodigingslink via Profiel.' : 'Welkom in V70');
    } else if (kind === 'out') {
      const status = btn?.value || 'wants';
      const ok = await run(sb.from('members').update({
        out_status: status, out_place: status === 'none' ? null : v.place || null, out_note: status === 'none' ? null : v.note || null,
        out_until: status === 'none' ? null : outUntil(),
      }).eq('id', state.me.id), 'Status bijgewerkt');
      if (ok && status !== 'none') notify('out');
    } else if (kind === 'activity') {
      const a = await run(sb.from('activities').insert({ title: v.title, note: v.note || null, starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null }).select('id').single(), 'Toegevoegd');
      if (a) notify('activity', { id: a.id });
    } else if (kind === 'dinner') {
      const day = f.dataset.day;
      const old = state.dinners.find((x) => x.day === day);
      const ok = await run(sb.from('dinners').upsert({ day, menu: v.menu || null, cook_id: v.cook || null }, { onConflict: 'household_id,day' }), 'Opgeslagen');
      if (ok && v.menu && (v.menu !== old?.menu || (v.cook || null) !== (old?.cook_id || null))) notify('dinner', { day });
    } else if (kind === 'room') {
      await run(sb.rpc('set_room', { p_room: Number(v.room) }), `Kamer ${v.room} opgeslagen`);
    } else if (kind === 'afvalruil') {
      const id = await run(sb.rpc('afval_request_swap', { p_week: f.dataset.week, p_to: v.to || null }), 'Ruilverzoek verstuurd');
      if (id) notify('afvalruil', { id });
    }
  } finally { if (btn?.isConnected) btn.disabled = false; }
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
