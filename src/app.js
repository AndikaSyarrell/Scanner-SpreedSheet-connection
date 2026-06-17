// ── State ─────────────────────────────────────────────────────────────────────
let sessions     = [{ id: 1, label: 'Sesi #1', startedAt: new Date() }];
let activeIdx    = 0;
let scans        = [];
let globalNo     = 0;
let scriptUrl    = '';
let retryQueue   = [];
let existingKeys = new Set(); // `${sessionLabel}||${code}`

// ── DOM ───────────────────────────────────────────────────────────────────────
const input = document.getElementById('scanInput');
input.addEventListener('keydown', e => { if (e.key === 'Enter') addScan(); });

// ── Connect via JSONP ─────────────────────────────────────────────────────────
function connectAndFetch() {
  const url = document.getElementById('scriptUrl').value.trim();
  if (!url.startsWith('https://script.google.com')) {
    document.getElementById('scriptUrl').className = 'invalid';
    showStatus('err', 'URL tidak valid. Harus diawali https://script.google.com/...');
    return;
  }

  setConnState('connecting');
  document.getElementById('connectBtn').disabled = true;
  showLoading('Menghubungkan dan mengambil data dari Sheets…');

  const cbName = '_gsCb_' + Date.now();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    cleanup(cbName);
    setConnState('disconnected');
    hideLoading();
    document.getElementById('connectBtn').disabled = false;
    showStatus('err', 'Timeout — Apps Script tidak merespons. Pastikan deployment aktif.');
  }, 15000);

  window[cbName] = function(json) {
    if (timedOut) return;
    clearTimeout(timer);
    cleanup(cbName);

    if (json.status !== 'ok') {
      setConnState('disconnected');
      hideLoading();
      document.getElementById('connectBtn').disabled = false;
      showStatus('err', `Error dari Sheets: ${json.message}`);
      return;
    }

    scriptUrl = url;
    document.getElementById('scriptUrl').className = 'valid';
    setConnState('connected');
    loadExistingData(json.sessions || {});
    hideLoading();
    enableInput();
    const total = Object.values(json.sessions || {}).reduce((s, r) => s + r.length, 0);
    showStatus('ok', `Terhubung — ${total} data dimuat dari Sheets.`);
  };

  const script = document.createElement('script');
  script.src = `${url}?callback=${cbName}`;
  script.onerror = function() {
    if (timedOut) return;
    clearTimeout(timer);
    cleanup(cbName);
    setConnState('disconnected');
    hideLoading();
    document.getElementById('connectBtn').disabled = false;
    showStatus('err', 'Gagal memuat script. Periksa URL dan koneksi internet.');
  };
  document.head.appendChild(script);
}

function cleanup(cbName) {
  delete window[cbName];
  const el = document.querySelector(`script[src*="${cbName}"]`);
  if (el) el.remove();
}

function loadExistingData(sessionsData) {
  // sessionsData: { 'Sesi #1': [{no, code, createdAt}, ...], 'Sesi #2': [...] }
  existingKeys.clear();
  scans    = [];
  sessions = [];

  Object.entries(sessionsData).forEach(([label, rows]) => {
    const id = sessions.length + 1;
    sessions.push({ id, label, startedAt: new Date() });

    rows.forEach(r => {
      const key = `${label}||${r.code}`;
      existingKeys.add(key);
      scans.push({
        no:           r.no,
        code:         r.code,
        sessionId:    id,
        sessionLabel: label,
        createdAt:    r.createdAt,
        syncStatus:   'loaded',
      });
    });
  });

  // Jika tidak ada sesi sama sekali dari sheet, pastikan Sesi #1 tetap ada
  if (sessions.length === 0) {
    sessions = [{ id: 1, label: 'Sesi #1', startedAt: new Date() }];
  }

  activeIdx = 0;
  globalNo  = scans.length;
  renderTabs();
  renderTable();
  updateStats();
}

// ── Add scan ──────────────────────────────────────────────────────────────────
function addScan() {
  const raw = input.value.trim();
  if (!raw)       { showStatus('err', 'Input kosong.'); return; }
  if (!scriptUrl) { showStatus('err', 'Hubungkan ke Google Sheets dulu.'); return; }

  const sess = sessions[activeIdx];
  const key  = `${sess.label}||${raw}`;

  if (scans.some(s => s.sessionId === sess.id && s.code === raw) || existingKeys.has(key)) {
    input.value = '';
    flash('err');
    showStatus('warn', `Duplikat di ${sess.label} — "${raw}" sudah terscan.`);
    return;
  }

  const now = new Date();
  globalNo++;
  const scan = {
    no:           globalNo,
    code:         raw,
    sessionId:    sess.id,
    sessionLabel: sess.label,
    createdAt:    now.toLocaleString(undefined, {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                  }),
    syncStatus: 'sending',
  };

  scans.push(scan);
  existingKeys.add(key);
  input.value = '';
  flash('ok');

  showStatus('sending', `Mengirim scan #${globalNo} ke Sheets…`);
  renderTabs();
  renderTable();
  updateStats();
  sendToSheet(scan);
}

