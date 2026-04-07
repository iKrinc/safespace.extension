/**
 * SafeSpace Background Service Worker
 * Proxies API calls from the SERP content script.
 * Background scripts always bypass CORS, making them the reliable path
 * for content scripts that need to call external APIs.
 *
 * Cache: chrome.storage.session (lives for the browser session, not forever)
 */

const API_BASE = 'https://safespace.krinc.in';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per URL

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SafeSpace] Extension installed');
});

// --- Message handler ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    handleAnalyze(message.url)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'PREVIEW') {
    handlePreview(message.url)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
});

// --- Cache helpers ---
async function getCached(key) {
  try {
    const store = await chrome.storage.session.get(key);
    const entry = store[key];
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
      return entry.data;
    }
  } catch {
    // storage.session may not be available in older versions
  }
  return null;
}

async function setCached(key, data) {
  try {
    await chrome.storage.session.set({ [key]: { data, ts: Date.now() } });
  } catch {
    // Non-critical — analysis still works, just no caching
  }
}

// --- API calls ---
async function handleAnalyze(url) {
  const cacheKey = `analyze:${url}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const resp = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  await setCached(cacheKey, data);
  return data;
}

async function handlePreview(url) {
  const cacheKey = `preview:${url}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const resp = await fetch(`${API_BASE}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  // Only cache successful previews (content can be large — check size)
  if (data.success && data.size < 1024 * 500) {
    await setCached(cacheKey, data);
  }
  return data;
}
