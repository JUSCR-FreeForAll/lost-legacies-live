const sections = [
  { id: 'overview', label: 'Overview', icon: '◈' },
  { id: 'integrity', label: 'Integrity', icon: '◇' },
  { id: 'backups', label: 'Backups', icon: '⬡' },
  { id: 'recovery', label: 'Recovery', icon: '✦' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

const state = {
  view: 'overview',
  endpoint: sessionStorage.getItem('fortress-health-endpoint') || '',
  status: 'NOT_CONNECTED',
  checkTime: null,
  serviceId: null,
  height: null,
  error: null,
  deferredInstall: null
};

const content = document.querySelector('#content');
const nav = document.querySelector('#mobile-nav');
const desktopNav = document.querySelector('#desktop-nav');
let toastTimeout;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

function showToast(message) {
  const el = document.querySelector('#toast');
  clearTimeout(toastTimeout);
  el.textContent = message;
  el.classList.add('visible');
  toastTimeout = setTimeout(() => el.classList.remove('visible'), 4500);
}

function statusLabel() {
  if (!navigator.onLine) return 'INTERFACE OFFLINE';
  if (state.status === 'READY') return 'SERVICE REPORTS READY';
  if (state.status === 'RECOVERY_REQUIRED') return 'RECOVERY REQUIRED';
  if (state.status === 'UNAVAILABLE') return 'CHECK UNAVAILABLE';
  return 'NOT CONNECTED';
}

function statusClass() {
  if (!navigator.onLine) return 'warning';
  if (state.status === 'READY') return 'ready';
  if (state.status === 'RECOVERY_REQUIRED' || state.status === 'UNAVAILABLE') return 'danger';
  return 'muted';
}

function syncStatus() {
  document.querySelector('#connection-label').textContent = statusLabel();
  document.querySelector('#connection-dot').className = `connection-dot ${statusClass()}`;
}

function navItem(section, compact) {
  const active = state.view === section.id;
  return `<button type="button" data-view="${section.id}" class="nav-item${active ? ' active' : ''}" ${active ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${section.icon}</span><span>${section.label}</span></button>`;
}

function banner() {
  return `<div class="notice"><span class="notice-icon" aria-hidden="true">ⓘ</span><div><strong>Digital recovery, with your consent.</strong><p>This interface cannot provide emergency response, physical protection, or an assurance that your data is backed up.</p></div></div>`;
}

function pageHeading(kicker, title, subtitle) {
  return `<div class="page-heading"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div>`;
}

function statusPanel() {
  const checked = state.checkTime ? new Date(state.checkTime).toLocaleString() : 'Never checked';
  const summary = state.status === 'READY'
    ? 'The configured endpoint reported READY. This alone is not independent ledger verification.'
    : state.status === 'RECOVERY_REQUIRED'
      ? 'The service reported that recovery or integrity review is needed.'
      : state.error || 'No backend health response has been verified in this session.';
  return `<section class="service-panel ${statusClass()}">
    <div class="panel-top"><span class="eyebrow">SERVICE CONNECTION</span><span class="mini-pill">${navigator.onLine ? 'ONLINE INTERFACE' : 'OFFLINE INTERFACE'}</span></div>
    <div class="status-title"><span class="large-dot" aria-hidden="true"></span><h2>${statusLabel()}</h2></div>
    <p>${escapeHtml(summary)}</p><div class="status-meta"><span>LAST CHECK<br /><strong>${escapeHtml(checked)}</strong></span><span>CHAIN HEIGHT<br /><strong>${state.height === null ? 'Unknown' : escapeHtml(state.height)}</strong></span></div>
    <button class="outline-button" type="button" data-view="integrity">Review integrity <span aria-hidden="true">↗</span></button>
  </section>`;
}

function overview() {
  return `${pageHeading('YOUR DIGITAL RECOVERY SPACE', 'A safer way<br />back.', 'A private starting point for backup, integrity verification, and recovery.')}
    ${statusPanel()}
    <section class="section"><div class="section-heading"><h2>Core protections</h2><span>01 — 03</span></div>
      <div class="feature-grid">
        <button class="feature" data-view="backups"><span class="feature-icon" aria-hidden="true">⬡</span><span class="feature-name">Backup vault</span><span class="feature-desc">Protect your chosen data with authorized, encrypted exports.</span><span class="feature-arrow" aria-hidden="true">↗</span></button>
        <button class="feature" data-view="integrity"><span class="feature-icon" aria-hidden="true">◇</span><span class="feature-name">Integrity checks</span><span class="feature-desc">Inspect the service’s reported verification state.</span><span class="feature-arrow" aria-hidden="true">↗</span></button>
        <button class="feature" data-view="recovery"><span class="feature-icon" aria-hidden="true">✦</span><span class="feature-name">Recovery center</span><span class="feature-desc">Plan a deliberate, permission-checked restore.</span><span class="feature-arrow" aria-hidden="true">↗</span></button>
      </div>
    </section>
    <section class="next-card"><span class="eyebrow">START HERE</span><h2>Connect your own Fortress service.</h2><p>The interface works offline, but real backups and restoration need a running backend, authenticated access, and verified data.</p><button type="button" class="gold-button" data-view="settings">Configure connection <span aria-hidden="true">→</span></button></section>
    ${banner()}`;
}

function integrity() {
  const endpoint = state.endpoint ? escapeHtml(state.endpoint) : 'Not configured';
  return `${pageHeading('CHAIN & SERVICE HEALTH', 'Trust needs<br />evidence.', 'Check what your Fortress service actually reports. No result is simulated.')}
    <section class="card"><div class="card-header"><span class="card-icon">◇</span><span class="tag">READ-ONLY</span></div>
      <h2>Live health check</h2><p>Requests only the health response from your selected service. This check does not change the ledger or attempt recovery.</p>
      <div class="field-row"><span>Health endpoint</span><strong class="truncate">${endpoint}</strong></div>
      <button type="button" class="gold-button full" data-action="check-health" ${!state.endpoint ? 'disabled' : ''}>Check service health <span aria-hidden="true">↗</span></button>
      ${!state.endpoint ? '<p class="field-help">Add a health endpoint under Settings to enable this action.</p>' : ''}
    </section>${statusPanel()}
    <section class="card secondary"><h2>Verification boundaries</h2><ul class="checklist"><li>Service readiness is reported by the backend, not proven by the UI.</li><li>Signed checkpoints and independent chain audit are required for stronger integrity evidence.</li><li>A broken, missing, or untrusted response must never appear as verified.</li></ul></section>`;
}

function backups() {
  return `${pageHeading('ENCRYPTED DATA CONTINUITY', 'Your data.<br />Your choices.', 'Select what to preserve and where to keep recovery copies.')}
    <section class="card"><div class="card-header"><span class="card-icon">⬡</span><span class="tag locked">BACKEND REQUIRED</span></div><h2>Backup extraction</h2>
      <p>Backup creation must be authorized with a dedicated extraction credential, encrypted before export, and followed by an integrity test.</p>
      <div class="empty-state"><span aria-hidden="true">◌</span><strong>No verified backups are shown</strong><p>This mobile interface has no authenticated backup inventory connection yet.</p></div>
      <button class="gold-button full" type="button" disabled>Create encrypted backup <span aria-hidden="true">→</span></button>
      <p class="field-help">Disabled until a tested, authorized Fortress backup API is connected.</p>
    </section><section class="card secondary"><h2>Before you rely on a backup</h2><ul class="checklist"><li>Confirm encryption and independent key custody.</li><li>Keep at least one copy outside the primary device.</li><li>Verify archive integrity and practice a restore with non-sensitive test data.</li></ul></section>${banner()}`;
}

function recovery() {
  return `${pageHeading('CONTROLLED RESTORATION', 'Recovery is<br />a choice.', 'A safe restore begins with consent, independent authentication, and validation.')}
    <section class="warning-card"><span class="warning-symbol" aria-hidden="true">!</span><div><strong>Are you using a device you trust?</strong><p>If someone else can monitor this device or account, using a recovery tool may reveal your activity. Consider a safer device or trusted person before proceeding.</p></div></section>
    <section class="card"><div class="card-header"><span class="card-icon">✦</span><span class="tag locked">AUTHORIZATION GATE</span></div><h2>Restore a verified backup</h2><p>A full restore must confirm identity and recovery authorization, verify the archive, and present an explicit final confirmation. A separate master recovery credential is required.</p>
      <div class="steps"><div><b>01</b><span>Confirm safe environment</span></div><div><b>02</b><span>Authenticate recovery authority</span></div><div><b>03</b><span>Validate backup and restore target</span></div><div><b>04</b><span>Approve and verify restoration</span></div></div>
      <button type="button" class="gold-button full" disabled>Begin authorized recovery <span aria-hidden="true">→</span></button><p class="field-help">Unavailable until recovery API and security tests are verified.</p>
    </section>${banner()}`;
}

function settings() {
  return `${pageHeading('CONNECTION & INSTALL', 'Make it<br />yours.', 'Configure a read-only service check and add Fortress to your phone.')}
    <section class="card"><div class="card-header"><span class="card-icon">⚙</span><span class="tag">LOCAL SESSION</span></div><h2>Fortress endpoint</h2>
      <p>Enter the full HTTPS health endpoint for a service you control. The app will only contact it when you choose “Check service health.”</p>
      <form id="endpoint-form"><label for="health-endpoint">Health URL</label><input type="url" id="health-endpoint" name="endpoint" inputmode="url" spellcheck="false" autocomplete="off" placeholder="https://fortress.example/health" required /><p class="field-help">No password, recovery key, token, or personal history belongs in this field. Only HTTPS is allowed, except localhost for development. Your URL stays in this browser tab’s session.</p>
      <button class="gold-button full" type="submit">Save health endpoint <span aria-hidden="true">→</span></button></form>
    </section>
    <section class="card"><div class="card-header"><span class="card-icon">↗</span><span class="tag">PHONE-FRIENDLY</span></div><h2>Install on your home screen</h2><p>Once hosted over HTTPS, this interface can open like an app, including its cached navigation when offline.</p><button type="button" class="outline-button full" data-action="install">Install / show instructions</button><p class="field-help">On iPhone: use Safari Share → Add to Home Screen. On Android: use the browser’s Install app option.</p></section>
    <section class="card secondary"><h2>Data & permissions</h2><ul class="checklist"><li>No location, camera, microphone, or contacts permission is requested.</li><li>No secrets are saved by this interface.</li><li>Only app-shell files are cached offline; health responses and recovery data are not cached.</li></ul><button type="button" class="subtle-button" data-action="forget">Forget connection settings</button></section>`;
}

const views = {overview, integrity, backups, recovery, settings};
function render() {
  nav.innerHTML = sections.map(item => navItem(item, true)).join('');
  desktopNav.innerHTML = sections.map(item => navItem(item, false)).join('');
  content.innerHTML = views[state.view]();
  const field = document.querySelector('#health-endpoint');
  if (field) field.value = state.endpoint;
  syncStatus();
}

async function checkHealth(button) {
  if (!state.endpoint) return showToast('Configure a health URL first.');
  if (!navigator.onLine) return showToast('This device appears offline. No verification was run.');
  button.disabled = true;
  const oldLabel = button.textContent;
  button.textContent = 'Checking…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(state.endpoint, {method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal, headers: {'Accept': 'application/json'}});
    if (!response.ok) throw new Error(`Service HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid health response');
    const reported = String(value.state || value.status || '').toUpperCase();
    state.status = reported === 'READY' ? 'READY' : reported === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : 'UNAVAILABLE';
    state.height = Number.isSafeInteger(value.chain_height) && value.chain_height >= 0 ? value.chain_height : null;
    state.serviceId = typeof value.service_id === 'string' ? value.service_id : null;
    state.error = state.status === 'UNAVAILABLE' ? 'The endpoint did not report a recognized READY state.' : null;
  } catch (error) {
    state.status = 'UNAVAILABLE';
    state.height = null;
    state.serviceId = null;
    state.error = error.name === 'AbortError' ? 'Health request timed out.' : 'The endpoint could not be verified. Check connectivity, HTTPS, and server CORS settings.';
  } finally {
    clearTimeout(timeout);
    state.checkTime = Date.now();
    render();
    showToast(state.status === 'READY' ? 'Service reported READY; no independent audit was performed.' : 'Verification was not established.');
  }
}

content.addEventListener('submit', event => {
  if (event.target.id !== 'endpoint-form') return;
  event.preventDefault();
  const value = document.querySelector('#health-endpoint').value.trim();
  let url;
  try { url = new URL(value); } catch { return showToast('Enter a complete health URL.'); }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return showToast('HTTPS is required outside local development.');
  if (url.username || url.password || url.search || url.hash) return showToast('Remove credentials, query parameters, and fragments from this URL.');
  state.endpoint = url.href;
  sessionStorage.setItem('fortress-health-endpoint', state.endpoint);
  state.status = 'NOT_CONNECTED';
  state.height = null;
  state.checkTime = null;
  state.error = null;
  render();
  showToast('Health endpoint saved for this session.');
});

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-view], [data-action]');
  if (!target) return;
  if (target.dataset.view && views[target.dataset.view]) {
    state.view = target.dataset.view;
    render();
    content.focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'instant'});
  }
  if (target.dataset.action === 'check-health') await checkHealth(target);
  if (target.dataset.action === 'forget') {
    sessionStorage.removeItem('fortress-health-endpoint');
    state.endpoint = '';
    state.status = 'NOT_CONNECTED';
    state.height = null;
    state.checkTime = null;
    state.error = null;
    render();
    showToast('Connection settings removed from this tab.');
  }
  if (target.dataset.action === 'install') {
    if (state.deferredInstall) {
      state.deferredInstall.prompt();
      state.deferredInstall = null;
    } else showToast('Use your browser’s Share or menu button, then Add to Home Screen / Install app.');
  }
});

window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); state.deferredInstall = event;});
window.addEventListener('online', syncStatus);
window.addEventListener('offline', syncStatus);
render();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
