// ============================================================================
// ROULETTE ADMIN APP — v2.0
// Self-contained admin web app: upload, live entry, stats, users, AI test, backup
// ============================================================================
import {
  db, auth, ref, set, push, get, onValue, update, remove,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from './firebase-config.js';
import { PredictionEngine } from './prediction-engine.js';

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const numColor = n => n === 0 ? 'G' : (RED_NUMBERS.has(n) ? 'R' : 'B');
const numEO    = n => n === 0 ? null : (n % 2 === 0 ? 'E' : 'O');

// ---------- Toast ----------
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2800);
}

function showLoginMsg(msg, type) {
  const m = $('loginMsg');
  m.textContent = msg;
  m.className = 'msg ' + type;
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
    showLoginMsg('✓ Admin account created!', 'success');
  } catch (e) { showLoginMsg(prettyAuthErr(e), 'error'); }
});

$('forgotBtn').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return showLoginMsg('Enter your email first', 'error');
  try {
    await sendPasswordResetEmail(auth, email);
    showLoginMsg('✓ Password reset email sent', 'success');
  } catch (e) { showLoginMsg(prettyAuthErr(e), 'error'); }
});

$('logoutBtn').addEventListener('click', () => signOut(auth));

function prettyAuthErr(e) {
  const m = (e.code || e.message || '').toString();
  if (m.includes('user-not-found')) return 'No account with this email';
  if (m.includes('wrong-password')) return 'Wrong password';
  if (m.includes('invalid-email')) return 'Invalid email format';
  if (m.includes('email-already')) return 'Email already in use';
  if (m.includes('weak-password')) return 'Password too weak (6+ chars)';
  if (m.includes('network')) return 'Network error — check connection';
  return e.message || 'Something went wrong';
}

onAuthStateChanged(auth, user => {
  if (user) {
    $('loginScreen').classList.remove('active');
    $('dashboard').classList.add('active');
    $('adminChip').textContent = '⚙ ' + user.email.split('@')[0];
    $('welcomeName').textContent = ', ' + user.email.split('@')[0];
    initDashboard();
  } else {
    $('dashboard').classList.remove('active');
    $('loginScreen').classList.add('active');
  }
});

// ---------- TABS ----------
$$('.tab').forEach(t => t.addEventListener('click', () => goTab(t.dataset.tab)));
$$('[data-go-tab]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.goTab)));

function goTab(name) {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.tab-panel').forEach(x => x.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');
  document.querySelector(`[data-panel="${name}"]`)?.classList.add('active');
  if (name === 'stats') renderStats();
  if (name === 'overview') renderOverview();
}

// Mode buttons (upload tab)
$$('.mode-btn').forEach(b => b.addEventListener('click', () => {
  $$('.mode-btn').forEach(x => x.classList.remove('active'));
  $$('.mode-content').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelector(`[data-content="${b.dataset.mode}"]`).classList.add('active');
}));

// ---------- DATA STATE ----------
let allSessions = {};
let allUsers = {};
let allHistory = {};
let allLiveSpins = [];
let quickBuffer = [];
let numBuffer = [];
let testEngine = new PredictionEngine();
let testSeq = [];
let testMode = 'even_odd';

function initDashboard() {
  onValue(ref(db, 'sessions'), snap => {
    allSessions = snap.val() || {};
    renderData();
    renderOverview();
    renderStats();
  });

  onValue(ref(db, 'users'), snap => {
    allUsers = snap.val() || {};
    renderUsers();
    renderOverview();
  });

  onValue(ref(db, 'history'), snap => {
    allHistory = snap.val() || {};
    testEngine.setHistory(Object.values(allHistory).filter(r => r.even_odd === 'E' || r.even_odd === 'O'));
    renderStats();
    renderOverview();
  });

  onValue(ref(db, 'live_spins'), snap => {
    const data = snap.val() || {};
    allLiveSpins = Object.entries(data).map(([k, v]) => ({ id: k, ...v }))
      .sort((a, b) => b.timestamp - a.timestamp);
    renderLiveFeed();
    renderOverview();
  });

  buildNumberPads();
  buildOverviewActivity();
}

