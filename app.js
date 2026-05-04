// ============================================================================
// ROULETTE ADMIN APP — v3.2 PERFORMANCE EDITION
// ✓ localStorage cache for instant boot
// ✓ Debounced renders (no more 4-panel re-render storm)
// ✓ Lazy tab rendering — only active tab renders
// ✓ limitToLast on history & live_spins (bounded payloads)
// ✓ Event delegation for dynamic lists (no listener leaks)
// ✓ requestAnimationFrame for DOM batching
// ✓ Memoized stats / overview / users
// ============================================================================
import {
  db, auth, ref, set, push, get, onValue, update, remove, query, orderByKey, limitToLast,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from './firebase-config.js';
import { PredictionEngine } from './prediction-engine.js';

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const numColor = n => n === 0 ? 'G' : (RED_NUMBERS.has(n) ? 'R' : 'B');
const numEO    = n => n === 0 ? null : (n % 2 === 0 ? 'E' : 'O');

// Caps to keep things smooth
const HISTORY_CAP = 3000;
const LIVE_CAP = 500;
const SESSIONS_RENDER_CAP = 100;
const USERS_RENDER_CAP = 100;

const CACHE = {
  sessions: 'rpadm_sess_v2',
  users: 'rpadm_users_v2',
  history: 'rpadm_hist_v2',
  live: 'rpadm_live_v2'
};

// ---------- Tiny utils ----------
function clean(obj) {
  const r = {};
  Object.keys(obj || {}).forEach(k => {
    if (obj[k] !== undefined && obj[k] !== null) r[k] = obj[k];
  });
  return r;
}
function deepClean(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.map(deepClean).filter(v => v !== null);
  if (typeof obj === 'object') {
    const r = {};
    Object.keys(obj).forEach(k => {
      const v = deepClean(obj[k]);
      if (v !== null && v !== undefined) r[k] = v;
    });
    return r;
  }
  return obj;
}
function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
function rafThrottle(fn) {
  let pending = false, lastArgs;
  return function (...args) {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn.apply(this, lastArgs); });
  };
}
function safeStorage(k, v) {
  try { localStorage.setItem(k, v); }
  catch {
    // Storage full? Try clearing other caches first.
    try { Object.values(CACHE).forEach(c => { if (c !== k) localStorage.removeItem(c); }); localStorage.setItem(k, v); }
    catch {}
  }
}

// ---------- Toast ----------
function toast(msg, type = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2400);
}
function showLoginMsg(msg, type) {
  const m = $('loginMsg');
  if (!m) return;
  m.textContent = msg;
  m.className = 'msg ' + type;
}
function vibrate(ms = 10) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

// ---------- AUTH ----------
$('loginBtn').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const pw = $('password').value;
  if (!email || !pw) return showLoginMsg('Email & password required', 'error');
  try { await signInWithEmailAndPassword(auth, email, pw); }
  catch (e) { showLoginMsg(prettyAuthErr(e), 'error'); }
});
$('signupBtn').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const pw = $('password').value;
  if (!email || pw.length < 6) return showLoginMsg('Email + password (6+ chars) required', 'error');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await set(ref(db, `admins/${cred.user.uid}`), { email, createdAt: Date.now() });
    showLoginMsg('✓ Admin account created! 🎉', 'success');
  } catch (e) { showLoginMsg(prettyAuthErr(e), 'error'); }
});
$('forgotBtn').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return showLoginMsg('Enter your email first', 'error');
  try { await sendPasswordResetEmail(auth, email); showLoginMsg('✓ Password reset email sent', 'success'); }
  catch (e) { showLoginMsg(prettyAuthErr(e), 'error'); }
});
$('logoutBtn').addEventListener('click', () => signOut(auth));

function prettyAuthErr(e) {
  const m = (e.code || e.message || '').toString();
  if (m.includes('user-not-found')) return 'No account with this email';
  if (m.includes('wrong-password') || m.includes('invalid-credential')) return 'Wrong password';
  if (m.includes('invalid-email')) return 'Invalid email format';
  if (m.includes('email-already')) return 'Email already in use';
  if (m.includes('weak-password')) return 'Password too weak (6+ chars)';
  if (m.includes('network')) return 'Network error — check connection';
  return e.message || 'Something went wrong';
}

const unsubs = [];

onAuthStateChanged(auth, user => {
  if (user) {
    $('loginScreen').classList.remove('active');
    $('dashboard').classList.add('active');
    const name = (user.email || '').split('@')[0];
    $('adminChip').textContent = '⚙ ' + name;
    $('welcomeName').textContent = ', ' + name;
    initDashboard();
  } else {
    unsubs.forEach(u => { try { u(); } catch {} });
    unsubs.length = 0;
    $('dashboard').classList.remove('active');
    $('loginScreen').classList.add('active');
  }
});

// ---------- TABS (lazy render) ----------
let activeTab = 'overview';
$$('.tab').forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));
$$('[data-go-tab]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.goTab)));

function goTab(name) {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.tab-panel').forEach(x => x.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');
  document.querySelector(`.tab-panel[data-panel="${name}"]`)?.classList.add('active');
  activeTab = name;
  // Lazy: only render the just-opened panel
  if (name === 'stats') renderStats();
  if (name === 'overview') renderOverview();
  if (name === 'data') renderData();
  if (name === 'users') renderUsers();
  // Avoid smooth scroll (laggy on weak phones)
  window.scrollTo(0, 0);
}

