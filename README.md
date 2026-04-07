# SafeSpace Extension

**Chrome extension for [SafeSpace](https://safespace.krinc.in) — AI-powered URL safety on every Google result.**

🌐 **Website:** [safespace.krinc.in](https://safespace.krinc.in) &nbsp;|&nbsp; 🔗 **Main repo:** [github.com/iKrinc/safespace.krinc.in](https://github.com/iKrinc/safespace.krinc.in)

---

## Features

### New Tab Page
- Terminal-themed clock and date display
- Smart search bar — detects URLs vs search queries automatically
  - **URL typed** (e.g. `github.com`, `crawlix.krinc.in`) → runs AI safety analysis + sandboxed preview inline
  - **Search typed** (e.g. `javascript tutorial`) → goes straight to Google
- Full AI threat panel with Groq-powered analysis
- Sandboxed site preview with JS, CSS, and images

### Google SERP Badges
- Automatically scans every Google search result
- Colored safety badge appears next to each URL:
  - `[✓] 98` — green (SAFE)
  - `[!] 62` — yellow (SUSPICIOUS)
  - `[✗] 23` — red (DANGEROUS)
- Scans triggered by IntersectionObserver — only visible results get scanned
- Requests staggered 200ms apart to avoid rate limits
- Results cached for 5 minutes per browser session

### Analysis Panel (SERP)
- Click any badge → slide-in panel from the right (Shadow DOM isolated)
- Shows: safety score, AI explanation, threat list, recommendation
- Sandboxed site preview inside the panel
- "Proceed to site" button opens the URL in a new tab
- "Full analysis" link opens safespace.krinc.in with the URL pre-loaded

---

## Installation (Manual / Developer)

### Step 1 — Generate icons

1. Open `icons/generate-icons.html` in Chrome
2. Click **Download All Icons**
3. Save all 4 PNG files into the `icons/` folder

### Step 2 — Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select this `safespace-extension/` folder

### Step 3 — Test

- Open a **new tab** → SafeSpace clock + search bar
- Search on **Google** → colored badges on results
- Click a badge → panel slides in from the right

---

## File Structure

```
safespace-extension/
├── manifest.json              — MV3 manifest
├── background/
│   └── service-worker.js      — API proxy + session cache (5min TTL)
├── newtab/
│   ├── newtab.html            — New tab page
│   ├── newtab.css             — Terminal theme styles
│   └── newtab.js              — Clock, URL detection, analysis, preview
├── content/
│   ├── serp.js                — Google SERP badge injection + Shadow DOM panel
│   └── serp.css               — Badge styles
└── icons/
    ├── generate-icons.html    — Open in browser to generate PNG icons
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## How it works

```
New Tab:
  User types URL → newtab.js detects it → calls safespace.krinc.in/api/analyze
                → renders AI panel + sandboxed preview inline

  User types query → window.location = google.com/search?q=...

SERP:
  Page loads → serp.js finds all result <a> links
             → IntersectionObserver watches each badge
             → When visible: sendMessage(ANALYZE) → service-worker.js
             → service-worker.js checks session cache → calls API if needed
             → Badge colored based on safetyLevel
             → Click badge → Shadow DOM panel opens → loads preview
```

---

## API

The extension calls [safespace.krinc.in](https://safespace.krinc.in) — no keys or setup needed. All API calls go through the background service worker to bypass CORS.

| Endpoint | Used for |
|----------|----------|
| `POST /api/analyze` | Safety analysis (score + AI insights) |
| `POST /api/preview` | Sandboxed HTML preview |

---

## Privacy

- No user data is collected or stored
- URLs are sent to `safespace.krinc.in` for analysis only — not logged
- Session cache lives in `chrome.storage.session` — cleared when browser closes
- Shadow DOM panel is fully isolated from Google's page styles

---

## Permissions

| Permission | Why |
|-----------|-----|
| `storage` | Session cache for scan results |
| `host_permissions: safespace.krinc.in` | API calls from service worker |
| `host_permissions: google.com` | SERP badge injection |

---

## Publishing

To publish on the Chrome Web Store:

1. Generate and place all 4 icon PNGs in `icons/`
2. Zip all files (not the folder, the contents)
3. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
4. Pay one-time $5 developer fee
5. Upload zip, fill in description, add screenshots, submit

---

## License

MIT © [Krinc](https://krinc.in)