// ---------- OVERVIEW ----------
function renderOverview() {
  const sessionCount = Object.keys(allSessions).length;
  const userCount = Object.keys(allUsers).length;
  let totalSpins = 0;
  Object.values(allSessions).forEach(s => totalSpins += (s.count || (s.data?.length || 0)));
  if (totalSpins === 0) totalSpins = Object.keys(allHistory).length;

  const today = new Date(); today.setHours(0,0,0,0);
  const todaySpins = allLiveSpins.filter(s => (s.timestamp || 0) >= today.getTime()).length;

  let totalPreds = 0, totalCorrect = 0;
  Object.values(allUsers).forEach(u => {
    totalPreds += u.predictionCount || 0;
    totalCorrect += u.correctCount || 0;
  });
  const accuracy = totalPreds > 0 ? (totalCorrect / totalPreds * 100).toFixed(1) + '%' : '—';

  $('ovTotalSpins').textContent = totalSpins.toLocaleString();
  $('ovSessions').textContent = sessionCount;
  $('ovUsers').textContent = userCount;
  $('ovPreds').textContent = totalPreds;
  $('ovAccuracy').textContent = accuracy;
  $('ovLive').textContent = todaySpins;

  renderHealth(totalSpins, sessionCount, userCount);
  buildOverviewActivity();
}

function renderHealth(spins, sessions, users) {
  const issues = [];
  if (spins === 0) issues.push({ level: 'bad', msg: 'No training data uploaded yet — user predictions will fail' });
  else if (spins < 100) issues.push({ level: 'warn', msg: `Only ${spins} training spins — recommend 500+ for good accuracy` });
  else issues.push({ level: 'ok', msg: `✓ ${spins} training spins — engine is ready` });

  if (sessions === 0) issues.push({ level: 'warn', msg: 'No sessions yet — try the Upload tab' });
  if (users === 0) issues.push({ level: 'warn', msg: 'No registered users yet — share the User app URL' });
  else issues.push({ level: 'ok', msg: `✓ ${users} registered user${users>1?'s':''}` });

  $('healthList').innerHTML = issues.map(i =>
    `<div class="health-item ${i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : ''}">${i.msg}</div>`
  ).join('');
}