// Mode buttons (upload tab)
document.querySelectorAll('.upload-modes .mode-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.upload-modes .mode-btn').forEach(x => x.classList.remove('active'));
  $$('.mode-content').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelector(`.mode-content[data-content="${b.dataset.mode}"]`)?.classList.add('active');
}));

// ---------- DATA STATE ----------
let allSessions = {};
let allUsers = {};
let allHistory = {};
let allLiveSpins = [];
let quickBuffer = [];
let numBuffer = [];
const testEngine = new PredictionEngine();
let testSeq = [];
let testMode = 'even_odd';

// Hydrate from cache so the dashboard is INSTANT (no waiting on Firebase)
(function bootstrapFromCache() {
  try {
    const s = JSON.parse(localStorage.getItem(CACHE.sessions) || 'null');
    const u = JSON.parse(localStorage.getItem(CACHE.users) || 'null');
    const h = JSON.parse(localStorage.getItem(CACHE.history) || 'null');
    const l = JSON.parse(localStorage.getItem(CACHE.live) || 'null');
    if (s && typeof s === 'object') allSessions = s;
    if (u && typeof u === 'object') allUsers = u;
    if (h && typeof h === 'object') {
      allHistory = h;
      testEngine.setHistory(Object.values(allHistory));
    }
    if (Array.isArray(l)) allLiveSpins = l;
  } catch {}
})();

// Throttled / debounced renderers
const renderOverviewT = rafThrottle(_renderOverview);
const renderDataD     = debounce(_renderData, 120);
const renderStatsD    = debounce(_renderStats, 150);
const renderUsersD    = debounce(_renderUsers, 120);
const renderLiveFeedT = rafThrottle(_renderLiveFeed);

// Public wrappers — only render visible tab
function renderOverview() { _renderOverview(); }
function renderData()     { _renderData(); }
function renderStats()    { _renderStats(); }
function renderUsers()    { _renderUsers(); }
function renderLiveFeed() { _renderLiveFeed(); }

