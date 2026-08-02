# LAXTLINE — Portfolio Website

A cinematic, single‑page portfolio for **LAXTLINE** — a visual storyteller & video editor based in
Bhubaneswar, Odisha, India. The site showcases video edits, VFX, color grading, gaming montages,
photo edits and design work through an interactive, animation‑rich gallery experience.

> Built with plain **HTML + CSS + JavaScript** (no frameworks, no build step). All portfolio media
> is served from the owner's own **Drive‑backed media CDN** and managed through a **hidden admin
> panel** — updating the portfolio needs zero code changes.

**Live:**

- 🌐 Vercel (primary): <https://laxt-line-studio.vercel.app>
- 🌐 GitHub Pages: <https://laxtline.github.io/laxt-line-studio/>

---

## 📑 Table of Contents

1. [Features](#-features)
2. [Dynamic Media System](#-dynamic-media-system)
3. [Admin Panel](#-admin-panel)
4. [Folder Structure](#-folder-structure)
5. [File Reference](#-file-reference)
6. [How to Run](#-how-to-run)
7. [Deployment & Going Live](#-deployment--going-live)
8. [SEO & Meta Files](#-seo--meta-files)
9. [Tech Stack](#-tech-stack)
10. [Performance Notes](#-performance-notes)
11. [Security](#-security)
12. [Editing Guide](#-editing-guide)
13. [Branding Note](#-branding-note)
14. [Contact](#-contact)

---

## ✨ Features

- **Hero section** with an animated particle/grid canvas background and a large brand watermark.
- **Custom cursor** with a smooth trailing follower (auto‑disabled on touch devices).
- **Marquee ribbons** of skills scrolling in both directions.
- **Work / Project Gallery** — dynamic masonry layout (up to 15 items) with hover‑to‑play videos
  and sound.
- **"All Projects" section** — the complete catalogue (up to 100 items), fully CDN‑driven.
- **Hidden admin panel** — login from the site itself, then upload / delete / reorder media; the
  site updates instantly on every device. See [Admin Panel](#-admin-panel).
- **Fullscreen viewer (lightbox)** — play/pause, seek bar, volume, prev/next, keyboard shortcuts.
- **About, Services, Software & Tools, Contact, Socials** sections.
- **Section‑entrance animations** — content slides/fades in each time a section scrolls into view;
  replays on every scroll‑back. GPU‑only and respects `prefers‑reduced‑motion`.
- **Smart, memory‑safe lazy loading** — videos load only when near the viewport and are released
  from memory once far off‑screen, so the page stays smooth at any media count.
- **SEO‑ready** — meta description, Open Graph & Twitter cards, sitemap and a PWA manifest.
- Fully **responsive** and performance‑optimised (GPU‑friendly animations, throttled scroll,
  paused off‑screen work, keyboard `:focus-visible` support).

---

## 🎞 Dynamic Media System

There are **no hardcoded media files** in the HTML. Both gallery sections render at runtime from
the owner's media CDN (`cloud-server-eight.vercel.app`, backed by Google Drive):

| Section | CDN folder | Max items | localStorage cache key |
| --- | --- | --- | --- |
| Project Gallery (`#projectGalleryGrid`) | `laxtline_gallery` | 15 | `laxtline_gallery` |
| All Projects (`#galleryGrid`) | `laxtline_allprojects` | 100 | `laxtline_allprojects` |

How it works (`js/05-media-engine.js`):

- Each CDN folder holds the media files plus a small `manifest.json` storing **order + metadata**.
  Manifest writes are serialized (upload‑new‑then‑delete‑old) so rapid edits can't corrupt order.
- **Type detection** from MIME first, then file extension — `.mp4` → video logic, `.jpg/.png/.webp`
  → image logic. Never cross‑applied.
- **Native aspect ratio** is detected from the real media dimensions — a 9:16 reel renders 9:16, a
  16:9 video renders 16:9. No cropping, no stretching, no fixed slots.
- **Instant paint** — the last known state is cached in `localStorage` and painted immediately,
  then reconciled against the CDN listing in the background.
- Grid is fully fluid: the section ends exactly at the last item, whether there is 1 or 100.

---

## 🔐 Admin Panel

- A small, low‑key **gear icon fixed at the top‑right** of the page opens the login modal.
- After login, the **Media Manager** panel slides in with two independent zones (Project Gallery
  and All Projects), each showing a live count (e.g. `9 / 15`).
- Per item: **upload** (file picker or drag‑and‑drop), **delete**, **reorder** (drag rows or use
  ▲/▼ buttons). Accepted formats: JPG, JPEG, PNG, WEBP, MP4.
- Large videos (>4 MB, up to 4K) upload via a **resumable direct‑to‑Drive session** with a real
  progress bar — the UI never freezes.
- The panel's DOM is **built only after a successful login** — logged‑out visitors have nothing to
  inspect. The session persists in `localStorage` across refreshes; mutation APIs are gated behind
  the same session check.

---

## 📁 Folder Structure

```
laxt-line-studio/
├── index.html                  ← Main entry point (open / host this)
├── README.md                   ← This file
│
├── robots.txt                  ← Crawler rules + sitemap pointer (must be at the root)
├── sitemap.xml                 ← List of URLs for search engines
├── site.webmanifest            ← PWA / "Add to Home Screen" metadata
│
├── vercel.json                 ← Vercel: cache + security headers
├── _headers                    ← Netlify / Cloudflare Pages: same headers
├── netlify.toml                ← Netlify: publish the repo root, no build step
├── .nojekyll                   ← GitHub Pages: don't let Jekyll drop _headers
│
├── assets/                     ← Static page images (hero, about, backgrounds, logo)
│
├── css/
│   ├── main.css                ← Global styles (nav, hero, sections, responsive)
│   ├── gallery.css             ← Gallery grid + fullscreen viewer styles
│   └── admin.css               ← Admin trigger, login modal & upload panel styles
│
├── js/
│   ├── 01-cursor-init.js       ← Creates the custom cursor (desktop only)
│   ├── 02-interactions.js      ← Hero canvas, cursor, scroll‑reveal, nav, menu
│   ├── 03-gallery-config.js    ← Status marker (gallery is dynamic now)
│   ├── 04-gallery-video.js     ← Video engine, lazy‑load + memory release, viewer
│   ├── 05-media-engine.js      ← Dynamic media renderer + CDN API (LaxtMedia)
│   └── 06-admin.js             ← Hidden admin login + upload panel
│
└── Docs/                       ← Author's notes & documentation (not part of the site)
```

> **Load order matters:** CSS loads as `main.css` → `gallery.css` → `admin.css`; JS loads
> `01 → 06` in order at their original positions. Every `.html`, `.css` and `.js` file starts with
> a header comment block explaining *what it does and why*.

---

## 🗂 File Reference

| File | What it does |
|------|--------------|
| `index.html` | Page markup: head/SEO meta, the `window.LAXT_CDN` config (CDN base URL, folder IDs, limits), all sections, empty gallery grids (filled by JS) and the entrance‑animation blocks. |
| `css/main.css` | Brand variables (`:root`), nav, hero, marquee, sections, footer, `:focus-visible`, responsive breakpoints. |
| `css/gallery.css` | Masonry gallery cards, hover overlays, play/mute buttons and all `.fsv-*` fullscreen‑viewer styles. |
| `css/admin.css` | Admin gear icon, login modal, Media Manager panel, progress bars, toasts. |
| `js/01-cursor-init.js` | Inserts the cursor dot + ring (skipped on touch devices). |
| `js/02-interactions.js` | Hero canvas animation, custom‑cursor motion, scroll‑reveal observer, nav scroll state, hamburger menu. |
| `js/03-gallery-config.js` | Small status marker (media is rendered dynamically). |
| `js/04-gallery-video.js` | Playback engine: hover/touch play, autoplay‑unmute, **lazy‑load + memory release**, ratio sizing, fullscreen viewer, `reinitGallery()`/`unwireGallery()` hooks for re-renders. |
| `js/05-media-engine.js` | Fetches CDN folders + manifest, builds gallery cards, exposes `window.LaxtMedia` (get / add / remove / reorder — mutations admin‑gated), handles small & resumable uploads. |
| `js/06-admin.js` | Gear trigger, login modal, Media Manager panel (upload zones, counts, delete, drag reorder). |
| `sitemap.xml` | Lists the homepage + main section anchors for search engines. |
| `site.webmanifest` | App name, colors and icon for installable‑PWA / mobile home‑screen. |

---

## 🚀 How to Run

**Option 1 — Open directly:** double‑click `index.html`. Everything is static, so no build step is
needed (media loads from the CDN, so you need internet).

**Option 2 — Local server (recommended; some browsers limit video autoplay on `file://`):**

```bash
python -m http.server 8000      # Python 3
# or
npx serve .                     # Node.js
```

Then open <http://localhost:8000>.

---

## 🌐 Deployment & Going Live

The site is deployed on **two hosts** from the same GitHub repo
([`laxtline/laxt-line-studio`](https://github.com/laxtline/laxt-line-studio)):

- **Vercel** (primary / canonical): <https://laxt-line-studio.vercel.app> — auto‑deploys on every
  push to `main`.
- **GitHub Pages**: <https://laxtline.github.io/laxt-line-studio/> — served from the `main` branch.

To publish changes: commit and `git push origin main` — both hosts update automatically.

**Host config is committed, so any of the four platforms works with no setup:**

| Host | Reads | Notes |
| --- | --- | --- |
| Vercel | `vercel.json` | Cache + security headers, `cleanUrls` |
| Netlify | `netlify.toml` + `_headers` | Publishes the repo root, no build command |
| Cloudflare Pages | `_headers` | Build command empty, output directory `/` |
| GitHub Pages | `.nojekyll` | Ignores custom headers (unsupported); `.nojekyll` stops Jekyll from dropping `_headers` |

There is no build step — the repository root *is* the site, so every path in `index.html` is
relative and works from any of them.

> **Case sensitivity:** Vercel/Netlify/Cloudflare/Pages all serve from Linux, where `Assets/Logo.JPG`
> and `assets/logo.jpg` are different files — Windows won't warn you. Keep asset paths lowercase and
> exactly matching the filename on disk.

> **⚠️ If you move to a custom domain later**, replace `https://laxt-line-studio.vercel.app` in:
>
> 1. `sitemap.xml` → every `<loc>` URL
> 2. `index.html` → the `canonical`, `og:url`, `og:image` and `twitter:image` tags

---

## 🔎 SEO & Meta Files

These make the site look professional in Google results and in link previews (WhatsApp, Instagram
bio link, LinkedIn, X):

- **`<head>` meta** — `description`, `keywords`, `author`, `robots`, plus **Open Graph** and
  **Twitter Card** tags so a shared link shows a title, description and image preview.
- **`sitemap.xml`** — a map of the site's URLs to help search engines crawl it.
- **`site.webmanifest`** — lets the site be "Added to Home Screen" like an app, with the brand name,
  theme color and icon.

> **Icon tip:** the manifest/favicon point to `assets/logo.jpeg`. Two things worth fixing:
>
> 1. **It is ~500 KB** — a favicon is displayed at 32 px, so this downloads half a megabyte on
>    every page load for something the size of a thumbnail.
> 2. Export square PNGs (`icon-192.png`, `icon-512.png`), then update the `icons` array in
>    `site.webmanifest` and the `<link rel="icon">` tags in `index.html`.
>
> `assets/about-dp.jpg` (~350 KB) is worth re-exporting as WebP for the same reason.

---

## 🧱 Tech Stack

- **HTML5** — semantic, single‑page structure.
- **CSS3** — custom properties, grid & flexbox, multi‑column masonry, keyframe animations,
  backdrop filters, `content-visibility` and containment for performance.
- **Vanilla JavaScript** — no frameworks, no dependencies. Uses `IntersectionObserver`,
  `requestAnimationFrame`, `fetch`/`XMLHttpRequest` and the HTML5 `<video>` API.
- **Media backend** — the owner's own Drive‑backed CDN (`cloud-server-eight.vercel.app`) for permanent
  media URLs, image resizing (`?w=`) and resumable video uploads.
- **Google Fonts** — Bebas Neue, DM Sans, Space Mono.

---

## ⚡ Performance Notes

The gallery has to stay smooth with up to 115 media items across the two sections. Every technique
below exists to keep the amount of work proportional to what the visitor can actually see.

> **Animations are never removed for performance.** Hero glows, marquee, cursor and hover reveals
> all stay exactly as designed — the optimisations only *pause* off-screen work and avoid
> re-doing work that was already done.

### Video lifecycle

A card holds the least data it can while still looking finished:

```
  placeholder  →  metadata  →  playing  →  released
  (ratio box)     (dims +      (hover /   (buffer freed once
                   1st frame)   tap)       ~1400px off-screen)
```

- **Lazy loading** — a video's `data-src` becomes `src` only within ~300 px of the viewport.
- **Memory release** — past ~1400 px away, `unloadVid()` detaches the source and frees the decoded
  buffer; it reloads automatically on scroll-back. Layout never shifts, because the wrapper keeps
  its aspect-ratio padding. This is what stops the page degrading after scrolling past many clips.
- **Re-render safety** — `unwireGallery()` detaches old nodes from the observers before a grid is
  rebuilt, so observer references (and memory) don't accumulate across admin edits.

### Avoiding repeated work

- **No duplicate render on load.** The list paints instantly from the `localStorage` mirror, then
  reconciles against the CDN. A content signature is compared first, so the (normal) case of
  "nothing changed" skips the rebuild entirely instead of tearing down and recreating every card.
- **Uploads append, they don't rebuild.** `LaxtMedia.addMany()` adds one card per finished file and
  writes the manifest **once** for the whole batch. Previously each file in a batch triggered a full
  grid teardown plus its own manifest round-trip, so a 10-file upload rebuilt the grid 10 times and
  re-fetched every existing video's metadata — the main cause of post-upload lag.
- **Aspect ratios are known before paint.** The grid is CSS multi-column masonry, so changing one
  card's height re-balances every column. Ratios therefore come from `w`/`h` recorded in the
  manifest at upload time, with a `laxtline_ratios` localStorage fallback for older media. Any
  ratio that still has to be measured is applied in a batched `requestAnimationFrame` flush, so N
  metadata events cost one layout pass instead of N.

### Network

- **Responsive images** — grid photos ship a `srcset` (400–1600 px) with `sizes` matching the column
  counts, so a phone downloads a ~400 px file instead of a fixed 1200 px one. The fullscreen viewer
  loads the original.
- **`preconnect` to the media CDN** — opens DNS/TCP/TLS before the first card asks for media.
- **Hero image preload** with `fetchpriority="high"` — it is the LCP element.
- **Cache headers** — see `vercel.json` / `_headers`. Deliberately short for CSS/JS: there is no
  build step, so filenames are not content-hashed and a long cache would pin visitors to stale code.

### Rendering

- **Off-screen work is paused** — hero canvas, glows and marquee stop when scrolled away or when the
  browser tab is hidden.
- **Containment** — `contain: layout style` on gallery cards isolates their layout and paint.
- **No dead CSS** — every class in the stylesheets is reachable from the markup (verified; the
  old Work-section triptych, testimonials and contact-form rules were removed after the sections
  themselves were replaced).

---

## 🔒 Security

### Known issue: the CDN key is public

`index.html` ships `window.LAXT_CDN.key` to every visitor. It has to be there for the admin panel
to upload and delete — but *everything* in a static site's JavaScript is readable. Anyone can open
View Source (or DevTools → Network) and copy it.

With that key, someone can call the CDN's upload and delete endpoints directly against the two
Drive folder IDs, which are also in the page. **The admin login does not prevent this** — it only
hides the UI. All the checks in `js/06-admin.js` and the `requireAdmin()` gate in
`js/05-media-engine.js` run inside the visitor's own browser, so they can be skipped entirely
(setting `localStorage.laxtline_admin_session = '1'` is enough to open the panel).

This is not something that can be fixed inside this repository. The fix belongs on the CDN:

1. **Stop accepting the key from browsers.** Keep it server-side only.
2. **Split read from write.** Public page load should use unauthenticated read-only endpoints
   (`/api/media/<id>`, `/api/share/<folderId>`). Only upload/delete should need credentials.
3. **Authenticate writes on the server** — a login endpoint that sets an HttpOnly session cookie, or
   short-lived signed upload URLs issued only after a real server-side login.
4. **Rotate the current key** once the above is in place; treat the one in git history as burned.

### What was hardened here

- Admin credentials are no longer plaintext in the source. They are stored as a salted SHA-256
  digest (`CRED_SALT` / `CRED_HASH` in `js/06-admin.js`) and compared via `crypto.subtle`. This
  stops casual credential harvesting from View Source — which matters mainly because people reuse
  passwords — but it is **obfuscation, not authentication**. A 4-digit PIN is also brute-forceable
  in milliseconds; use a longer passphrase and recompute the digest:

  ```js
  sha256(CRED_SALT + ':' + username + ':' + password)
  ```

- Security headers are set on all responses (`vercel.json`, `_headers`): `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.
- Untrusted strings (CDN filenames, categories) are HTML-escaped before entering `innerHTML` in
  `04-gallery-video.js`, `05-media-engine.js` and `06-admin.js`.

### Recommended next

- **Content-Security-Policy** is not set. Adding one is worthwhile but needs care: the page uses
  inline `<script>`/`<style>` blocks and `document.write`, so a strict policy will break it without
  either nonces or a refactor.
- Anything genuinely private should never be committed — this is a public repo.

---

## 🛠 Editing Guide

- **Update portfolio media:** don't touch the code — click the gear icon (top‑right), log in, and
  use the Media Manager to upload / delete / reorder. Changes go live instantly on all devices.
- **Change styling:** edit `css/main.css` (general look) or `css/gallery.css` (gallery & viewer) or
  `css/admin.css` (admin panel). Brand colors live in `:root` at the top of `main.css`.
- **Change behaviour:** edit the relevant file in `js/` (each has a header explaining its job).
- **Change CDN folders / limits:** edit the `window.LAXT_CDN` config block in `index.html`'s head.

---

## 🏷 Branding Note

The visible brand name is **LAXTLINE** (shown in the nav, hero watermark, footer and titles, with the
"LINE" half accented in brand red). The following are **real account links / contact details** and are
intentionally left unchanged so they keep working — update them only with your own new handles:

- Social usernames in the Socials section (Instagram, LinkedIn, GitHub, YouTube, Snapchat, etc.)
- The Google Drive link
- Email & phone in the Contact section

---

## 📬 Contact

- **Email:** suryakant321pradhan@gmail.com
- **Phone:** +91 78480 03467
- **Location:** Bhubaneswar, Odisha, India

---

© 2025–2026 LAXTLINE Studio. All Rights Reserved.