function buildOverviewActivity() {
  const items = [];
  Object.entries(allSessions).slice(-5).reverse().forEach(([id, s]) => {
    items.push({
      ts: s.uploadedAt || 0,
      label: '📦 Session uploaded',
      detail: `${s.label || 'Untitled'} · ${s.count || 0} spins`
    });
  });
  allLiveSpins.slice(0, 3).forEach(s => {
    items.push({
      ts: s.timestamp,
      label: '⚡ Live spin',
      detail: `#${s.number ?? '?'} · ${s.even_odd || '?'} · ${s.color || '?'}`
    });
  });
  items.sort((a, b) => b.ts - a.ts);
  const recent = items.slice(0, 6);
  $('recentActivity').innerHTML = recent.length === 0
    ? '<div class="empty-hint">No activity yet</div>'
    : recent.map(i => `
      <div class="recent-item">
        <div><b>${i.label}</b><div class="meta">${i.detail}</div></div>
        <span class="meta">${timeAgo(i.ts)}</span>
      </div>
    `).join('');
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ---------- NUMBER PADS ----------
function buildNumberPads() {
  const buildPad = (containerId, onTap) => {
    const c = $(containerId);
    if (!c) return;
    if (c._built) return;
    c._built = true;
    let html = '';
    // First row: 1-36 in roulette layout
    for (let n = 1; n <= 36; n++) {
      const cls = RED_NUMBERS.has(n) ? 'red' : 'black';
      html += `<button class="num-btn ${cls}" data-n="${n}">${n}</button>`;
    }
    html += `<button class="num-btn green" data-n="0">0 (Zero)</button>`;
    c.innerHTML = html;
    c.querySelectorAll('.num-btn').forEach(b => {
      b.addEventListener('click', () => {
        const n = parseInt(b.dataset.n);
        b.style.transform = 'scale(0.7)';
        setTimeout(() => b.style.transform = '', 150);
        navigator.vibrate && navigator.vibrate(15);
        onTap(n);
      });
    });
  };
  buildPad('livePad', n => liveAdd(n));
  buildPad('uploadNumPad', n => {
    numBuffer.push({
      number: n,
      even_odd: numEO(n),
      color: numColor(n),
      idx: numBuffer.length
    });
    renderNumBuffer();
  });
}

// ---------- LIVE ENTRY ----------
async function liveAdd(n) {
  if (!auth.currentUser) return toast('Login required', 'error');
  const entry = {
    number: n,
    even_odd: numEO(n),
    color: numColor(n),
    table: $('liveTableTag').value.trim() || null,
    timestamp: Date.now(),
    by: auth.currentUser.email
  };
  // strip null even_odd for 0 (zero is special)
  if (entry.even_odd === null) delete entry.even_odd;
  try {
    await push(ref(db, 'live_spins'), entry);
    await push(ref(db, 'history'), entry);
  } catch (e) { toast(e.message, 'error'); }
}

$('liveUndoBtn').addEventListener('click', async () => {
  if (allLiveSpins.length === 0) return;
  const last = allLiveSpins[0];
  await remove(ref(db, `live_spins/${last.id}`));
  toast('↶ Undone', 'success');
});

$('liveClearTodayBtn').addEventListener('click', async () => {
  if (!confirm('Delete all of TODAY\'s live spins? (does not affect uploaded sessions)')) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const updates = {};
  allLiveSpins.forEach(s => { if ((s.timestamp || 0) >= today.getTime()) updates[`live_spins/${s.id}`] = null; });
  if (Object.keys(updates).length) await update(ref(db), updates);
  toast(`Cleared ${Object.keys(updates).length} entries`, 'success');
});

function renderLiveFeed() {
  const recent = allLiveSpins.slice(0, 30);
  $('liveFeed').innerHTML = recent.length === 0
    ? '<div style="color:var(--text-dim);text-align:center;padding:20px;font-style:italic">No spins yet — tap a number above to start</div>'
    : recent.map(r => {
      const colorCls = r.color === 'R' ? 'red' : r.color === 'G' ? 'green' : 'black';
      return `
        <div class="feed-item">
          <span><span class="feed-num ${colorCls}">${r.number ?? '?'}</span>
          ${r.even_odd || '·'} · ${r.color || '·'}${r.table ? ' · '+escapeHTML(r.table) : ''}</span>
          <span style="color:var(--text-dim);font-size:11px">${new Date(r.timestamp).toLocaleTimeString()}</span>
        </div>
      `;
    }).join('');

  const total = allLiveSpins.length;
  const counted = allLiveSpins.filter(r => r.even_odd);
  const evens = counted.filter(r => r.even_odd === 'E').length;
  const reds = allLiveSpins.filter(r => r.color === 'R').length;
  const colTot = allLiveSpins.filter(r => r.color === 'R' || r.color === 'B').length;
  $('liveTotal').textContent = total;
  $('liveEven').textContent = counted.length ? Math.round(evens/counted.length*100) + '%' : '0%';
  $('liveRed').textContent = colTot ? Math.round(reds/colTot*100) + '%' : '0%';
}

// ---------- UPLOAD: PARSERS ----------
const parseSeq = (input, valid) => input.toUpperCase().replace(/[^A-Z]/g, '').split('').filter(c => valid.includes(c));

// PASTE upload — fixed: don't fake colors
$('pasteUploadBtn').addEventListener('click', async () => {
  const eo = parseSeq($('pasteEvenOdd').value, ['E', 'O']);
  const col = parseSeq($('pasteColor').value, ['R', 'B']);
  const label = $('pasteLabel').value.trim() || `Session ${new Date().toLocaleString()}`;
  const table = $('pasteTable').value.trim() || null;
  const notes = $('pasteNotes').value.trim() || null;

  if (eo.length === 0 && col.length === 0) return toast('No valid data found', 'error');
  if (col.length > 0 && eo.length > 0 && eo.length !== col.length) {
    if (!confirm(`E/O has ${eo.length} entries, Color has ${col.length}. Continue with min length (${Math.min(eo.length, col.length)})?`)) return;
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

// CSV upload
$('csvUploadBtn').addEventListener('click', async () => {
  const file = $('csvFile').files[0];
  const label = $('csvLabel').value.trim() || `CSV ${new Date().toLocaleString()}`;
  const table = $('csvTable').value.trim() || null;
  if (!file) return toast('Choose a CSV file', 'error');

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
        const r = { number: n, color: numColor(n), idx: i };
        if (n !== 0) r.even_odd = numEO(n);
        data.push(r);
      }
    }
  });

  if (data.length === 0) return toast('No valid rows found in CSV', 'error');
  await uploadSession({ label, table, data });
  $('csvFile').value = ''; $('csvLabel').value = ''; $('csvTable').value = '';
});