function initDashboard() {
  // Clean up existing listeners
  unsubs.forEach(u => { try { u(); } catch {} });
  unsubs.length = 0;

  // Show cached state immediately
  buildOverviewActivity();
  if (activeTab === 'overview') renderOverviewT();

  // Sessions can stay full (small) — but debounce render
  unsubs.push(onValue(ref(db, 'sessions'), snap => {
    allSessions = snap.val() || {};
    safeStorage(CACHE.sessions, JSON.stringify(allSessions));
    if (activeTab === 'overview') renderOverviewT();
    if (activeTab === 'data') renderDataD();
    if (activeTab === 'stats') renderStatsD();
  }));

  unsubs.push(onValue(ref(db, 'users'), snap => {
    allUsers = snap.val() || {};
    safeStorage(CACHE.users, JSON.stringify(allUsers));
    if (activeTab === 'users') renderUsersD();
    if (activeTab === 'overview') renderOverviewT();
  }));

  // BIG WIN: bound history fetch with limitToLast
  const histQuery = query(ref(db, 'history'), orderByKey(), limitToLast(HISTORY_CAP));
  unsubs.push(onValue(histQuery, snap => {
    allHistory = snap.val() || {};
    safeStorage(CACHE.history, JSON.stringify(allHistory));
    testEngine.setHistory(Object.values(allHistory));
    if (activeTab === 'stats') renderStatsD();
    if (activeTab === 'overview') renderOverviewT();
  }));

  // Bound live feed
  const liveQuery = query(ref(db, 'live_spins'), orderByKey(), limitToLast(LIVE_CAP));
  unsubs.push(onValue(liveQuery, snap => {
    const data = snap.val() || {};
    allLiveSpins = Object.entries(data).map(([k, v]) => ({ id: k, ...v }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    safeStorage(CACHE.live, JSON.stringify(allLiveSpins));
    if (activeTab === 'live') renderLiveFeedT();
    if (activeTab === 'overview') renderOverviewT();
  }));

  buildNumberPads();
}

// ---------- OVERVIEW ----------
let _ovKey = '';
function _renderOverview() {
  if (!$('ovTotalSpins')) return;
  const sessionCount = Object.keys(allSessions).length;
  const userCount = Object.keys(allUsers).length;
  let totalSpins = 0;
  Object.values(allSessions).forEach(s => {
    const c = s.count || (Array.isArray(s.data) ? s.data.length : 0);
    totalSpins += c;
  });
  if (totalSpins === 0) totalSpins = Object.keys(allHistory).length;

  const today = new Date(); today.setHours(0,0,0,0);
  const todaySpins = allLiveSpins.filter(s => (s.timestamp || 0) >= today.getTime()).length;

  let totalPreds = 0, totalCorrect = 0;
  Object.values(allUsers).forEach(u => {
    totalPreds += u.predictionCount || 0;
    totalCorrect += u.correctCount || 0;
  });
  const accuracy = totalPreds > 0 ? (totalCorrect / totalPreds * 100).toFixed(1) + '%' : '—';

  // Memoize: skip redundant DOM writes if nothing changed
  const key = `${totalSpins}|${sessionCount}|${userCount}|${totalPreds}|${totalCorrect}|${todaySpins}`;
  if (key !== _ovKey) {
    _ovKey = key;
    $('ovTotalSpins').textContent = totalSpins.toLocaleString();
    $('ovSessions').textContent = sessionCount;
    $('ovUsers').textContent = userCount;
    $('ovPreds').textContent = totalPreds;
    $('ovAccuracy').textContent = accuracy;
    $('ovLive').textContent = todaySpins;
    renderHealth(totalSpins, sessionCount, userCount);
  }
  buildOverviewActivity();
}

function renderHealth(spins, sessions, users) {
  const issues = [];
  if (spins === 0) issues.push({ level: 'bad', msg: '✕ No training data yet — predictions will be inaccurate' });
  else if (spins < 100) issues.push({ level: 'warn', msg: `⚠ Only ${spins} training spins — recommend 500+ for best accuracy` });
  else if (spins < 500) issues.push({ level: 'warn', msg: `🟡 ${spins} training spins — engine improving with more data` });
  else issues.push({ level: 'ok', msg: `✓ ${spins.toLocaleString()} training spins — engine fully calibrated` });

  if (sessions === 0) issues.push({ level: 'warn', msg: '⚠ No sessions yet — try the Upload tab' });
  if (users === 0) issues.push({ level: 'warn', msg: '⚠ No registered users yet — share the User app URL' });
  else issues.push({ level: 'ok', msg: `✓ ${users} registered user${users > 1 ? 's' : ''}` });

  $('healthList').innerHTML = issues.map(i =>
    `<div class="health-item ${i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : ''}">${i.msg}</div>`
  ).join('');
}

function buildOverviewActivity() {
  if (!$('recentActivity')) return;
  const items = [];
  Object.entries(allSessions).forEach(([id, s]) => {
    items.push({
      ts: s.uploadedAt || 0,
      label: '📦 Session uploaded',
      detail: `${s.label || 'Untitled'} · ${s.count || 0} spins`
    });
  });
  allLiveSpins.slice(0, 5).forEach(s => {
    items.push({
      ts: s.timestamp || 0,
      label: '⚡ Live spin',
      detail: `#${s.number ?? '?'} · ${s.even_odd || '·'} · ${s.color || '·'}`
    });
  });
  items.sort((a, b) => b.ts - a.ts);
  const recent = items.slice(0, 6);
  $('recentActivity').innerHTML = recent.length === 0
    ? '<div class="empty-hint">No activity yet — upload data or add live spins!</div>'
    : recent.map(i => `
      <div class="recent-item">
        <div><b>${i.label}</b><div class="meta">${escapeHTML(i.detail)}</div></div>
        <span class="meta">${timeAgo(i.ts)}</span>
      </div>`).join('');
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return Math.max(0, Math.floor(s)) + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ---------- NUMBER PADS (event delegation) ----------
function buildNumberPads() {
  const buildPad = (containerId, onTap) => {
    const c = $(containerId);
    if (!c || c._built) return;
    c._built = true;
    let html = '';
    for (let n = 1; n <= 36; n++) {
      const cls = RED_NUMBERS.has(n) ? 'red' : 'black';
      html += `<button type="button" class="num-btn ${cls}" data-n="${n}">${n}</button>`;
    }
    html += `<button type="button" class="num-btn green" data-n="0">0 (Zero)</button>`;
    c.innerHTML = html;
    c.addEventListener('click', e => {
      const b = e.target.closest('.num-btn');
      if (!b) return;
      const n = parseInt(b.dataset.n);
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 130);
      vibrate(10);
      onTap(n);
    });
  };
  buildPad('livePad', n => liveAdd(n));
  buildPad('uploadNumPad', n => {
    numBuffer.push(clean({
      number: n, even_odd: numEO(n), color: numColor(n), idx: numBuffer.length
    }));
    renderNumBufferT();
  });
}

// ---------- LIVE ENTRY ----------
async function liveAdd(n) {
  if (!auth.currentUser) return toast('Login required', 'error');
  const entry = clean({
    number: n,
    even_odd: numEO(n),
    color: numColor(n),
    table: $('liveTableTag').value.trim() || null,
    timestamp: Date.now(),
    by: auth.currentUser.email
  });
  try {
    await Promise.all([
      push(ref(db, 'live_spins'), entry),
      push(ref(db, 'history'), entry)
    ]);
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

$('liveUndoBtn').addEventListener('click', async () => {
  if (allLiveSpins.length === 0) return toast('Nothing to undo', 'warn');
  const last = allLiveSpins[0];
  try {
    await remove(ref(db, `live_spins/${last.id}`));
    toast('↶ Undone', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

$('liveClearTodayBtn').addEventListener('click', async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const todays = allLiveSpins.filter(s => (s.timestamp || 0) >= today.getTime());
  if (todays.length === 0) return toast('Nothing to clear today', 'warn');
  if (!confirm(`Delete all ${todays.length} of TODAY's live spins? (does not affect uploaded sessions)`)) return;
  const updates = {};
  todays.forEach(s => { updates[`live_spins/${s.id}`] = null; });
  try {
    await update(ref(db), updates);
    toast(`Cleared ${todays.length} entries`, 'success');
  } catch (e) { toast(e.message, 'error'); }
});

function _renderLiveFeed() {
  if (!$('liveFeed')) return;
  const recent = allLiveSpins.slice(0, 30);
  $('liveFeed').innerHTML = recent.length === 0
    ? '<div style="color:var(--text-dim);text-align:center;padding:24px;font-style:italic;font-size:13px">No spins yet — tap a number above to start! 🎰</div>'
    : recent.map(r => {
      const colorCls = r.color === 'R' ? 'red' : r.color === 'G' ? 'green' : 'black';
      const ts = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—';
      return `
        <div class="feed-item">
          <span><span class="feed-num ${colorCls}">${r.number ?? '?'}</span>
          ${r.even_odd || '·'} · ${r.color || '·'}${r.table ? ' · ' + escapeHTML(r.table) : ''}</span>
          <span style="color:var(--text-dim);font-size:11px">${ts}</span>
        </div>`;
    }).join('');

  const total = allLiveSpins.length;
  const counted = allLiveSpins.filter(r => r.even_odd === 'E' || r.even_odd === 'O');
  const evens = counted.filter(r => r.even_odd === 'E').length;
  const reds = allLiveSpins.filter(r => r.color === 'R').length;
  const colTot = allLiveSpins.filter(r => r.color === 'R' || r.color === 'B').length;
  $('liveTotal').textContent = total;
  $('liveEven').textContent = counted.length ? Math.round(evens/counted.length*100) + '%' : '0%';
  $('liveRed').textContent = colTot ? Math.round(reds/colTot*100) + '%' : '0%';
}

// ---------- UPLOAD: PARSERS ----------
const parseSeq = (input, valid) => (input || '').toUpperCase().replace(/[^A-Z]/g, '').split('').filter(c => valid.includes(c));

$('pasteUploadBtn').addEventListener('click', async () => {
  const eo = parseSeq($('pasteEvenOdd').value, ['E', 'O']);
  const col = parseSeq($('pasteColor').value, ['R', 'B']);
  const label = $('pasteLabel').value.trim() || `Session ${new Date().toLocaleString()}`;
  const table = $('pasteTable').value.trim() || null;
  const notes = $('pasteNotes').value.trim() || null;

  if (eo.length === 0 && col.length === 0) return toast('No valid data found', 'error');
  if (col.length > 0 && eo.length > 0 && eo.length !== col.length) {
    if (!confirm(`E/O has ${eo.length} entries, Color has ${col.length}. Continue with ${Math.max(eo.length, col.length)} entries (missing fields will be empty)?`)) return;
  }
  const len = Math.max(eo.length, col.length);
  const data = [];
  for (let i = 0; i < len; i++) {
    const row = { idx: i };
    if (eo[i]) row.even_odd = eo[i];
    if (col[i]) row.color = col[i];
    data.push(row);
  }
  await uploadSession({ label, table, notes, data });
  $('pasteEvenOdd').value = ''; $('pasteColor').value = ''; $('pasteLabel').value = '';
  $('pasteTable').value = ''; $('pasteNotes').value = '';
});

$('csvUploadBtn').addEventListener('click', async () => {
  const file = $('csvFile').files[0];
  const label = $('csvLabel').value.trim() || `CSV ${new Date().toLocaleString()}`;
  const table = $('csvTable').value.trim() || null;
  if (!file) return toast('Choose a CSV file', 'error');
  try {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(r => r.trim() && !r.toLowerCase().includes('even_odd'));
    const data = [];
    rows.forEach((row, i) => {
      const parts = row.split(/[,;\t]/).map(p => p.trim().toUpperCase());
      if (parts.length >= 1 && (parts[0] === 'E' || parts[0] === 'O')) {
        const r = { even_odd: parts[0], idx: i };
        if (parts[1] === 'R' || parts[1] === 'B') r.color = parts[1];
        data.push(r);
      } else if (parts.length >= 1) {
        const n = parseInt(parts[0]);
        if (!isNaN(n) && n >= 0 && n <= 36) {
          const r = clean({ number: n, color: numColor(n), idx: i, even_odd: numEO(n) });
          if (parts[1] === 'R' || parts[1] === 'B') r.color = parts[1];
          data.push(r);
        }
      }
    });
    if (data.length === 0) return toast('No valid rows found in CSV', 'error');
    await uploadSession({ label, table, data });
    $('csvFile').value = ''; $('csvLabel').value = ''; $('csvTable').value = '';
  } catch (e) { toast('CSV error: ' + e.message, 'error'); }
});

$('jsonUploadBtn').addEventListener('click', async () => {
  const file = $('jsonFile').files[0];
  const label = $('jsonLabel').value.trim() || `JSON ${new Date().toLocaleString()}`;
  const table = $('jsonTable').value.trim() || null;
  if (!file) return toast('Choose a JSON file', 'error');
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return toast('JSON must be an array', 'error');
    const data = arr.map((row, i) => {
      const r = { idx: i };
      const eo = (row.even_odd || row.eo || '').toString().toUpperCase();
      const c = (row.color || row.col || '').toString().toUpperCase();
      if (eo === 'E' || eo === 'O') r.even_odd = eo;
      if (c === 'R' || c === 'B' || c === 'G') r.color = c;
      if (typeof row.number === 'number') {
        r.number = row.number;
        if (!r.even_odd && row.number !== 0) r.even_odd = numEO(row.number);
        if (!r.color) r.color = numColor(row.number);
      }
      return r;
    }).filter(r => r.even_odd || r.color || r.number !== undefined);
    if (data.length === 0) return toast('No valid entries', 'error');
    await uploadSession({ label, table, data });
    $('jsonFile').value = ''; $('jsonLabel').value = ''; $('jsonTable').value = '';
  } catch (e) { toast('Invalid JSON: ' + e.message, 'error'); }
});

// QUICK ADD
const renderQuickBufferT = rafThrottle(renderQuickBuffer);
const renderNumBufferT = rafThrottle(renderNumBuffer);
$$('.qbtn').forEach(b => b.addEventListener('click', () => {
  quickBuffer.push({ even_odd: b.dataset.eo, color: b.dataset.color, idx: quickBuffer.length });
  renderQuickBufferT();
  vibrate(8);
}));
$('quickUndoBtn').addEventListener('click', () => { quickBuffer.pop(); renderQuickBufferT(); });
$('quickClearBtn').addEventListener('click', () => {
  if (quickBuffer.length === 0) return;
  if (!confirm(`Clear ${quickBuffer.length} buffered spins?`)) return;
  quickBuffer = []; renderQuickBufferT();
});
$('quickSaveBtn').addEventListener('click', async () => {
  if (quickBuffer.length === 0) return toast('Nothing to save', 'error');
  const label = $('quickLabel').value.trim() || `Quick ${new Date().toLocaleString()}`;
  await uploadSession({ label, data: [...quickBuffer] });
  quickBuffer = []; renderQuickBufferT();
  $('quickLabel').value = '';
});
function renderQuickBuffer() {
  $('quickCount').textContent = quickBuffer.length;
  $('quickRecent').innerHTML = quickBuffer.length === 0
    ? '<span style="color:var(--text-faint);font-size:11px;font-style:italic">Tap buttons above…</span>'
    : quickBuffer.slice(-50).map(r => `<span class="recent-chip ${r.even_odd}">${r.even_odd}/${r.color}</span>`).join('');
}

// NUMBERS
$('numUndoBtn').addEventListener('click', () => { numBuffer.pop(); renderNumBufferT(); });
$('numClearBtn').addEventListener('click', () => {
  if (numBuffer.length === 0) return;
  if (!confirm(`Clear ${numBuffer.length} buffered numbers?`)) return;
  numBuffer = []; renderNumBufferT();
});
$('numSaveBtn').addEventListener('click', async () => {
  if (numBuffer.length === 0) return toast('Nothing to save', 'error');
  const label = $('numLabel').value.trim() || `Numbers ${new Date().toLocaleString()}`;
  await uploadSession({ label, data: [...numBuffer] });
  numBuffer = []; renderNumBufferT();
  $('numLabel').value = '';
});
function renderNumBuffer() {
  $('numCount').textContent = numBuffer.length;
  $('numRecent').innerHTML = numBuffer.length === 0
    ? '<span style="color:var(--text-faint);font-size:11px;font-style:italic">Tap numbers above…</span>'
    : numBuffer.slice(-60).map(r => `<span class="recent-chip ${r.even_odd || ''}">${r.number}</span>`).join('');
}

// ---------- UPLOAD CORE ----------
async function uploadSession({ label, table, notes, data }) {
  if (!auth.currentUser) return toast('Login required', 'error');
  const total = data.length;
  $('uploadProgress').classList.remove('hidden');
  $('progressText').textContent = `Uploading 0 / ${total}...`;
  $('progressFill').style.width = '0%';
  try {
    const sessionRef = push(ref(db, 'sessions'));
    const cleanedData = data.map(r => clean(r));
    await set(sessionRef, deepClean({
      label, table: table || null, notes: notes || null,
      uploadedBy: auth.currentUser.email, uploadedAt: Date.now(),
      count: total, data: cleanedData
    }));
    const baseTs = Date.now();
    const CHUNK = 200; // bigger chunks = fewer round-trips
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = cleanedData.slice(i, i + CHUNK);
      const updates = {};
      chunk.forEach((row, j) => {
        const k = push(ref(db, 'history')).key;
        updates[`history/${k}`] = clean({
          ...row, sessionId: sessionRef.key, table: table || null,
          timestamp: baseTs + i + j
        });
      });
      await update(ref(db), updates);
      const done = Math.min(i + CHUNK, total);
      $('progressText').textContent = `Uploading ${done} / ${total}...`;
      $('progressFill').style.width = (done / total * 100) + '%';
    }
    $('progressText').textContent = `✓ Done — ${total} entries uploaded! 🎉`;
    setTimeout(() => $('uploadProgress').classList.add('hidden'), 1500);
    toast(`✓ Uploaded ${total} entries`, 'success');
  } catch (e) {
    $('uploadProgress').classList.add('hidden');
    toast('Upload failed: ' + e.message, 'error');
  }
}

// ---------- DATA TAB ----------
$('searchData').addEventListener('input', debounce(_renderData, 180));
$('sortData').addEventListener('change', _renderData);
$('exportAllBtn').addEventListener('click', exportAll);
$('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('⚠ Delete ALL sessions, history & live spins? This cannot be undone.')) return;
  if (!confirm('REALLY sure? Click OK only if yes.')) return;
  try {
    await Promise.all([
      remove(ref(db, 'sessions')),
      remove(ref(db, 'history')),
      remove(ref(db, 'live_spins'))
    ]);
    toast('All data cleared', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

function _renderData() {
  if (!$('searchData')) return;
  const filter = ($('searchData').value || '').toLowerCase();
  const sortBy = $('sortData').value;
  let sessions = Object.entries(allSessions).map(([id, s]) => ({ id, ...s }))
    .filter(s => !filter ||
      (s.label || '').toLowerCase().includes(filter) ||
      (s.table || '').toLowerCase().includes(filter) ||
      (s.notes || '').toLowerCase().includes(filter)
    );
  if (sortBy === 'newest') sessions.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  if (sortBy === 'oldest') sessions.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
  if (sortBy === 'largest') sessions.sort((a, b) => (b.count || 0) - (a.count || 0));
  if (sortBy === 'smallest') sessions.sort((a, b) => (a.count || 0) - (b.count || 0));

  const total = sessions.length;
  // Cap visible items to keep DOM size small
  sessions = sessions.slice(0, SESSIONS_RENDER_CAP);

  if (total === 0) {
    $('dataList').innerHTML = '<div class="empty-hint">No sessions yet. Upload data in the Upload tab! 📥</div>';
    return;
  }
  $('dataList').innerHTML = sessions.map(s => {
    const preview = (s.data || []).slice(0, 60).map(r => `${r.even_odd || '·'}${r.color ? '/' + r.color : ''}`).join(' ');
    const ts = s.uploadedAt ? new Date(s.uploadedAt).toLocaleString() : '—';
    return `
      <div class="data-item" data-id="${s.id}">
        <div class="data-item-head">
          <span class="data-label">${escapeHTML(s.label || 'Untitled')}</span>
          <span class="data-tag">${s.count || 0} spins</span>
        </div>
        ${s.table ? `<div class="data-meta">🎲 Table: <b>${escapeHTML(s.table)}</b></div>` : ''}
        <div class="data-meta">${ts} · ${escapeHTML(s.uploadedBy || '')}</div>
        ${s.notes ? `<div class="data-meta">📝 ${escapeHTML(s.notes)}</div>` : ''}
        <div class="data-preview">${escapeHTML(preview) || '<em style="color:var(--text-faint)">no preview</em>'}${(s.count || 0) > 60 ? ' …' : ''}</div>
        <div class="data-actions">
          <button class="btn btn-ghost" data-act="view" type="button">👁 View</button>
          <button class="btn btn-ghost" data-act="export" type="button">⤓ Export</button>
          <button class="btn btn-danger" data-act="delete" type="button">🗑 Delete</button>
        </div>
      </div>`;
  }).join('') + (total > SESSIONS_RENDER_CAP ? `<div class="empty-hint">Showing first ${SESSIONS_RENDER_CAP} of ${total} sessions — refine search to see more.</div>` : '');
}

// EVENT DELEGATION on dataList — replaces per-button binding (huge perf win)
$('dataList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const item = btn.closest('.data-item');
  const id = item?.dataset.id;
  const s = id && allSessions[id];
  if (!s) return;
  const act = btn.dataset.act;

  if (act === 'delete') {
    if (!confirm(`Delete session "${s.label || 'Untitled'}" and its ${s.count || 0} history entries?`)) return;
    try {
      await remove(ref(db, `sessions/${id}`));
      const updates = {};
      Object.entries(allHistory).forEach(([k, v]) => {
        if (v.sessionId === id) updates[`history/${k}`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
      toast('Deleted', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  if (act === 'export') {
    downloadJSON(s, `${(s.label || 'session').replace(/[^a-z0-9_-]/gi, '_')}.json`);
  }
  if (act === 'view') {
    const seq = (s.data || []).map(r => `${r.even_odd || '·'}/${r.color || '·'}`).join(' ');
    alert(`${s.label || 'Untitled'}\n\nFull sequence (${s.count || 0} entries):\n\n${seq || '(empty)'}`);
  }
});

function exportAll() {
  if (Object.keys(allSessions).length === 0 && Object.keys(allUsers).length === 0) {
    return toast('Nothing to export', 'error');
  }
  downloadJSON({
    sessions: allSessions, users: allUsers, exportedAt: Date.now()
  }, `roulette_export_${Date.now()}.json`);
  toast('✓ Export ready', 'success');
}
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- STATS ----------
let _statsKey = '';
function _renderStats() {
  if (!$('totalSpins')) return;
  // Build aggregated dataset only when needed
  const all = [];
  Object.values(allSessions).forEach(s => { if (Array.isArray(s.data)) all.push(...s.data); });
  allLiveSpins.forEach(s => all.push(s));

  // Memo key based on size + last live spin
  const key = `${all.length}|${allLiveSpins[0]?.id || ''}`;
  if (key === _statsKey) return;
  _statsKey = key;

  $('totalSpins').textContent = all.length.toLocaleString();
  if (all.length === 0) {
    $('detailEO').textContent = 'No data';
    $('detailRB').textContent = 'No data';
    $('longestStreak').textContent = '—';
    $('barEven').style.width = '0%';
    $('barOdd').style.width = '0%';
    $('barRed').style.width = '0%';
    $('barBlack').style.width = '0%';
    drawHeatmap([]); drawNumberFreq([]);
    return;
  }
  const eos = all.filter(r => r.even_odd === 'E' || r.even_odd === 'O');
  const evens = eos.filter(r => r.even_odd === 'E').length;
  const odds = eos.length - evens;
  const cols = all.filter(r => r.color === 'R' || r.color === 'B');
  const reds = cols.filter(r => r.color === 'R').length;
  const blacks = cols.length - reds;

  if (eos.length > 0) {
    const ePct = (evens / eos.length * 100).toFixed(1);
    const oPct = (odds / eos.length * 100).toFixed(1);
    $('barEven').style.width = ePct + '%';
    $('barOdd').style.width = oPct + '%';
    $('detailEO').textContent = `Even ${evens} (${ePct}%) · Odd ${odds} (${oPct}%) · ${eos.length} samples`;
  } else {
    $('barEven').style.width = '0%';
    $('barOdd').style.width = '0%';
    $('detailEO').textContent = 'No E/O data';
  }
  if (cols.length > 0) {
    const rPct = (reds / cols.length * 100).toFixed(1);
    const bPct = (blacks / cols.length * 100).toFixed(1);
    $('barRed').style.width = rPct + '%';
    $('barBlack').style.width = bPct + '%';
    $('detailRB').textContent = `Red ${reds} (${rPct}%) · Black ${blacks} (${bPct}%) · ${cols.length} samples`;
  } else {
    $('barRed').style.width = '0%';
    $('barBlack').style.width = '0%';
    $('detailRB').textContent = 'No R/B data';
  }
  let longest = eos.length > 0 ? 1 : 0;
  let cur = 1, longestVal = eos[0]?.even_odd;
  for (let i = 1; i < eos.length; i++) {
    if (eos[i].even_odd === eos[i - 1].even_odd) {
      cur++;
      if (cur > longest) { longest = cur; longestVal = eos[i].even_odd; }
    } else cur = 1;
  }
  $('longestStreak').textContent = longestVal ? `${longest}× ${longestVal}` : '—';

  drawHeatmap(all.slice(-100));
  drawNumberFreq(all);
}

function drawHeatmap(data) {
  const canvas = $('heatmap');
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap dpr
  const cssW = canvas.clientWidth || 640;
  const cssH = 80;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (data.length === 0) return;
  const cellW = cssW / data.length;
  data.forEach((d, i) => {
    if (d.even_odd === 'E') ctx.fillStyle = '#a78bfa';
    else if (d.even_odd === 'O') ctx.fillStyle = '#fbbf24';
    else ctx.fillStyle = '#1c1233';
    ctx.fillRect(i * cellW, 0, cellW + 0.5, cssH / 2);
    if (d.color === 'R') ctx.fillStyle = '#ef4444';
    else if (d.color === 'B') ctx.fillStyle = '#1e293b';
    else if (d.color === 'G') ctx.fillStyle = '#10b981';
    else ctx.fillStyle = '#1c1233';
    ctx.fillRect(i * cellW, cssH / 2, cellW + 0.5, cssH / 2);
  });
}
function drawNumberFreq(data) {
  const canvas = $('numFreq');
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  const cssH = 120;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const counts = new Array(37).fill(0);
  data.forEach(d => {
    if (typeof d.number === 'number' && d.number >= 0 && d.number <= 36) counts[d.number]++;
  });
  const max = Math.max(...counts, 1);
  const barW = cssW / 37;
  ctx.font = '9px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 36; i++) {
    const barH = (counts[i] / max) * (cssH - 22);
    ctx.fillStyle = i === 0 ? '#10b981' : (RED_NUMBERS.has(i) ? '#ef4444' : '#475569');
    ctx.fillRect(i * barW + 1, cssH - barH - 18, barW - 2, barH);
    ctx.fillStyle = '#a3aabb';
    ctx.fillText(i, i * barW + barW / 2, cssH - 4);
  }
}

// ---------- USERS ----------
$('searchUsers').addEventListener('input', debounce(_renderUsers, 180));
$('sortUsers').addEventListener('change', _renderUsers);
function _renderUsers() {
  if (!$('searchUsers')) return;
  const filter = ($('searchUsers').value || '').toLowerCase();
  const sortBy = $('sortUsers').value;
  let list = Object.entries(allUsers).map(([uid, u]) => ({ uid, ...u }))
    .filter(u => !filter || (u.email || '').toLowerCase().includes(filter));
  if (sortBy === 'recent') list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  if (sortBy === 'active') list.sort((a, b) => (b.predictionCount || 0) - (a.predictionCount || 0));
  if (sortBy === 'accurate') list.sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0));

  const total = list.length;
  list = list.slice(0, USERS_RENDER_CAP);

  if (total === 0) {
    $('userList').innerHTML = '<div class="empty-hint">No registered users yet. Share the User app URL! 🚀</div>';
    return;
  }
  $('userList').innerHTML = list.map(u => {
    const acc = (typeof u.accuracy === 'number') ? u.accuracy.toFixed(1) : null;
    const accCls = acc !== null ? (parseFloat(acc) >= 50 ? '' : parseFloat(acc) >= 35 ? 'low' : 'bad') : 'bad';
    return `
      <div class="user-item">
        <div class="user-info">
          <div class="user-email">${escapeHTML(u.email || u.uid)}</div>
          <div class="user-stats">${u.predictionCount || 0} predictions · last active ${timeAgo(u.lastActive)}</div>
        </div>
        <div class="user-acc ${accCls}">${acc !== null ? acc + '%' : '—'}</div>
      </div>`;
  }).join('') + (total > USERS_RENDER_CAP ? `<div class="empty-hint">Showing first ${USERS_RENDER_CAP} of ${total} users.</div>` : '');
}

// ---------- TEST AI ----------
$$('[data-testmode]').forEach(b => {
  b.addEventListener('click', () => {
    $$('[data-testmode]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    testMode = b.dataset.testmode;
    testSeq = [];
    renderTestSeq();
    $('testEoBtns').classList.toggle('hidden', testMode === 'color');
    $('testColorBtns').classList.toggle('hidden', testMode === 'even_odd');
    $('testResult').classList.add('hidden');
  });
});
$$('[data-test]').forEach(b => b.addEventListener('click', () => {
  testSeq.push(b.dataset.test);
  if (testSeq.length > 50) testSeq.shift();
  renderTestSeq();
  vibrate(8);
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 130);
}));
$('testUndoBtn').addEventListener('click', () => { testSeq.pop(); renderTestSeq(); });
$('testClearBtn').addEventListener('click', () => {
  testSeq = []; renderTestSeq();
  $('testResult').classList.add('hidden');
});
$('testRunBtn').addEventListener('click', () => {
  if (testSeq.length < 5) return toast('Need at least 5 entries', 'error');
  try { showTestResult(testEngine.predict(testSeq, testMode)); }
  catch (e) { toast('Prediction error: ' + e.message, 'error'); }
});
function renderTestSeq() {
  $('testSeq').innerHTML = testSeq.map(c => `<div class="seq-chip ${c}">${c}</div>`).join('');
}
function showTestResult(r) {
  const card = $('testResult');
  card.classList.remove('hidden');
  const labelMap = { E: 'EVEN', O: 'ODD', R: 'RED', B: 'BLACK' };
  const modelNames = {
    markov: 'Markov Chain', pattern: 'Pattern Match', streak: 'Streak Break',
    bayesian: 'Bayesian', cyclic: 'Cyclic Detect', recency: 'Recency',
    bias: 'Wheel Bias', sector: 'Sector Heat', neural: 'Neural'
  };
  const models = Object.entries(r.models || {}).map(([k, p]) => {
    if (!p || Object.keys(p).length === 0) return '';
    const w = Object.keys(p).reduce((a, b) => p[a] > p[b] ? a : b);
    return `<div class="model-row"><span>${modelNames[k] || k}</span><b>${w} · ${(p[w] * 100).toFixed(1)}%</b></div>`;
  }).join('');
  card.innerHTML = `
    <div style="font-size:11px;color:var(--text-dim);letter-spacing:1.8px;text-transform:uppercase;font-weight:800;margin-bottom:6px">✨ AI Says</div>
    <div class="pred-value">${r.prediction || '?'}</div>
    <div style="font-size:14px;color:var(--text);font-weight:800;letter-spacing:3px;margin:8px 0">${labelMap[r.prediction] || ''}</div>
    <div class="pred-conf">${r.confidence}% confidence · ${r.agreement}% model agreement</div>
    <div style="margin-top:18px;text-align:left">${models}</div>
    <div style="font-size:11px;color:var(--text-dim);margin-top:14px;font-weight:600">Trained on ${(r.sampleSize || 0).toLocaleString()} historical spins</div>
  `;
  requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

// ---------- BACKUP ----------
$('backupBtn').addEventListener('click', async () => {
  toast('Generating backup...', 'warn');
  try {
    const [s, u, h, l, p, a] = await Promise.all([
      get(ref(db, 'sessions')),
      get(ref(db, 'users')),
      get(ref(db, 'history')),
      get(ref(db, 'live_spins')),
      get(ref(db, 'userPredictions')),
      get(ref(db, 'admins'))
    ]);
    const backup = {
      sessions: s.val() || {}, users: u.val() || {}, history: h.val() || {},
      live_spins: l.val() || {}, userPredictions: p.val() || {}, admins: a.val() || {},
      version: '3.2', exportedAt: Date.now()
    };
    const sizeKB = (JSON.stringify(backup).length / 1024).toFixed(1);
    downloadJSON(backup, `roulette_backup_${new Date().toISOString().split('T')[0]}.json`);
    $('backupInfo').textContent = `✓ Backup of ${sizeKB} KB downloaded`;
    toast('✓ Backup downloaded', 'success');
  } catch (e) { toast('Backup failed: ' + e.message, 'error'); }
});

$('restoreBtn').addEventListener('click', async () => {
  const file = $('restoreFile').files[0];
  if (!file) return toast('Choose a backup file', 'error');
  if (!confirm('Restore from this backup? It will MERGE with existing data.')) return;
  try {
    const text = await file.text();
    const b = JSON.parse(text);
    const updates = {};
    let count = 0;
    ['sessions','users','history','live_spins','userPredictions'].forEach(k => {
      if (b[k] && typeof b[k] === 'object') {
        Object.entries(b[k]).forEach(([id, val]) => {
          updates[`${k}/${id}`] = val;
          count++;
        });
      }
    });
    if (count === 0) {
      $('restoreInfo').textContent = 'No restorable data found in file';
      $('restoreInfo').className = 'msg error';
      return;
    }
    await update(ref(db), updates);
    $('restoreInfo').textContent = `✓ Restored ${count} records`;
    $('restoreInfo').className = 'msg success';
    $('restoreFile').value = '';
    toast('✓ Restore complete', 'success');
  } catch (e) {
    $('restoreInfo').textContent = 'Failed: ' + e.message;
    $('restoreInfo').className = 'msg error';
  }
});

$('wipeConfirm').addEventListener('input', e => {
  $('wipeBtn').disabled = e.target.value.trim() !== 'WIPE';
});
$('wipeBtn').addEventListener('click', async () => {
  if (!confirm('FINAL CONFIRMATION: wipe entire database?')) return;
  if (!confirm('Are you ABSOLUTELY sure? This deletes EVERYTHING.')) return;
  try {
    await Promise.all([
      remove(ref(db, 'sessions')),
      remove(ref(db, 'history')),
      remove(ref(db, 'live_spins')),
      remove(ref(db, 'userPredictions'))
    ]);
    // Clear local cache too
    Object.values(CACHE).forEach(c => localStorage.removeItem(c));
    $('wipeConfirm').value = '';
    $('wipeBtn').disabled = true;
    toast('Database wiped', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

// ---------- HELP MODAL ----------
$('helpBtn').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
$('helpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden'); });

// ---------- KEYBOARD SHORTCUTS ----------
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') $('helpModal').classList.add('hidden');
  if (activeTab !== 'test') return;
  const k = e.key.toUpperCase();
  if ((testMode === 'even_odd' && (k === 'E' || k === 'O')) ||
      (testMode === 'color' && (k === 'R' || k === 'B'))) {
    testSeq.push(k); renderTestSeq();
  }
  if (e.key === 'Backspace') { testSeq.pop(); renderTestSeq(); }
  if (e.key === 'Enter') $('testRunBtn').click();
});

document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

// ---------- HELPERS ----------
function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Re-render canvases on resize (debounced)
window.addEventListener('resize', debounce(() => {
  if (activeTab === 'stats') {
    // Force re-draw without memo
    _statsKey = '';
    _renderStats();
  }
}, 220));
