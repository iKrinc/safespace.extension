/**
 * SafeSpace SERP Content Script
 * Injected into google.com/search pages.
 *
 * Approach: find result links by their actual href (external URLs),
 * then insert a badge next to the visible cite/URL element.
 * Uses IntersectionObserver so scans only happen as results scroll into view.
 * Staggered 200ms between requests to stay within rate limits.
 */

const API_BASE = 'https://safespace.krinc.in';
const STAGGER_MS = 200;

// ── Scan queue ─────────────────────────────────────────────────────────────

const queue = [];
let processing = false;

function enqueue(url, badge) {
  // Skip if already queued or already scanned
  if (badge.dataset.queued) return;
  badge.dataset.queued = '1';
  queue.push({ url, badge });
  processQueue();
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const { url, badge } = queue.shift();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ANALYZE', url });
    setBadgeResult(badge, result);
  } catch {
    setBadgeError(badge);
  }
  setTimeout(() => { processing = false; processQueue(); }, STAGGER_MS);
}

// ── Badge state ────────────────────────────────────────────────────────────

function setBadgeResult(badge, result) {
  if (!result) { setBadgeError(badge); return; }
  const { safetyLevel, score } = result;
  const map = {
    SAFE:       { cls: 'ss-safe',       icon: '[✓]' },
    SUSPICIOUS: { cls: 'ss-suspicious', icon: '[!]' },
    DANGEROUS:  { cls: 'ss-dangerous',  icon: '[✗]' },
  };
  const { cls, icon } = map[safetyLevel] || { cls: 'ss-error', icon: '[?]' };
  badge.className = `ss-badge ${cls}`;
  badge.textContent = `${icon} ${score}`;
  badge.title = `SafeSpace: ${safetyLevel} — ${score}/100. Click for full analysis.`;
  badge.dataset.result = JSON.stringify(result);
  badge.dataset.url = badge.dataset.url || '';
}

function setBadgeError(badge) {
  badge.className = 'ss-badge ss-error';
  badge.textContent = '[?]';
  badge.title = 'SafeSpace: could not analyze';
}

// ── IntersectionObserver — scan when visible ───────────────────────────────

const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const badge = entry.target;
    if (badge.dataset.result || badge.dataset.queued) return;
    enqueue(badge.dataset.url, badge);
    io.unobserve(badge);
  });
}, { rootMargin: '300px', threshold: 0 });

// ── Find Google result URLs ────────────────────────────────────────────────

function isExternalURL(href) {
  try {
    const u = new URL(href);
    const h = u.hostname;
    if (!h || h.endsWith('google.com') || h.endsWith('googleapis.com')) return false;
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    return true;
  } catch { return false; }
}

/**
 * Google result DOM (as of 2025-2026) has these patterns:
 *  - <div class="g"> > <div class="yuRUbf"> > <a href="..."> > <h3>title</h3>
 *  - <cite> shows the visible URL beneath the title
 *
 * We find all <a> tags in #rso / #search whose href is external,
 * then walk up to the nearest containing result div to avoid duplicates.
 */
function findResultLinks() {
  const seen = new Set();
  const results = [];

  // All links inside the results container
  const searchRoot = document.querySelector('#rso, #search, #main');
  if (!searchRoot) return results;

  const links = searchRoot.querySelectorAll('a[href]');
  links.forEach((a) => {
    const href = a.href;
    if (!isExternalURL(href)) return;
    if (seen.has(href)) return;

    // Skip links that are inside ads (Google marks these)
    const adParent = a.closest('[data-text-ad], .ads-ad, [aria-label*="Ad"], .commercial-unit-desktop-top');
    if (adParent) return;

    // The link must contain or be near a heading (title), not be an image/icon link
    const hasTitle = a.querySelector('h3, h2, [role="heading"]') || a.closest('[data-snf]');
    const isNearTitle = a.closest('div')?.querySelector('h3');
    if (!hasTitle && !isNearTitle) return;

    // Walk up to find the result container (usually .g or a div with jscontroller)
    const container =
      a.closest('.g, [jscontroller], [data-hveid]') ||
      a.closest('div[class]')?.parentElement;

    if (!container) return;
    if (container.dataset.ssDone) return;

    seen.add(href);
    container.dataset.ssDone = '1';
    results.push({ url: href, container, link: a });
  });

  return results;
}

