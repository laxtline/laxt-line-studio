/* =====================================================================
   LAXTLINE — js/05-media-engine.js
   ---------------------------------------------------------------------
   SMART DYNAMIC MEDIA ENGINE

   Renders both galleries (#projectGalleryGrid = "gallery",
   #galleryGrid = "allprojects") from the owner's Drive-backed CDN.

     • Source of truth : a CDN folder per section (cross-device, permanent).
                         A small manifest.json in each folder stores the
                         ORDER + metadata (id, type, name, cat).
     • Fast paint      : localStorage mirror (laxtline_gallery /
                         laxtline_allprojects) paints instantly, then the
                         CDN listing reconciles it.
     • Type detection  : from MIME first, else file extension. Videos and
                         images NEVER cross-apply logic.
     • Ratio           : detected client-side from real media dimensions by
                         js/04-gallery-video.js (applyRatio) — no cropping.
     • Re-render       : window.reinitGallery() re-wires playback/lightbox.

   Public admin API (used by js/06-admin.js): window.LaxtMedia
     .get / .refresh / .add / .remove / .reorder / .setSelection /
     .listFolder / .setMeta / .count / .limit
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.LAXT_CDN;
  if (!CFG) { console.error('[Media] LAXT_CDN config missing — media engine disabled.'); return; }

  const MANIFEST_NAME = 'manifest.json';
  const SMALL_MAX     = 4 * 1024 * 1024;                 // <=4MB → simple upload
  const IMAGE_EXT     = ['jpg','jpeg','png','webp','gif','avif'];
  const VIDEO_EXT     = ['mp4','webm','mov','m4v','ogv'];
  const FOLDER_MIME   = 'application/vnd.google-apps.folder';

  const state = { gallery: [], allprojects: [] };

  // Admin session gate. Mutations (add/remove/reorder/setMeta) are only allowed
  // for a logged-in admin. This is a client-side gate — it stops trivial console
  // abuse of window.LaxtMedia by visitors. (The key itself is public by design;
  // real enforcement would require the CDN to verify a token server-side.)
  const ADMIN_SESSION_KEY = 'laxtline_admin_session';
  function requireAdmin() {
    if (localStorage.getItem(ADMIN_SESSION_KEY) !== '1') {
      throw new Error('Not authorized — admin login required.');
    }
  }

  // ── helpers ──────────────────────────────────────────────────────
  const stripExt  = n => (n || '').replace(/\.[^.]+$/, '');
  const escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function detectType(mime, name) {
    if (mime) {
      if (mime.indexOf('video/') === 0) return 'video';
      if (mime.indexOf('image/') === 0) return 'photo';
    }
    const ext = (name || '').split('.').pop().toLowerCase();
    if (VIDEO_EXT.indexOf(ext) !== -1) return 'video';
    if (IMAGE_EXT.indexOf(ext) !== -1) return 'photo';
    return 'photo';
  }
  const mediaUrl  = id => CFG.base + '/api/media/' + id;
  // Sized image URL for the grid (fast). Full-res is used by the fullscreen viewer.
  const imgUrl    = (id, w) => mediaUrl(id) + (w ? '?w=' + w : '');

  // ── Responsive image sources ────────────────────────────────────────
  // The grid used to request a fixed ?w=1200 for every card on every device.
  // A phone renders those cards about 360px wide, so it was downloading
  // roughly 11x more pixels than it could display — the single biggest cause
  // of slow gallery loading on mobile data.
  //
  // srcset offers the browser several widths; sizes tells it how wide the slot
  // actually is, so it picks the smallest file that still looks sharp (and
  // accounts for device pixel ratio on its own).
  // Which of these rungs a visitor is offered depends on their connection —
  // js/00-net-quality.js drops the large ones on a slow link, so the browser
  // cannot pick a 1600px file over 3G. Without that file loaded, all rungs are
  // offered exactly as before.
  const IMG_WIDTHS = [400, 600, 900, 1200, 1600];
  const netWidths  = () => (window.LaxtNet ? window.LaxtNet.imgWidths(IMG_WIDTHS) : IMG_WIDTHS);
  const netWidth   = w  => (window.LaxtNet ? window.LaxtNet.imgWidth(w) : w);
  const imgSrcset  = id => netWidths().map(w => imgUrl(id, w) + ' ' + w + 'w').join(', ');
  // Mirrors the column counts in css/gallery.css: 3 columns by default,
  // 2 below 1100px, 1 below 820px.
  const IMG_SIZES  = '(max-width: 820px) 92vw, (max-width: 1100px) 46vw, 31vw';

  // ── Video posters ───────────────────────────────────────────────────
  // Passing ?w= to a VIDEO id makes the CDN return a JPEG frame rather than
  // video bytes. That is the difference between a card showing something
  // immediately and a card staying black until enough of a multi-megabyte MP4
  // has streamed in just to render one frame. Measured on this library: a 15.2
  // MB clip yields a 64 KB poster.
  //
  // <video poster> takes a single URL (no srcset), so this is one middle-ground
  // width that stays sharp on a phone yet stays small. The poster is only ever
  // a stand-in — once the real video has a frame to paint, the browser drops it.
  //
  // The width itself is now chosen per visitor: 360 on a slow link (a ~15KB
  // JPEG, and on that tier the poster is ALL a card shows until it is tapped),
  // 600 normally, 900 on a fast one. See js/00-net-quality.js.
  const POSTER_W   = 600;
  const netPosterW = () => (window.LaxtNet ? window.LaxtNet.posterWidth() : POSTER_W);
  const posterUrl  = id => imgUrl(id, netPosterW());

  const cdnFetch = (path, opts) => {
    opts = opts || {};
    opts.headers = Object.assign({ 'x-api-key': CFG.key }, opts.headers || {});
    return fetch(CFG.base + path, opts);
  };

  // ── Aspect-ratio memory ────────────────────────────────────────────
  // Cards are laid out with padding-bottom (a % of their width), and the grid
  // is CSS multi-column masonry — so changing one card's height rebalances
  // every column. If the ratio is only discovered when a video's metadata
  // arrives, N items cause up to N full-grid reflows, trickling in as the
  // network responds. That is the gallery's main source of scroll jank.
  //
  // Two layers avoid it, cheapest first:
  //   1. w/h stored in the manifest at upload time — every visitor gets the
  //      right ratio on first paint.
  //   2. a localStorage mirror keyed by media id, filled in by applyRatio() —
  //      covers media uploaded before w/h was recorded.
  const RATIO_KEY = 'laxtline_ratios';
  let _ratioCache = null;
  function ratioCache() {
    if (_ratioCache) return _ratioCache;
    try {
      const raw = localStorage.getItem(RATIO_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      _ratioCache = (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { _ratioCache = {}; }
    return _ratioCache;
  }
  // Called by js/04-gallery-video.js once real media dimensions are known.
  function rememberRatio(id, w, h) {
    if (!id || !w || !h) return;
    const c = ratioCache();
    const pct = +(h / w * 100).toFixed(4);
    if (c[id] === pct) return;                 // no change → no write
    c[id] = pct;
    try { localStorage.setItem(RATIO_KEY, JSON.stringify(c)); } catch (e) {}
  }
  // Height as a % of width, or null when still unknown.
  function ratioPct(item) {
    if (item.w && item.h) return +(item.h / item.w * 100).toFixed(4);
    const cached = ratioCache()[item.id];
    return typeof cached === 'number' ? cached : null;
  }

  // ── localStorage mirror (instant paint before the network responds) ──
  function loadCache(section) {
    try {
      const raw = localStorage.getItem(CFG.storeKeys[section]);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveCache(section) {
    try { localStorage.setItem(CFG.storeKeys[section], JSON.stringify(state[section])); } catch (e) {}
  }

  // ── Manifest: ORDER + metadata, stored as a small JSON file inside the folder. ──
  // Return ALL manifest file ids in a folder (there can be stray duplicates if a
  // past write raced; we keep the newest and clean up the rest).
  // `files` is an already-fetched listing of the folder. fetchSection() has one
  // in hand, and re-requesting the same endpoint just to find the manifest cost
  // a second full round-trip on every single page load. Callers without a
  // listing (the manifest writer) omit it and we fetch as before.
  async function listManifestIds(section, files) {
    const folder = CFG.folders[section];
    try {
      let list = files;
      if (!list) {
        const r = await cdnFetch('/api/files?parent=' + folder);
        if (!r.ok) return [];
        list = await r.json();
      }
      return (list || [])
        .filter(f => f.name === MANIFEST_NAME)
        .sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || '')) // newest first
        .map(f => f.id);
    } catch (e) { return []; }
  }

  async function readManifest(section, files) {
    const ids = await listManifestIds(section, files);
    if (!ids.length) return null;
    try {
      // No cache-buster needed: doWriteManifest() uploads a NEW file and deletes
      // the old one, so a changed manifest always has a different id — and
      // therefore a different URL. The id itself comes from the fresh listing
      // above. Letting this response cache turns a repeat visit's manifest
      // fetch into a free 304 instead of a full download.
      const mr = await fetch(mediaUrl(ids[0]));
      if (!mr.ok) return null;
      const data = await mr.json();
      return Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
    } catch (e) { return null; }
  }

  // Per-section serialization: manifest writes are read-modify-write against a
  // single file, so concurrent writes (rapid reorders/deletes) would race and
  // spawn duplicate manifests. Chain them so each write is atomic.
  const _writeQueue = { gallery: Promise.resolve(), allprojects: Promise.resolve() };
  function writeManifest(section) {
    const run = _writeQueue[section].then(() => doWriteManifest(section), () => doWriteManifest(section));
    // Keep the chain alive even if this write rejects (caller still sees the rejection).
    _writeQueue[section] = run.catch(() => {});
    return run;
  }

  // Upload-then-delete: never leave the folder without a manifest. Snapshot the
  // existing ids FIRST, upload the new manifest, then delete the old ones only
  // after the new upload is confirmed.
  async function doWriteManifest(section) {
    const folder   = CFG.folders[section];
    const staleIds = await listManifestIds(section);
    // w/h are optional extras — manifests written before they existed still
    // parse fine, and readers that don't know about them simply ignore them.
    const payload  = state[section].map(it => ({
      id: it.id, type: it.type, name: it.name, cat: it.cat, w: it.w || 0, h: it.h || 0
    }));
    const blob     = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    const fd = new FormData();
    fd.append('file', blob, MANIFEST_NAME);
    fd.append('parent', folder);
    const r = await cdnFetch('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Manifest write failed (' + r.status + ')');
    const created = await r.json();

    // New manifest is live — now remove the old ones (best-effort).
    for (const id of staleIds) {
      if (id === created.id) continue;
      try { await cdnFetch('/api/files/' + id, { method: 'DELETE' }); } catch (e) {}
    }
    return created;
  }

  // ── List every real media file in a folder (manifest stripped). Shared by
  //    fetchSection() and the admin Drive picker (LaxtMedia.listFolder). ──
  async function fetchFolderMedia(section) {
    const folder = CFG.folders[section];
    let files = [];
    try {
      const r = await cdnFetch('/api/files?parent=' + folder);
      if (r.ok) files = await r.json();
      else return null;
    } catch (e) { return null; }

    const media = (files || [])
      .filter(f => f.mimeType !== FOLDER_MIME && f.name !== MANIFEST_NAME)
      .map(f => {
        // Drive already reports real pixel dimensions for both videos and
        // images, and this listing is fetched before anything is rendered.
        // Using them means every card is laid out at its true aspect ratio on
        // first paint — no 16:9 placeholder that snaps once metadata arrives,
        // and no masonry re-balance. Previously these fields were discarded and
        // the ratio was re-derived in the browser by downloading each file's
        // metadata, which is both slower and a source of layout shift.
        const meta = f.videoMediaMetadata || f.imageMediaMetadata || null;
        return {
          id:   f.id,
          type: detectType(f.mimeType, f.name),
          name: stripExt(f.name),
          cat:  '',
          mime: f.mimeType || '',
          w:    meta && meta.width  ? meta.width  : 0,
          h:    meta && meta.height ? meta.height : 0
        };
      });

    // Hand back the raw listing too, so callers can read the manifest from it
    // without paying for a second identical /api/files round-trip.
    return { media: media, files: files };
  }

  // ── Reconcile: the manifest is the SELECTION + ORDER source of truth. Only
  //    files listed in it are shown publicly, in exactly its order. Files an
  //    admin dropped in the Drive folder but hasn't selected stay invisible;
  //    a folder with no manifest yet shows nothing (nothing curated). ──
  async function fetchSection(section) {
    const res = await fetchFolderMedia(section);
    if (!res) return null;
    const media = res.media;

    // Reuses the listing above instead of re-requesting the same endpoint.
    const manifest = await readManifest(section, res.files);
    // No manifest (fresh folder) or a failed read → don't clobber the cached
    // grid; nothing is curated yet, so a brand-new folder simply stays empty.
    if (!manifest) return null;

    const byId = {};
    media.forEach(m => { byId[m.id] = m; });
    const ordered = [];
    manifest.forEach(mItem => {
      const real = byId[mItem.id];
      if (!real) return;                 // selected file was deleted from Drive → skip
      real.name = mItem.name || real.name;
      real.cat  = mItem.cat  || real.cat;
      if (mItem.type) real.type = mItem.type;
      // Only fall back to the manifest's recorded size when Drive didn't
      // report one. Drive's numbers come from the actual stored file and
      // are authoritative; the manifest's were measured in a browser at
      // upload time and can disagree (e.g. rotated phone video).
      if (!(real.w && real.h) && mItem.w && mItem.h) { real.w = mItem.w; real.h = mItem.h; }
      ordered.push(real);
    });
    return ordered;                      // empty when nothing selected — intentional
  }

  // ── Card markup — matches the structure js/04-gallery-video.js expects,
  //    so its playback / ratio / lightbox logic works unchanged. ──
  let _vidSeq = 0;
  const MUTE_SVGS =
    '<svg class="icon-muted" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="display:none"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white"/><line x1="15" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="15" y2="15"/></svg>' +
    '<svg class="icon-sound" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white"/><path d="M15.5 8.5 Q19 12 15.5 15.5" fill="none"/><path d="M18 6 Q23 12 18 18" fill="none"/></svg>';

  // MIME for a <source type>. Prefer the stored mime; else map the extension.
  // Wrong type hints make the browser refuse to decode (e.g. webm bytes as mp4).
  const VIDEO_MIME = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', m4v:'video/x-m4v', ogv:'video/ogg' };
  function videoMime(item) {
    if (item.mime && item.mime.indexOf('video/') === 0) return item.mime;
    const ext = (item.name || '').split('.').pop().toLowerCase();
    return VIDEO_MIME[ext] || 'video/mp4';
  }

  function buildCard(item) {
    const name = escapeHtml(item.name || '');
    const cat  = escapeHtml(item.cat  || '');
    const full = mediaUrl(item.id);            // full-res → fullscreen viewer

    const card = document.createElement('div');
    card.className = 'gal-item';
    card.dataset.type    = item.type;
    card.dataset.fsType  = item.type;
    card.dataset.fsSrc   = full;
    card.dataset.fsCat   = item.cat  || '';
    card.dataset.fsName  = item.name || '';
    card.dataset.mediaId = item.id;

    // Paint at the real aspect ratio straight away when we know it, so the
    // masonry never has to re-balance once media metadata lands. Falls back to
    // the stylesheet's 16:9 placeholder when the ratio is genuinely unknown.
    const pct = ratioPct(item);
    const wrapStyle = pct ? ' style="padding-bottom:' + pct + '%"' : '';
    if (pct) card.dataset.ratioKnown = '1';

    if (item.type === 'video') {
      const vid = 'dv' + (++_vidSeq);
      // The fullscreen viewer paints this while the video negotiates its first
      // frame, instead of opening onto a black rectangle.
      card.dataset.fsPoster = posterUrl(item.id);
      card.innerHTML =
        '<div class="gal-media-wrap"' + wrapStyle + '>' +
          // data-poster (not poster): a hardcoded poster= attribute makes the
          // browser fetch that JPEG the instant the element is parsed — for
          // EVERY card in both grids at once on page load, which stalls the
          // first paint. applyPoster() in js/04-gallery-video.js promotes this
          // to a real poster from the same lazy observer that loads the video,
          // so offscreen cards cost nothing until they approach the viewport.
          '<video class="gal-video" id="' + vid + '" loop playsinline preload="' +
            (window.LaxtNet ? window.LaxtNet.videoPreload() : 'metadata') + '" muted' +
            ' data-poster="' + posterUrl(item.id) + '"' +
            ' decoding="async">' +
            '<source data-src="' + full + '" type="' + videoMime(item) + '">' +
          '</video>' +
          '<div class="gal-overlay"></div>' +
          '<div class="vid-thumb-overlay"><svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div>' +
          '<div class="gal-play-btn"><svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div>' +
          '<div class="gal-bottom"><div class="gal-info"><span class="gal-cat">' + cat + '</span><span class="gal-name">' + name + '</span></div>' +
            '<button class="gal-mute-btn" title="Mute/Unmute">' + MUTE_SVGS + '</button></div>' +
        '</div>';
    } else {
      card.innerHTML =
        '<div class="gal-media-wrap"' + wrapStyle + '>' +
          '<img decoding="async" class="gal-photo" loading="lazy"' +
            ' src="' + imgUrl(item.id, netWidth(900)) + '"' +
            ' srcset="' + imgSrcset(item.id) + '"' +
            ' sizes="' + IMG_SIZES + '"' +
            ' alt="' + name + '">' +
          '<div class="gal-overlay"></div>' +
          '<div class="gal-bottom"><div class="gal-info"><span class="gal-cat">' + cat + '</span><span class="gal-name">' + name + '</span></div></div>' +
        '</div>';
    }
    return card;
  }

  const gridEl  = section => document.getElementById(section === 'gallery' ? 'projectGalleryGrid' : 'galleryGrid');
  const emptyEl = section => document.getElementById(section === 'gallery' ? 'galleryEmpty' : 'allprojectsEmpty');

  // What is currently on screen, per section. A full render is a teardown of
  // every card (and every <video>, whose metadata then has to be re-fetched),
  // so it must only happen when the content has actually changed.
  const _renderedSig = { gallery: null, allprojects: null };
  const signature = items => items
    .map(it => [it.id, it.type, it.name, it.cat, it.w || 0, it.h || 0].join('~'))
    .join('|');

  function announce(section, count) {
    // Notify the admin panel so it can refresh its list + counts.
    document.dispatchEvent(new CustomEvent('laxt:media-rendered', { detail: { section: section, count: count } }));
  }

  // force=true bypasses the no-op check (nothing needs it today; it exists so a
  // caller that mutates cards out-of-band can still demand a rebuild).
  function render(section, force) {
    const grid = gridEl(section);
    if (!grid) return;
    const items = state[section];

    // init() paints from the localStorage mirror, then refresh() reconciles
    // against the CDN — which normally returns exactly what was already shown.
    // Without this check every page load rebuilt both grids a second time for
    // no visible change.
    const sig = signature(items);
    if (!force && _renderedSig[section] === sig) { announce(section, items.length); return; }

    // Detach old cards' videos from the IntersectionObservers before clearing,
    // else the singleton observers keep references to detached nodes → memory leak
    // that grows with every re-render (reorder fires one per click).
    if (window.unwireGallery) window.unwireGallery(grid);
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach(it => frag.appendChild(buildCard(it)));
    grid.appendChild(frag);
    _renderedSig[section] = sig;

    const empty = emptyEl(section);
    if (empty) empty.hidden = items.length > 0;

    // Re-wire playback / ratio / lightbox on the freshly injected cards.
    if (window.reinitGallery) window.reinitGallery(grid);

    // Eagerly load the first 4 cards — they are almost certainly above the fold
    // and the IntersectionObserver won't fire for them until the page settles.
    // This closes the gap between "grid painted" and "first poster visible".
    const EAGER = 4;
    const eagerVids = grid.querySelectorAll('video.gal-video');
    for (let i = 0; i < Math.min(EAGER, eagerVids.length); i++) {
      if (window.loadVidEager) window.loadVidEager(eagerVids[i]);
    }

    announce(section, items.length);
  }

  // ── Append a single new card without touching the existing ones. ──
  // Uploading used to call render(), which tore down and rebuilt the whole
  // grid — once per file in a batch — reloading every video's metadata each
  // time. Appending keeps every already-wired card exactly as it is.
  function appendCard(section, item) {
    const grid = gridEl(section);
    if (!grid) return;
    const card = buildCard(item);
    grid.appendChild(card);
    _renderedSig[section] = signature(state[section]);

    const empty = emptyEl(section);
    if (empty) empty.hidden = state[section].length > 0;

    if (window.reinitGallery) window.reinitGallery(card);
    announce(section, state[section].length);
  }

  // ── Refresh a section from the CDN and re-render. Returns the item list. ──
  async function refresh(section) {
    const items = await fetchSection(section);
    if (items) {
      state[section] = items;
      saveCache(section);
      render(section);
    }
    return state[section];
  }

  // ══════════════════════════════════════════════════════════════
  //  ADMIN API  (window.LaxtMedia) — used by js/06-admin.js
  //  Read methods (get/count/limit/refresh) are open. Mutating methods
  //  (add/remove/reorder/setMeta) call requireAdmin() first, so a
  //  logged-out visitor cannot drive them from the console.
  // ══════════════════════════════════════════════════════════════
  const LaxtMedia = {
    get:   section => state[section].slice(),
    count: section => state[section].length,
    limit: section => CFG.limits[section],
    refresh: refresh,

    // Called by js/04-gallery-video.js when it detects real media dimensions,
    // so media uploaded before w/h was recorded still paints at the right
    // ratio on the next visit. Read-only for visitors — no admin gate.
    rememberRatio: rememberRatio,

    // Upload one File → CDN, append its card, persist the manifest.
    // onProgress(0..1) is optional. Kept for API compatibility; delegates to
    // addMany so single and batch uploads follow exactly one code path.
    async add(section, file, onProgress) {
      const results = await LaxtMedia.addMany(section, [file], p => {
        if (onProgress) onProgress(p.fraction);
      });
      if (results[0] && results[0].error) throw results[0].error;
      return results[0] && results[0].item;
    },

    // Upload a batch. One manifest write for the whole batch (it is a
    // read-modify-write against a single CDN file, so doing it per file meant
    // N sequential round-trips), and each finished file is appended as a single
    // card instead of re-rendering the entire grid.
    //
    // onProgress({ index, total, fraction, file }) — fraction is 0..1 for the
    // file currently uploading. Returns [{ file, item, error }] in input order;
    // a failed file does not abort the rest of the batch.
    async addMany(section, files, onProgress) {
      requireAdmin();
      const list    = Array.prototype.slice.call(files || []);
      const results = [];
      let   appended = 0;

      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const report = f => { if (onProgress) onProgress({ index: i, total: list.length, fraction: f, file: file }); };
        try {
          if (state[section].length >= CFG.limits[section]) {
            throw new Error('Limit reached (' + CFG.limits[section] + ')');
          }
          const type = detectType(file.type, file.name);
          if (type !== 'video' && type !== 'photo') throw new Error('Unsupported file type');

          report(0);
          // Measure before uploading — the local File is already in memory, and
          // knowing w/h means the new card never causes a masonry reflow.
          const dim = await probeDimensions(file, type);

          const uploaded = file.size > SMALL_MAX
            ? await uploadLarge(section, file, f => report(f))
            : await uploadSmall(section, file, f => report(f));

          const item = {
            id:   uploaded.id,
            type: detectType(uploaded.mimeType || file.type, uploaded.name || file.name),
            name: stripExt(uploaded.name || file.name),
            cat:  '',
            mime: uploaded.mimeType || file.type || '',
            w:    dim.w,
            h:    dim.h
          };
          state[section].push(item);
          if (item.w && item.h) rememberRatio(item.id, item.w, item.h);
          saveCache(section);
          appendCard(section, item);
          appended++;
          report(1);
          results.push({ file: file, item: item, error: null });
        } catch (err) {
          results.push({ file: file, item: null, error: err });
        }
      }

      // Persist order once, after the whole batch. The files are already
      // uploaded; a failed manifest write only loses ordering, which the next
      // refresh() re-appends.
      if (appended) {
        await writeManifest(section).catch(e => console.warn('[Media] manifest write failed:', e));
      }
      return results;
    },

    // Delete by CDN id → remove from folder + manifest, re-render.
    async remove(section, id) {
      requireAdmin();
      const r = await cdnFetch('/api/files/' + id, { method: 'DELETE' });
      // Check the response: a swallowed failure drops the item from state while
      // it still exists on the CDN, so it reappears on the next refresh().
      if (!r.ok) throw new Error('Delete failed (' + r.status + ')');
      state[section] = state[section].filter(it => it.id !== id);
      saveCache(section);
      await writeManifest(section);
      render(section);
    },

    // Move an item within the section (reorder), persist new order.
    // Persist BEFORE re-render so a failed write can revert to the CDN truth.
    async reorder(section, fromIdx, toIdx) {
      requireAdmin();
      const arr = state[section];
      if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length) return;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      saveCache(section);
      render(section);
      try {
        await writeManifest(section);
      } catch (e) {
        // Order didn't persist — pull the real order back so UI matches the CDN.
        await refresh(section);
        throw e;
      }
    },

    // ── Drive picker support ──────────────────────────────────────────
    // List EVERY media file in the section's Drive folder (not just the
    // selected ones), each tagged with whether it is currently selected and
    // its position in the published order. This is what the admin browses to
    // choose from; the public grid only ever shows the selected subset.
    // Read-only listing, but it exposes the folder contents, so gate it.
    async listFolder(section) {
      requireAdmin();
      const res = await fetchFolderMedia(section);
      if (!res) throw new Error('Could not list folder');
      const manifest = await readManifest(section, res.files) || [];
      const orderById = {};
      manifest.forEach((m, i) => { orderById[m.id] = i; });
      return res.media.map(m => ({
        id: m.id, type: m.type, name: m.name, w: m.w, h: m.h, mime: m.mime,
        selected: orderById[m.id] != null,
        order:    orderById[m.id] != null ? orderById[m.id] : -1
      }));
    },

    // Set the published selection + order for a section from an ordered list
    // of Drive file ids. Ids not present in the folder are dropped. Persists
    // to the manifest (source of truth) and re-renders. Mirrors reorder()'s
    // "persist, and on failure pull the CDN truth back" contract.
    async setSelection(section, orderedIds) {
      requireAdmin();
      const res = await fetchFolderMedia(section);
      if (!res) throw new Error('Could not list folder');
      const byId = {};
      res.media.forEach(m => { byId[m.id] = m; });

      const lim  = CFG.limits[section];
      const seen = {};
      const next = [];
      (orderedIds || []).forEach(id => {
        if (seen[id] || !byId[id]) return;   // de-dupe + drop unknown/deleted ids
        seen[id] = true;
        if (next.length >= lim) return;       // respect the section cap
        next.push(byId[id]);
      });

      state[section] = next;
      saveCache(section);
      render(section);
      try { await writeManifest(section); }
      catch (e) { await refresh(section); throw e; }
      return state[section].slice();
    },

    // Update editable metadata (name / cat) for one item.
    async setMeta(section, id, patch) {
      requireAdmin();
      const it = state[section].find(x => x.id === id);
      if (!it) return;
      if (patch.name != null) it.name = patch.name;
      if (patch.cat  != null) it.cat  = patch.cat;
      saveCache(section);
      render(section);
      try { await writeManifest(section); }
      catch (e) { await refresh(section); throw e; }
    }
  };

  // ── Read a file's real pixel dimensions locally, before it is uploaded. ──
  // Recording these in the manifest is what lets every future visitor paint the
  // card at its true aspect ratio on the first frame. Never rejects: dimensions
  // are an optimisation, so a failure just falls back to runtime detection.
  function probeDimensions(file, type) {
    return new Promise(resolve => {
      let url = null, done = false;
      const finish = (w, h) => {
        if (done) return;
        done = true;
        if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
        resolve({ w: w || 0, h: h || 0 });
      };
      // Don't let a stubborn file hold up the upload queue.
      const timer = setTimeout(() => finish(0, 0), 8000);
      const settle = (w, h) => { clearTimeout(timer); finish(w, h); };

      try {
        url = URL.createObjectURL(file);
        if (type === 'video') {
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.muted = true;
          v.addEventListener('loadedmetadata', () => settle(v.videoWidth, v.videoHeight), { once: true });
          v.addEventListener('error', () => settle(0, 0), { once: true });
          v.src = url;
        } else {
          const img = new Image();
          img.addEventListener('load',  () => settle(img.naturalWidth, img.naturalHeight), { once: true });
          img.addEventListener('error', () => settle(0, 0), { once: true });
          img.src = url;
        }
      } catch (e) { settle(0, 0); }
    });
  }

  // ── Small upload (<=4MB): multipart through the CDN /api/upload. ──
  async function uploadSmall(section, file, onProgress) {
    if (onProgress) onProgress(0.1);
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('parent', CFG.folders[section]);
    const r = await cdnFetch('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Upload failed (' + r.status + ')');
    if (onProgress) onProgress(1);
    return r.json();
  }

  // ── Large upload (>4MB, videos): 2-step resumable session, PUT direct to
  //    Google from the browser with real progress via XHR. ──
  async function uploadLarge(section, file, onProgress) {
    const sr = await cdnFetch('/api/upload/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream', parent: CFG.folders[section] })
    });
    if (!sr.ok) throw new Error('Session failed (' + sr.status + ')');
    const { uploadUrl } = await sr.json();
    if (!uploadUrl) throw new Error('No upload URL returned');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ id: data.id, name: data.name || file.name, mimeType: data.mimeType || file.type });
          } catch (e) { reject(new Error('Bad session response')); }
        } else { reject(new Error('Direct upload failed (' + xhr.status + ')')); }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    });
  }

  window.LaxtMedia = LaxtMedia;

  // ── INIT: paint from cache instantly, then reconcile from the CDN. ──
  function init() {
    ['gallery', 'allprojects'].forEach(section => {
      const cached = loadCache(section);
      if (cached.length) { state[section] = cached; render(section); }
      else { const e = emptyEl(section); if (e) e.hidden = false; }
      refresh(section);   // network reconcile (fire and forget)
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