// JSON upload
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
      const eo = (row.even_odd || row.eo || '').toUpperCase();
      const c = (row.color || row.col || '').toUpperCase();
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

// QUICK ADD (manual)
$$('.qbtn').forEach(b => b.addEventListener('click', () => {
  quickBuffer.push({ even_odd: b.dataset.eo, color: b.dataset.color, idx: quickBuffer.length });
  renderQuickBuffer();
  navigator.vibrate && navigator.vibrate(10);
}));
$('quickUndoBtn').addEventListener('click', () => { quickBuffer.pop(); renderQuickBuffer(); });
$('quickClearBtn').addEventListener('click', () => { quickBuffer = []; renderQuickBuffer(); });
$('quickSaveBtn').addEventListener('click', async () => {
  if (quickBuffer.length === 0) return toast('Nothing to save', 'error');
  const label = $('quickLabel').value.trim() || `Quick ${new Date().toLocaleString()}`;
  await uploadSession({ label, data: [...quickBuffer] });
  quickBuffer = []; renderQuickBuffer();
  $('quickLabel').value = '';
});
function renderQuickBuffer() {
  $('quickCount').textContent = quickBuffer.length;
  $('quickRecent').innerHTML = quickBuffer.length === 0
    ? '<span style="color:var(--text-dim);font-size:11px;font-style:italic">Tap buttons above…</span>'
    : quickBuffer.slice(-50).map(r => `<span class="recent-chip ${r.even_odd}">${r.even_odd}/${r.color}</span>`).join('');
}

// NUMBERS upload
$('numUndoBtn').addEventListener('click', () => { numBuffer.pop(); renderNumBuffer(); });
$('numClearBtn').addEventListener('click', () => { numBuffer = []; renderNumBuffer(); });
$('numSaveBtn').addEventListener('click', async () => {
  if (numBuffer.length === 0) return toast('Nothing to save', 'error');
  const label = $('numLabel').value.trim() || `Numbers ${new Date().toLocaleString()}`;
  await uploadSession({ label, data: [...numBuffer] });
  numBuffer = []; renderNumBuffer();
  $('numLabel').value = '';
});
function renderNumBuffer() {
  $('numCount').textContent = numBuffer.length;
  $('numRecent').innerHTML = numBuffer.length === 0
    ? '<span style="color:var(--text-dim);font-size:11px;font-style:italic">Tap numbers above…</span>'
    : numBuffer.slice(-60).map(r => `<span class="recent-chip ${r.even_odd || ''}">${r.number}</span>`).join('');
}

// ---------- UPLOAD CORE (with progress) ----------
async function uploadSession({ label, table, notes, data }) {
  if (!auth.currentUser) return toast('Login required', 'error');
  const total = data.length;
  $('uploadProgress').classList.remove('hidden');
  $('progressText').textContent = `Uploading 0 / ${total}...`;
  $('progressFill').style.width = '0%';
  try {
    const sessionRef = push(ref(db, 'sessions'));
    await set(sessionRef, {
      label,
      table: table || null,
      notes: notes || null,
      uploadedBy: auth.currentUser.email,
      uploadedAt: Date.now(),
      count: total,
      data
    });
    // chunked history writes
    const baseTs = Date.now();
    const CHUNK = 100;
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      const updates = {};
      chunk.forEach((row, j) => {
        const k = push(ref(db, 'history')).key;
        updates[`history/${k}`] = { ...row, sessionId: sessionRef.key, table: table || null, timestamp: baseTs + i + j };
      });
      await update(ref(db), updates);
      const done = Math.min(i + CHUNK, total);
      $('progressText').textContent = `Uploading ${done} / ${total}...`;
      $('progressFill').style.width = (done / total * 100) + '%';
    }
    $('progressText').textContent = `✓ Done — ${total} entries`;
    setTimeout(() => $('uploadProgress').classList.add('hidden'), 1200);
    toast(`✓ Uploaded ${total} entries`, 'success');
  } catch (e) {
    $('uploadProgress').classList.add('hidden');
    toast('Upload failed: ' + e.message, 'error');
  }
}

