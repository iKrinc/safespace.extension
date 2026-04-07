/**
 * SafeSpace New Tab — JavaScript
 * Handles: clock, URL detection, analysis, preview rendering
 */

const API_BASE = 'https://safespace.krinc.in';

// ── Clock ──────────────────────────────────────────────────────────────────

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('time').textContent = `${hh}:${mm}`;
  document.getElementById('date').textContent =
    `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

setInterval(updateClock, 1000);
updateClock();

// ── URL detection ──────────────────────────────────────────────────────────

function isURL(text) {
  const t = text.trim();
  if (!t || t.includes(' ')) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^www\./i.test(t)) return true;
  // Match domains with any number of labels: crawlix.krinc.in, github.com, sub.domain.co.uk
  // Must have at least one dot, no spaces, valid chars only
  return /^([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}([\/?#].*)?$/.test(t);
}

function normalizeURL(text) {
  const t = text.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

// ── Input hint ─────────────────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const inputHint   = document.getElementById('input-hint');

searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  if (!val) {
    inputHint.textContent = '';
    inputHint.className = 'input-hint';
    return;
  }
  if (isURL(val)) {
    inputHint.textContent = '> analyze & preview site';
    inputHint.className = 'input-hint hint-url';
  } else {
    inputHint.textContent = '> search with google';
    inputHint.className = 'input-hint hint-search';
  }
});

// ── Form submit ────────────────────────────────────────────────────────────

let currentURL = '';

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = searchInput.value.trim();
  if (!val) return;

  if (isURL(val)) {
    currentURL = normalizeURL(val);
    startAnalysis(currentURL);
  } else {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(val)}`;
  }
});

document.getElementById('back-btn').addEventListener('click', showHome);

// ── Screen transitions ─────────────────────────────────────────────────────

function showHome() {
  document.getElementById('results-screen').classList.add('hidden');
  document.getElementById('home-screen').classList.remove('hidden');
  searchInput.focus();
}

function showResults() {
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('results-screen').classList.remove('hidden');
}

// ── Analysis flow ──────────────────────────────────────────────────────────

async function startAnalysis(url) {
  // Show results screen in loading state
  document.getElementById('analyzed-url-display').textContent = url;
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('results-content').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  showResults();

  try {
    const resp = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const analysis = await resp.json();

    document.getElementById('loading-state').classList.add('hidden');
    renderAnalysis(analysis, url);
    document.getElementById('results-content').classList.remove('hidden');

    if (analysis.canPreview) {
      loadPreview(url);
    } else {
      document.getElementById('preview-section').innerHTML = `
        <div class="preview-blocked">
          <span>[X]</span>
          <span>preview disabled — URL flagged as dangerous</span>
        </div>`;
    }
  } catch (err) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-sub').textContent = err.message || 'network error';

    document.getElementById('retry-btn').onclick = () => startAnalysis(url);
  }
}

async function loadPreview(url) {
  const container = document.getElementById('preview-section');

  // Show loading state
  container.innerHTML = `
    <div class="preview-header">
      <div class="preview-label">
        <span class="preview-check">[✓]</span>
        <span>safe preview</span>
      </div>
      <span class="preview-sandboxed">&lt;sandboxed&gt;</span>
    </div>
    <div class="preview-frame-wrap">
      <div class="preview-loading">[██████{'>'} ] loading preview...</div>
    </div>`;

  try {
    const resp = await fetch(`${API_BASE}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await resp.json();

    if (data.success && data.content) {
      const frameWrap = container.querySelector('.preview-frame-wrap');
      const iframe = document.createElement('iframe');
      iframe.title = 'Site preview';
      iframe.sandbox = 'allow-scripts allow-forms';
      iframe.referrerPolicy = 'no-referrer';
      iframe.srcdoc = data.content;
      frameWrap.innerHTML = '';
      frameWrap.appendChild(iframe);
    } else {
      container.querySelector('.preview-frame-wrap').innerHTML =
        `<div class="preview-loading" style="color:var(--text-muted);animation:none">
           [!] preview not available — ${data.error || 'site blocked embedding'}
         </div>`;
    }
  } catch {
    container.querySelector('.preview-frame-wrap').innerHTML =
      `<div class="preview-loading" style="color:var(--text-muted);animation:none">
         [!] preview failed to load
       </div>`;
  }
}

// ── Render helpers ─────────────────────────────────────────────────────────

function renderAnalysis(analysis, url) {
  const level = analysis.safetyLevel; // SAFE | SUSPICIOUS | DANGEROUS
  const cls   = level.toLowerCase();
  const ai    = analysis.aiInsights;
  const hasAI = ai && ai.powered !== 'none';

  // Score row
  document.getElementById('score-row').innerHTML = `
    <span class="level-badge ${cls}">${level}</span>
    <span class="score-text ${cls}">[${analysis.score}/100]</span>
    ${hasAI ? '<span class="ai-badge">⬡ AI</span>' : ''}
  `;

  // Explanation (prefer AI explanation)
  const expl = hasAI && ai.explanation ? ai.explanation : analysis.explanation;
  const explEl = document.getElementById('explanation');
  explEl.textContent = expl;
  explEl.className = `explanation ${cls}`;

  // AI panel
  if (hasAI) {
    const aiPanel = document.getElementById('ai-panel');
    aiPanel.classList.remove('hidden');

    // Tint border based on safety level
    aiPanel.style.borderColor = {
      SAFE: 'var(--safe-dim)',
      SUSPICIOUS: 'var(--warning-dim)',
      DANGEROUS: 'var(--danger-dim)',
    }[level] || 'var(--border)';

    document.getElementById('ai-panel-title').style.color = {
      SAFE: 'var(--safe)',
      SUSPICIOUS: 'var(--warning)',
      DANGEROUS: 'var(--danger)',
    }[level];

    document.getElementById('ai-powered').textContent = `via ${ai.powered}`;

    const body = document.getElementById('ai-panel-body');
    const threatsHTML = (ai.threats || []).map(t => `
      <div class="threat-item">
        <span class="threat-icon ${cls}">${level === 'SAFE' ? '[✓]' : '[!]'}</span>
        <span>${escHTML(t)}</span>
      </div>`).join('');

    const recHTML = ai.recommendation ? `
      <div class="recommendation">
        <strong>recommendation:</strong> ${escHTML(ai.recommendation)}
      </div>` : '';

    body.innerHTML = threatsHTML + recHTML;
  }

  // Actions
  const isDangerous = level === 'DANGEROUS';
  document.getElementById('actions').innerHTML = `
    <button class="btn-proceed ${isDangerous ? 'dangerous' : ''}" id="proceed-btn">
      ${isDangerous ? '[!] proceed anyway →' : 'proceed to site [→]'}
    </button>
    <a class="btn-fullsite"
       href="https://safespace.krinc.in?url=${encodeURIComponent(url)}"
       target="_blank">
      full analysis [↗]
    </a>
  `;

  document.getElementById('proceed-btn').addEventListener('click', () => {
    window.location.href = url;
  });
}

function escHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