// ── Badge injection ────────────────────────────────────────────────────────

function injectBadge({ url, container, link }) {
  if (container.querySelector('.ss-badge')) return;

  const badge = document.createElement('span');
  badge.className = 'ss-badge ss-loading';
  badge.textContent = '⬡';
  badge.title = 'SafeSpace: scanning...';
  badge.dataset.url = url;

  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel(url, badge);
  });

  // Find the URL row (cite's parent) and append badge after the ⋮ menu button
  const cite =
    container.querySelector('cite') ||
    container.querySelector('span[role="text"]') ||
    container.querySelector('.VuuXrf');

  if (cite) {
    const row = cite.closest('div') || cite.parentElement;
    if (row) {
      // Make row flex so badge sits inline after the ⋮ button
      row.style.cssText += ';display:flex!important;align-items:center!important;gap:6px!important;';
      row.appendChild(badge);
    } else {
      cite.insertAdjacentElement('afterend', badge);
    }
  } else {
    link.insertAdjacentElement('afterend', badge);
  }

  io.observe(badge);
}

function processResults() {
  findResultLinks().forEach(injectBadge);
}

// ── Shadow DOM panel ───────────────────────────────────────────────────────

const PANEL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .panel {
    position: fixed;
    top: 0; right: 0;
    width: 380px; height: 100vh;
    background: #0d1117;
    border-left: 1px solid #1a2420;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    color: #e6e6e6;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
    z-index: 2147483647;
    overflow: hidden;
    box-shadow: -4px 0 24px rgba(0,0,0,0.5);
  }
  .panel.open { transform: translateX(0); }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #1a2420;
    background: #0a0f0a;
    flex-shrink: 0;
  }
  .panel-logo { font-weight: 700; color: #00b347; font-size: 12px; letter-spacing: 0.05em; }
  .panel-close {
    background: none; border: 1px solid #262626; color: #737373;
    font-family: inherit; font-size: 11px; cursor: pointer;
    padding: 3px 8px; border-radius: 2px; transition: all 0.2s;
  }
  .panel-close:hover { border-color: #ff3333; color: #ff3333; }

  .panel-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .panel-body::-webkit-scrollbar { width: 3px; }
  .panel-body::-webkit-scrollbar-track { background: #0a0f0a; }
  .panel-body::-webkit-scrollbar-thumb { background: #004a1d; border-radius: 2px; }

  .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; gap: 10px; color: #00b347; font-size: 12px; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .loading-bar { animation: pulse 1.2s ease-in-out infinite; }

  .panel-url { padding: 6px 10px; background: #0a0f0a; border: 1px solid #1a2420; border-radius: 2px; font-size: 10px; color: #737373; word-break: break-all; line-height: 1.5; }

  .score-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lvl { padding: 2px 8px; font-size: 10px; font-weight: 700; border-radius: 2px; letter-spacing: 0.05em; }
  .lvl-safe { background: #00b35f; color: #0a0f0a; }
  .lvl-suspicious { background: #ffb400; color: #0a0f0a; }
  .lvl-dangerous { background: #ff3333; color: #fff; }
  .score { font-size: 14px; font-weight: 700; }
  .score-safe { color: #00b35f; }
  .score-suspicious { color: #ffb400; }
  .score-dangerous { color: #ff3333; }
  .ai-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border: 1px solid #006d2b; border-radius: 2px; font-size: 10px; color: #00b347; background: #0a0f0a; }

  .expl { font-size: 12px; line-height: 1.6; padding: 10px 12px; border: 1px solid #1a2420; background: #0a0f0a; border-radius: 2px; }
  .expl::before { content: '> '; color: #00b347; }
  .expl-safe { border-color: #006b39; color: #00b35f; }
  .expl-suspicious { border-color: #664800; color: #ffb400; }
  .expl-dangerous { border-color: #660000; color: #ff3333; }

  .ai-panel { border: 1px solid #1a2420; background: #111810; border-radius: 2px; overflow: hidden; }
  .ai-hdr { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #0f1a10; font-size: 11px; font-weight: 700; }
  .ai-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
  .ai-src { font-size: 10px; color: #404040; }
  .threat { display: flex; gap: 6px; font-size: 11px; line-height: 1.5; }
  .ti-d { color: #ff3333; flex-shrink: 0; }
  .ti-s { color: #00b35f; flex-shrink: 0; }
  .rec { padding-top: 6px; border-top: 1px solid #0f1a10; font-size: 10px; color: #737373; }
  .rec strong { color: #00b347; font-weight: 500; }

  .preview-wrap { display: flex; flex-direction: column; }
  .preview-bar { display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; background: #0a0f0a; border: 1px solid #1a2420; border-bottom: none; border-radius: 2px 2px 0 0; font-size: 10px; }
  .pcheck { color: #00b35f; }
  .psandbox { color: #404040; }
  .preview-box { border: 1px solid #1a2420; border-radius: 0 0 2px 2px; background: #fff; overflow: hidden; }
  .preview-box iframe { width: 100%; height: 300px; border: none; display: block; background: #fff; }
  .preview-loading { height: 100px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #00b347; background: #0a0f0a; border: 1px solid #1a2420; border-radius: 0 0 2px 2px; animation: pulse 1.2s ease-in-out infinite; }
  .preview-blocked { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #737373; background: #0a0f0a; border: 1px solid #1a2420; border-radius: 2px; }

  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn-go { padding: 7px 14px; background: #00b347; color: #0a0f0a; border: none; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px; transition: background 0.2s; }
  .btn-go:hover { background: #00d455; }
  .btn-go-d { padding: 7px 14px; background: none; border: 1px solid #ff3333; color: #ff3333; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px; transition: all 0.2s; }
  .btn-go-d:hover { background: rgba(255,51,51,0.08); }
  .btn-full { padding: 7px 12px; background: none; border: 1px solid #1a2420; color: #737373; font-family: inherit; font-size: 10px; cursor: pointer; border-radius: 2px; text-decoration: none; display: inline-block; transition: all 0.2s; }
  .btn-full:hover { border-color: #00b347; color: #00b347; }

  .err { padding: 48px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; color: #ff3333; }
`;

let panelHost = null;
let panelShadow = null;
let panelEl = null;
let panelBody = null;

function ensurePanel() {
  if (panelHost) return;
  panelHost = document.createElement('div');
  panelHost.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(panelHost);

  panelShadow = panelHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  panelShadow.appendChild(style);

  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.innerHTML = `
    <div class="panel-header">
      <span class="panel-logo">[safespace]</span>
      <button class="panel-close" id="ss-close">[x] close</button>
    </div>
    <div class="panel-body" id="ss-body"></div>`;
  panelShadow.appendChild(panelEl);
  panelBody = panelShadow.getElementById('ss-body');

  panelShadow.getElementById('ss-close').addEventListener('click', closePanel);
}

function openPanel(url, badge) {
  ensurePanel();
  panelHost.style.pointerEvents = 'all';
  panelBody.innerHTML = `
    <div class="panel-url">${escHTML(url)}</div>
    <div class="loading"><div class="loading-bar">[&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&gt; ]</div><div>analyzing...</div></div>`;
  requestAnimationFrame(() => panelEl.classList.add('open'));

  const cached = badge?.dataset?.result;
  if (cached) {
    renderPanel(JSON.parse(cached), url);
  } else {
    chrome.runtime.sendMessage({ type: 'ANALYZE', url }, (result) => {
      if (badge) setBadgeResult(badge, result);
      renderPanel(result, url);
    });
  }
}

function closePanel() {
  panelEl?.classList.remove('open');
  setTimeout(() => { if (panelHost) panelHost.style.pointerEvents = 'none'; }, 300);
}

function renderPanel(result, url) {
  if (!result) {
    panelBody.innerHTML = `<div class="err"><span>[X]</span><span>analysis failed</span></div>`;
    return;
  }

  const { safetyLevel, score, explanation, aiInsights, canPreview } = result;
  const cls = safetyLevel.toLowerCase();
  const ai  = aiInsights;
  const hasAI = ai && ai.powered !== 'none';
  const expl = hasAI && ai.explanation ? ai.explanation : explanation;

  // AI HTML
  let aiHTML = '';
  if (hasAI) {
    const col = { SAFE: '#00b35f', SUSPICIOUS: '#ffb400', DANGEROUS: '#ff3333' }[safetyLevel];
    const bdr = { SAFE: '#006b39', SUSPICIOUS: '#664800', DANGEROUS: '#660000' }[safetyLevel];
    const threats = (ai.threats || []).map(t =>
      `<div class="threat"><span class="${cls === 'safe' ? 'ti-s' : 'ti-d'}">${cls === 'safe' ? '[✓]' : '[!]'}</span><span>${escHTML(t)}</span></div>`
    ).join('');
    const rec = ai.recommendation
      ? `<div class="rec"><strong>recommendation:</strong> ${escHTML(ai.recommendation)}</div>` : '';
    aiHTML = `<div class="ai-panel" style="border-color:${bdr}">
      <div class="ai-hdr" style="color:${col}"><span>[AI] threat intelligence</span><span class="ai-src">via ${ai.powered}</span></div>
      <div class="ai-body">${threats}${rec}</div>
    </div>`;
  }

  const proceedBtn = canPreview
    ? `<button class="btn-go" id="ss-go">proceed to site [&gt;]</button>`
    : `<button class="btn-go-d" id="ss-go">[!] proceed anyway</button>`;

  panelBody.innerHTML = `
    <div class="panel-url">${escHTML(url)}</div>
    <div class="score-row">
      <span class="lvl lvl-${cls}">${safetyLevel}</span>
      <span class="score score-${cls}">[${score}/100]</span>
      ${hasAI ? '<span class="ai-chip">&#x2B21; AI</span>' : ''}
    </div>
    <div class="expl expl-${cls}">${escHTML(expl)}</div>
    ${aiHTML}
    ${canPreview
      ? `<div class="preview-wrap">
           <div class="preview-bar"><span><span class="pcheck">[✓]</span> safe preview</span><span class="psandbox">&lt;sandboxed&gt;</span></div>
           <div class="preview-loading" id="ss-prev-box">[&#x2588;&#x2588;&#x2588;&gt; ] loading...</div>
         </div>`
      : `<div class="preview-blocked">[X] preview disabled for dangerous URLs</div>`}
    <div class="actions">
      ${proceedBtn}
      <a class="btn-full" href="https://safespace.krinc.in?url=${encodeURIComponent(url)}" target="_blank">full analysis [&uarr;]</a>
    </div>`;

  panelShadow.getElementById('ss-go')?.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    closePanel();
  });

  if (canPreview) loadPanelPreview(url);
}

async function loadPanelPreview(url) {
  const box = panelShadow?.getElementById('ss-prev-box');
  if (!box) return;
  try {
    const data = await chrome.runtime.sendMessage({ type: 'PREVIEW', url });
    if (!panelShadow?.getElementById('ss-prev-box')) return; // panel closed
    if (data?.success && data.content) {
      const wrap = document.createElement('div');
      wrap.className = 'preview-box';
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts allow-forms';
      iframe.referrerPolicy = 'no-referrer';
      iframe.title = 'Site preview';
      iframe.srcdoc = data.content;
      wrap.appendChild(iframe);
      box.replaceWith(wrap);
    } else {
      box.textContent = '[!] preview not available';
      box.style.animation = 'none';
      box.style.color = '#737373';
    }
  } catch {
    const b = panelShadow?.getElementById('ss-prev-box');
    if (b) { b.textContent = '[!] preview failed'; b.style.animation = 'none'; }
  }
}

// ── Init + mutation observer ───────────────────────────────────────────────

processResults();

let mutTimer = null;
new MutationObserver(() => {
  clearTimeout(mutTimer);
  mutTimer = setTimeout(processResults, 500);
}).observe(document.body, { childList: true, subtree: true });

// ── Util ───────────────────────────────────────────────────────────────────

function escHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