// ---------- DATA TAB ----------
$('searchData').addEventListener('input', renderData);
$('sortData').addEventListener('change', renderData);
$('exportAllBtn').addEventListener('click', exportAll);
$('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('⚠ Delete ALL sessions, history & live spins? This cannot be undone.')) return;
  if (!confirm('REALLY sure? Type OK only if yes.')) return;
  await remove(ref(db, 'sessions'));
  await remove(ref(db, 'history'));
  await remove(ref(db, 'live_spins'));
  toast('All data cleared', 'success');
});

function renderData() {
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

  if (sessions.length === 0) {
    $('dataList').innerHTML = '<div class="empty-hint">No sessions yet. Upload data in the Upload tab.</div>';
    return;
  }
  $('dataList').innerHTML = sessions.map(s => {
    const preview = (s.data || []).slice(0, 60).map(r => `${r.even_odd || '·'}${r.color ? '/'+r.color : ''}`).join(' ');
    return `
      <div class="data-item">
        <div class="data-item-head">
          <span class="data-label">${escapeHTML(s.label)}</span>
          <span class="data-tag">${s.count || 0} spins</span>
        </div>
        ${s.table ? `<div class="data-meta">🎲 Table: <b>${escapeHTML(s.table)}</b></div>` : ''}
        <div class="data-meta">${new Date(s.uploadedAt || 0).toLocaleString()} · ${escapeHTML(s.uploadedBy || '')}</div>
        ${s.notes ? `<div class="data-meta">📝 ${escapeHTML(s.notes)}</div>` : ''}
        <div class="data-preview">${preview}${(s.count || 0) > 60 ? ' …' : ''}</div>
        <div class="data-actions">
          <button class="btn btn-ghost" data-act="view" data-id="${s.id}">👁 View</button>
          <button class="btn btn-ghost" data-act="export" data-id="${s.id}">⤓ Export</button>
          <button class="btn btn-danger" data-act="delete" data-id="${s.id}">🗑 Delete</button>
        </div>
      </div>
    `;
  }).join('');

  $$('[data-act="delete"]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this session and its history entries?')) return;
    await remove(ref(db, `sessions/${b.dataset.id}`));
    const updates = {};
    Object.entries(allHistory).forEach(([k, v]) => {
      if (v.sessionId === b.dataset.id) updates[`history/${k}`] = null;
    });
    if (Object.keys(updates).length) await update(ref(db), updates);
    toast('Deleted', 'success');
  }));

  $$('[data-act="export"]').forEach(b => b.addEventListener('click', () => {
    const s = allSessions[b.dataset.id];
    downloadJSON(s, `${(s.label || 'session').replace(/\s/g,'_')}.json`);
  }));

  $$('[data-act="view"]').forEach(b => b.addEventListener('click', () => {
    const s = allSessions[b.dataset.id];
    const seq = (s.data || []).map(r => `${r.even_odd || '·'}/${r.color || '·'}`).join(' ');
    alert(`${s.label}\n\nFull sequence (${s.count} entries):\n\n${seq}`);
  }));
}