// ── Send to Sheets ────────────────────────────────────────────────────────────
async function sendToSheet(scan, isRetry = false) {
  try {
    await fetch(scriptUrl, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({
        code:         scan.code,
        sessionLabel: scan.sessionLabel,
        createdAt:    scan.createdAt,
      }),
    });
    scan.syncStatus = 'ok';
    if (isRetry) removeFromQueue(scan.no);
    showStatus('ok', `Scan #${scan.no} terkirim ke Sheets.`);
  } catch {
    scan.syncStatus = 'fail';
    if (!isRetry) retryQueue.push(scan);
    updateQueueBadge();
    showStatus('err', `Gagal kirim scan #${scan.no}. Akan di-retry otomatis.`);
  }
  renderTable();
}

// ── Retry ─────────────────────────────────────────────────────────────────────
function removeFromQueue(no) {
  retryQueue = retryQueue.filter(s => s.no !== no);
  updateQueueBadge();
}
function updateQueueBadge() {
  const badge = document.getElementById('queueBadge');
  document.getElementById('queueCount').textContent = retryQueue.length;
  badge.style.display = retryQueue.length > 0 ? 'inline' : 'none';
}
setInterval(() => {
  if (!retryQueue.length || !scriptUrl) return;
  retryQueue.forEach(s => { s.syncStatus = 'sending'; sendToSheet(s, true); });
  renderTable();
}, 15000);

// ── Sessions / Tabs ───────────────────────────────────────────────────────────
function newSession() {
  const n = sessions.length + 1;
  sessions.push({ id: n, label: `Sesi #${n}`, startedAt: new Date() });
  activeIdx = sessions.length - 1;
  renderTabs();
  renderTable();
  updateStats();
  showStatus('info', `Sesi #${n} dimulai.`);
  input.focus();
}

function switchSession(idx) {
  activeIdx = idx;
  renderTabs();
  renderTable();
  updateStats();
  input.focus();
}

function renderTabs() {
  const bar = document.getElementById('tabBar');
  // Hapus semua tab lama (bukan tombol +)
  bar.querySelectorAll('.tab').forEach(t => t.remove());
  const addBtn = document.getElementById('newSessionBtn');

  sessions.forEach((s, i) => {
    const count = scans.filter(sc => sc.sessionId === s.id).length;
    const tab   = document.createElement('button');
    tab.className = 'tab' + (i === activeIdx ? ' active' : '');
    tab.innerHTML = `${s.label}<span class="tab-count">${count}</span>`;
    tab.onclick = () => switchSession(i);
    bar.insertBefore(tab, addBtn);
  });

  // Scroll tab aktif ke view
  const activeTab = bar.querySelectorAll('.tab')[activeIdx];
  if (activeTab) activeTab.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
}

// ── Table — hanya sesi aktif ──────────────────────────────────────────────────
const syncMeta = {
  ok:      { cls: 'sync-ok',      icon: '✓', tip: 'Tersimpan'     },
  loaded:  { cls: 'sync-loaded',  icon: '●', tip: 'Dari Sheets'   },
  sending: { cls: 'sync-sending', icon: '…', tip: 'Mengirim…'     },
  fail:    { cls: 'sync-fail',    icon: '✗', tip: 'Gagal, retry…' },
  dup:     { cls: 'sync-dup',     icon: '≠', tip: 'Duplikat'      },
};

function renderTable() {
  const tbody   = document.getElementById('scanTableBody');
  const sessId  = sessions[activeIdx].id;
  const sessScans = scans.filter(s => s.sessionId === sessId);

  if (!sessScans.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Belum ada scan di sesi ini.</td></tr>';
    return;
  }

  // Nomor urut dalam sesi (1-based), tampilkan terbalik (terbaru di atas)
  tbody.innerHTML = [...sessScans].reverse().map((s, i, arr) => {
    const m       = syncMeta[s.syncStatus] || syncMeta.loaded;
    const sessNo  = arr.length - i; // nomor urut dalam sesi
    return `<tr>
      <td class="td-no">${sessNo}</td>
      <td class="td-code">${escHtml(s.code)}</td>
      <td class="td-time">${s.createdAt}</td>
      <td class="td-sync ${m.cls}" title="${m.tip}">${m.icon}</td>
    </tr>`;
  }).join('');
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const sessId = sessions[activeIdx].id;
  document.getElementById('statSession').textContent  = scans.filter(s => s.sessionId === sessId).length;
  document.getElementById('statTotal').textContent    = scans.length;
  document.getElementById('statSessions').textContent = sessions.length;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function flash(type) {
  input.classList.add(`flash-${type}`);
  setTimeout(() => input.classList.remove(`flash-${type}`), 300);
}
function setConnState(state) {
  document.getElementById('connDot').className = `conn-dot ${state}`;
  document.getElementById('connLabel').textContent =
    state === 'connected'  ? 'Terhubung' :
    state === 'connecting' ? 'Menghubungkan…' : 'Belum terhubung';
}
function enableInput() {
  input.disabled = false;
  document.getElementById('addBtn').disabled = false;
  document.getElementById('connectBtn').disabled = false;
  input.focus();
}
function showLoading(msg) {
  document.getElementById('loadingText').textContent = msg;
  document.getElementById('loadingOverlay').classList.add('visible');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('visible');
}

let _stTimer;
function showStatus(type, msg) {
  const bar = document.getElementById('statusBar');
  bar.className = type;
  document.getElementById('statusText').textContent = msg;
  clearTimeout(_stTimer);
  if (!['idle', 'err'].includes(type)) {
    _stTimer = setTimeout(() => {
      bar.className = 'idle';
      document.getElementById('statusText').textContent = 'Siap menerima scan — tekan Enter setelah setiap scan';
    }, 3500);
  }
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderTabs();
renderTable();
updateStats();