function exportAll() {
  downloadJSON({
    sessions: allSessions,
    users: allUsers,
    exportedAt: Date.now()
  }, `roulette_export_${Date.now()}.json`);
  toast('Export ready', 'success');
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
function renderStats() {
  const all = [];
  Object.values(allSessions).forEach(s => { if (s.data) all.push(...s.data); });
  Object.values(allLiveSpins).forEach(s => all.push(s));

  $('totalSpins').textContent = all.length.toLocaleString();
  if (all.length === 0) {
    $('detailEO').textContent = 'No data';
    $('detailRB').textContent = 'No data';
    $('longestStreak').textContent = '—';
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
  }
  if (cols.length > 0) {
    const rPct = (reds / cols.length * 100).toFixed(1);
    const bPct = (blacks / cols.length * 100).toFixed(1);
    $('barRed').style.width = rPct + '%';
    $('barBlack').style.width = bPct + '%';
    $('detailRB').textContent = `Red ${reds} (${rPct}%) · Black ${blacks} (${bPct}%) · ${cols.length} samples`;
  }
  // Longest E/O streak
  let longest = 1, cur = 1, longestVal = eos[0]?.even_odd;
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
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (data.length === 0) return;
  const cellW = w / data.length;
  data.forEach((d, i) => {
    if (d.even_odd === 'E') ctx.fillStyle = '#4a90e2';
    else if (d.even_odd === 'O') ctx.fillStyle = '#e25c4a';
    else ctx.fillStyle = '#283050';
    ctx.fillRect(i * cellW, 0, cellW + 0.5, h / 2);
    if (d.color === 'R') ctx.fillStyle = '#ff5470';
    else if (d.color === 'B') ctx.fillStyle = '#2a2f45';
    else if (d.color === 'G') ctx.fillStyle = '#2ee6a5';
    else ctx.fillStyle = '#283050';
    ctx.fillRect(i * cellW, h / 2, cellW + 0.5, h / 2);
  });
}

function drawNumberFreq(data) {
  const canvas = $('numFreq');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const counts = new Array(37).fill(0);
  data.forEach(d => {
    if (typeof d.number === 'number' && d.number >= 0 && d.number <= 36) counts[d.number]++;
  });
  const max = Math.max(...counts, 1);
  const barW = w / 37;
  for (let i = 0; i <= 36; i++) {
    const barH = (counts[i] / max) * (h - 20);
    if (i === 0) ctx.fillStyle = '#2ee6a5';
    else if (RED_NUMBERS.has(i)) ctx.fillStyle = '#ff5470';
    else ctx.fillStyle = '#4a5070';
    ctx.fillRect(i * barW + 1, h - barH - 16, barW - 2, barH);
    ctx.fillStyle = '#8892a8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i, i * barW + barW/2, h - 4);
  }
}

// ---------- USERS ----------
$('searchUsers').addEventListener('input', renderUsers);
$('sortUsers').addEventListener('change', renderUsers);

function renderUsers() {
  const filter = ($('searchUsers').value || '').toLowerCase();
  const sortBy = $('sortUsers').value;
  let list = Object.entries(allUsers).map(([uid, u]) => ({ uid, ...u }))
    .filter(u => !filter || (u.email || '').toLowerCase().includes(filter));
  if (sortBy === 'recent') list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  if (sortBy === 'active') list.sort((a, b) => (b.predictionCount || 0) - (a.predictionCount || 0));
  if (sortBy === 'accurate') list.sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0));

  if (list.length === 0) {
    $('userList').innerHTML = '<div class="empty-hint">No registered users yet. Share the User app URL!</div>';
    return;
  }
  $('userList').innerHTML = list.map(u => {
    const acc = u.accuracy ? u.accuracy.toFixed(1) : null;
    const accCls = acc ? (acc >= 50 ? '' : acc >= 35 ? 'low' : 'bad') : 'bad';
    return `
      <div class="user-item">
        <div class="user-info">
          <div class="user-email">${escapeHTML(u.email || u.uid)}</div>
          <div class="user-stats">${u.predictionCount || 0} predictions · last active ${timeAgo(u.lastActive)}</div>
        </div>
        <div class="user-acc ${accCls}">${acc ? acc + '%' : '—'}</div>
      </div>
    `;
  }).join('');
}

// ---------- TEST AI ----------
$$('.mode-tab').forEach(b => b.addEventListener('click', () => {
  $$('.mode-tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  testMode = b.dataset.pmode;
  testSeq = [];
  renderTestSeq();
  $('testEoBtns').classList.toggle('hidden', testMode === 'color');
  $('testColorBtns').classList.toggle('hidden', testMode === 'even_odd');
}));

$$('[data-test]').forEach(b => b.addEventListener('click', () => {
  testSeq.push(b.dataset.test);
  if (testSeq.length > 50) testSeq.shift();
  renderTestSeq();
}));
$('testUndoBtn').addEventListener('click', () => { testSeq.pop(); renderTestSeq(); });
$('testClearBtn').addEventListener('click', () => { testSeq = []; renderTestSeq(); $('testResult').classList.add('hidden'); });
$('testRunBtn').addEventListener('click', () => {
  if (testSeq.length < 3) return toast('Need at least 3 entries', 'error');
  const result = testEngine.predict(testSeq, testMode);
  showTestResult(result);
});
function renderTestSeq() {
  $('testSeq').innerHTML = testSeq.map(c => `<div class="seq-chip ${c}">${c}</div>`).join('');
}
function showTestResult(r) {
  const card = $('testResult');
  card.classList.remove('hidden');
  const labelMap = { E:'EVEN', O:'ODD', R:'RED', B:'BLACK' };
  const models = Object.entries(r.models || {}).map(([k, p]) => {
    const w = Object.keys(p).reduce((a, b) => p[a] > p[b] ? a : b);
    return `<div class="model-row"><span>${k}</span><b>${w} · ${(p[w]*100).toFixed(1)}%</b></div>`;
  }).join('');
  card.innerHTML = `
    <div style="font-size:11px;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase">AI says</div>
    <div class="pred-value">${r.prediction || '?'}</div>
    <div style="font-size:14px;color:var(--text);font-weight:600;letter-spacing:1.5px;margin-bottom:4px">${labelMap[r.prediction] || ''}</div>
    <div class="pred-conf">${r.confidence}% confidence</div>
    <div style="margin-top:14px;text-align:left">${models}</div>
    <div style="font-size:11px;color:var(--text-dim);margin-top:10px">Trained on ${testEngine.history.length} historical spins</div>
  `;
}

// ---------- BACKUP ----------
$('backupBtn').addEventListener('click', async () => {
  toast('Generating backup...', 'warn');
  try {
    const [s, u, h, l, p] = await Promise.all([
      get(ref(db, 'sessions')),
      get(ref(db, 'users')),
      get(ref(db, 'history')),
      get(ref(db, 'live_spins')),
      get(ref(db, 'userPredictions'))
    ]);
    const backup = {
      sessions: s.val() || {},
      users: u.val() || {},
      history: h.val() || {},
      live_spins: l.val() || {},
      userPredictions: p.val() || {},
      version: '2.0',
      exportedAt: Date.now()
    };
    const sizeKB = (JSON.stringify(backup).length / 1024).toFixed(1);
    downloadJSON(backup, `roulette_backup_${new Date().toISOString().split('T')[0]}.json`);
    $('backupInfo').textContent = `✓ Backup of ${sizeKB} KB downloaded`;
    toast('Backup downloaded', 'success');
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
    ['sessions','users','history','live_spins','userPredictions'].forEach(k => {
      if (b[k]) Object.entries(b[k]).forEach(([id, val]) => { updates[`${k}/${id}`] = val; });
    });
    await update(ref(db), updates);
    $('restoreInfo').textContent = `✓ Restored ${Object.keys(updates).length} records`;
    $('restoreInfo').className = 'msg success';
    toast('Restore complete', 'success');
  } catch (e) {
    $('restoreInfo').textContent = 'Failed: ' + e.message;
    $('restoreInfo').className = 'msg error';
  }
});

$('wipeConfirm').addEventListener('input', e => {
  $('wipeBtn').disabled = e.target.value !== 'WIPE';
});
$('wipeBtn').addEventListener('click', async () => {
  if (!confirm('FINAL CONFIRMATION: wipe entire database?')) return;
  await Promise.all([
    remove(ref(db, 'sessions')),
    remove(ref(db, 'history')),
    remove(ref(db, 'live_spins')),
    remove(ref(db, 'userPredictions'))
  ]);
  $('wipeConfirm').value = '';
  $('wipeBtn').disabled = true;
  toast('Database wiped', 'success');
});

// ---------- HELP MODAL ----------
$('helpBtn').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
$('helpClose').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden'); });

// ---------- KEYBOARD SHORTCUTS ----------
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') $('helpModal').classList.add('hidden');
  // shortcuts only when on Test AI tab
  const onTest = document.querySelector('[data-panel="test"]').classList.contains('active');
  if (!onTest) return;
  const k = e.key.toUpperCase();
  if ((testMode === 'even_odd' && (k === 'E' || k === 'O')) ||
      (testMode === 'color' && (k === 'R' || k === 'B'))) {
    testSeq.push(k); renderTestSeq();
  }
  if (e.key === 'Backspace') { testSeq.pop(); renderTestSeq(); }
  if (e.key === 'Enter') $('testRunBtn').click();
});

// ---------- HELPERS ----------
function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
