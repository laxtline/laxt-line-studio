/* =====================================================================
   LAXTLINE — js/06-admin.js
   ---------------------------------------------------------------------
   HIDDEN ADMIN + UPLOAD PANEL

     • A small inconspicuous icon (top-right) opens a login modal.
     • Credentials: surya / 9938. Session persists in localStorage.
     • The Upload Panel DOM is BUILT ONLY AFTER a successful login — it
       never exists in the page for logged-out visitors, so nothing
       leaks in DevTools.
     • Two independent zones: Project Gallery (max 15) and All Projects
       (max 100), each with live count, upload, delete and reorder.
     • All media operations go through window.LaxtMedia (05-media-engine).

   NOTE: credentials here are a lightweight owner-only gate for a static
   site, not real server auth. The CDN key lives client-side by design
   (owner's own CDN); anyone determined can read it — rotate the key if
   the site is shared publicly.
   ===================================================================== */
(function () {
  'use strict';

  const SESSION_KEY = 'laxtline_admin_session';

  // ── Credentials ────────────────────────────────────────────────────
  // Stored as a salted SHA-256 digest rather than plaintext. To be clear about
  // what this does and does not buy on a static site:
  //
  //   IT DOES  stop the username/password being read straight out of View
  //            Source. That matters mainly because people reuse passwords.
  //   IT DOES NOT authenticate anything. All the checks here run in the
  //            visitor's own browser, so anyone can skip them entirely — e.g.
  //            by setting the session flag in localStorage by hand. The upload
  //            and delete calls are only really protected by the CDN key, which
  //            also ships to the browser (see SECURITY in README.md).
  //
  // Genuine protection has to live on the server that holds the CDN key.
  // To change the password: recompute the digest below with
  //   sha256(CRED_SALT + ':' + username + ':' + password)
  const CRED_SALT = 'laxtline-admin-v1';
  const CRED_HASH = 'e35c9f946d2218777d6dc5339db7c36e5434eddbadb6f4752b31ab41d1bacb17';

  async function sha256Hex(str) {
    const bytes  = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  async function credsMatch(user, pass) {
    try { return (await sha256Hex(CRED_SALT + ':' + user + ':' + pass)) === CRED_HASH; }
    catch (e) { return false; }   // crypto.subtle needs a secure context (https/localhost)
  }
  const SECTIONS = [
    { key: 'gallery',     label: 'Project Gallery' },
    { key: 'allprojects', label: 'All Projects' }
  ];

  const isLoggedIn = () => localStorage.getItem(SESSION_KEY) === '1';

  // Escape media names before they go into the admin row's innerHTML (attribute
  // + text). Filenames come from the CDN and could contain " or < > payloads.
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // ── Inconspicuous trigger icon (top-right) ──
  function buildTrigger() {
    const btn = document.createElement('button');
    btn.id = 'adminTrigger';
    btn.className = 'admin-trigger';
    btn.setAttribute('aria-label', 'Admin');
    btn.title = '';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
      '</svg>';
    btn.addEventListener('click', () => { isLoggedIn() ? openPanel() : openLogin(); });
    document.body.appendChild(btn);
  }
  // ── Login modal (built on demand, removed on close) ──
  function openLogin() {
    if (document.getElementById('adminLogin')) return;
    const modal = document.createElement('div');
    modal.id = 'adminLogin';
    modal.className = 'admin-modal';
    modal.innerHTML =
      '<div class="admin-modal-card" role="dialog" aria-modal="true" aria-label="Admin login">' +
        '<button class="admin-modal-close" aria-label="Close">&times;</button>' +
        '<h3 class="admin-modal-title">Admin</h3>' +
        '<form id="adminLoginForm" autocomplete="off">' +
          '<input class="admin-input" id="adminUser" type="text" placeholder="Username" autocomplete="off" spellcheck="false">' +
          '<input class="admin-input" id="adminPass" type="password" placeholder="Password" autocomplete="new-password">' +
          '<div class="admin-error" id="adminError" hidden></div>' +
          '<button class="admin-btn admin-btn-primary" type="submit">Log in</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-in'));

    const close = () => { modal.classList.remove('is-in'); setTimeout(() => modal.remove(), 200); };
    modal.querySelector('.admin-modal-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && document.getElementById('adminLogin')) { close(); document.removeEventListener('keydown', esc); }
    });

    const form = modal.querySelector('#adminLoginForm');
    const err  = modal.querySelector('#adminError');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const u = modal.querySelector('#adminUser').value.trim();
      const p = modal.querySelector('#adminPass').value;
      if (await credsMatch(u, p)) {
        localStorage.setItem(SESSION_KEY, '1');
        close();
        openPanel();
      } else {
        err.textContent = 'Invalid username or password.';
        err.hidden = false;
        modal.querySelector('#adminPass').value = '';
      }
    });
    setTimeout(() => modal.querySelector('#adminUser').focus(), 60);
  }

  // ── Upload panel — built ONLY when logged in (never in DOM otherwise) ──
  function openPanel() {
    if (!isLoggedIn()) { openLogin(); return; }
    if (document.getElementById('adminPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'adminPanel';
    panel.className = 'admin-panel';

    let zonesHtml = '';
    SECTIONS.forEach(s => {
      zonesHtml +=
        '<section class="ap-zone" data-section="' + s.key + '">' +
          '<div class="ap-zone-head">' +
            '<h4 class="ap-zone-title">' + s.label + '</h4>' +
            '<span class="ap-count" id="apCount-' + s.key + '">0 / ' + window.LaxtMedia.limit(s.key) + '</span>' +
          '</div>' +
          '<label class="ap-drop" id="apDrop-' + s.key + '">' +
            '<input type="file" class="ap-file" id="apFile-' + s.key + '" accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.m4v,.mkv,.avi" multiple hidden>' +
            '<span class="ap-drop-text">Drop files or <b>click to upload</b><br><small>JPG · PNG · WEBP · MP4</small></span>' +
          '</label>' +
          '<div class="ap-progress" id="apProgress-' + s.key + '" hidden><div class="ap-progress-bar"></div><span class="ap-progress-label"></span></div>' +
          // ── Drive picker: choose which folder files show on the site + order ──
          '<div class="ap-picker" data-section="' + s.key + '">' +
            '<button class="admin-btn ap-picker-toggle" id="apPickBtn-' + s.key + '">Choose from Drive</button>' +
            '<div class="ap-picker-body" id="apPickBody-' + s.key + '" hidden>' +
              '<div class="ap-picker-hint">Tap files in the order you want them shown, then Save.</div>' +
              '<div class="ap-picker-actions">' +
                '<button class="admin-btn ap-pick-all"   id="apPickAll-'   + s.key + '">Select all</button>' +
                '<button class="admin-btn ap-pick-clear" id="apPickClear-' + s.key + '">Clear</button>' +
                '<span class="ap-pick-count" id="apPickCount-' + s.key + '">0 selected</span>' +
                '<button class="admin-btn admin-btn-primary ap-pick-save" id="apPickSave-' + s.key + '">Save selection</button>' +
              '</div>' +
              '<div class="ap-grid" id="apGrid-' + s.key + '"></div>' +
            '</div>' +
          '</div>' +
          '<div class="ap-list" id="apList-' + s.key + '"></div>' +
        '</section>';
    });

    panel.innerHTML =
      '<div class="ap-inner" role="dialog" aria-modal="true" aria-label="Upload panel">' +
        '<div class="ap-header">' +
          '<span class="ap-title">Media Manager</span>' +
          '<div class="ap-header-btns">' +
            '<button class="admin-btn ap-logout" id="apLogout">Log out</button>' +
            '<button class="ap-close" id="apClose" aria-label="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="ap-body">' + zonesHtml + '</div>' +
      '</div>';
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('is-in'));

    document.getElementById('apClose').addEventListener('click', closePanel);
    document.getElementById('apLogout').addEventListener('click', () => {
      localStorage.removeItem(SESSION_KEY);
      closePanel();
    });
    panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });

    SECTIONS.forEach(s => wireZone(s.key));
    SECTIONS.forEach(s => wirePicker(s.key));
    SECTIONS.forEach(s => { renderList(s.key); updateCount(s.key); });
  }

  function closePanel() {
    const p = document.getElementById('adminPanel');
    if (!p) return;
    p.classList.remove('is-in');
    setTimeout(() => p.remove(), 200);
  }

  const LaxtMediaLimit = key => (window.LaxtMedia ? window.LaxtMedia.limit(key) : 0);

  // All web + master formats a video editor's portfolio needs: WebP/JPG/PNG/GIF/
  // AVIF images, and H.264/H.265/AV1/ProRes/RAW video carried in mp4/webm/mov/mkv.
  const ACCEPT_EXT = ['jpg','jpeg','png','webp','gif','avif','bmp','svg',
                      'mp4','webm','mov','m4v','ogv','mkv','avi','hevc','av1'];
  const isAccepted = file => {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return ACCEPT_EXT.indexOf(ext) !== -1 ||
           (file.type && (file.type.indexOf('image/') === 0 || file.type.indexOf('video/') === 0));
  };

  // ── Wire one zone: file picker, drag-and-drop, overflow guard, upload ──
  function wireZone(key) {
    const drop  = document.getElementById('apDrop-' + key);
    const input = document.getElementById('apFile-' + key);
    if (!drop || !input) return;

    input.addEventListener('change', () => { handleFiles(key, input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-drag'); }));
    drop.addEventListener('drop', e => {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(key, e.dataTransfer.files);
    });
  }

  // ── Drive picker: pick which folder files appear on the site, and in what
  //    order. Selection order = click order (a tile tapped first gets badge 1),
  //    which is exactly the sequence the public grid renders. Persisted via
  //    LaxtMedia.setSelection → manifest, so every visitor sees the same set. ──
  // clickOrder[key] holds the currently-selected ids in the order they were
  // chosen. It is the single source of truth for both the badges and the save.
  const clickOrder = {};

  function wirePicker(key) {
    const btn = document.getElementById('apPickBtn-' + key);
    if (!btn) return;
    const body = document.getElementById('apPickBody-' + key);

    btn.addEventListener('click', async () => {
      const opening = body.hidden;
      body.hidden = !opening;
      btn.classList.toggle('is-open', opening);
      if (opening) await loadPicker(key);   // fetch fresh listing each open
    });

    document.getElementById('apPickAll-'   + key).addEventListener('click', () => selectAll(key));
    document.getElementById('apPickClear-' + key).addEventListener('click', () => clearSel(key));
    document.getElementById('apPickSave-'  + key).addEventListener('click', () => saveSel(key));
  }

  // Fetch the folder's full file list and paint the tile grid, pre-selecting
  // whatever is already published (in its published order).
  async function loadPicker(key) {
    const grid = document.getElementById('apGrid-' + key);
    if (!grid || !window.LaxtMedia) return;
    grid.innerHTML = '<div class="ap-empty">Loading…</div>';
    let files;
    try { files = await window.LaxtMedia.listFolder(key); }
    catch (e) { grid.innerHTML = '<div class="ap-empty">Could not load folder.</div>'; toast('Load failed: ' + (e.message || 'error')); return; }

    // Seed click-order from what is already selected, in its saved order.
    clickOrder[key] = files.filter(f => f.selected)
      .sort((a, b) => a.order - b.order)
      .map(f => f.id);

    grid.innerHTML = '';
    if (!files.length) { grid.innerHTML = '<div class="ap-empty">Folder is empty. Upload to Drive first.</div>'; updatePickCount(key); return; }

    const base = window.LAXT_CDN.base;
    files.forEach(f => {
      const tile = document.createElement('button');
      tile.className = 'ap-tile';
      tile.dataset.id = f.id;
      // Both photos and videos return a JPEG frame when a ?w= is passed.
      tile.innerHTML =
        '<img class="ap-tile-thumb" loading="lazy" src="' + base + '/api/media/' + f.id + '?w=160" alt="">' +
        (f.type === 'video' ? '<span class="ap-tile-vid">▶</span>' : '') +
        '<span class="ap-tile-badge"></span>' +
        '<span class="ap-tile-name" title="' + esc(f.name || '') + '">' + esc(f.name || '') + '</span>';
      tile.addEventListener('click', () => toggleTile(key, f.id));
      grid.appendChild(tile);
    });
    paintBadges(key);
  }

  // Toggle one tile's membership in the click-order list.
  function toggleTile(key, id) {
    const arr = clickOrder[key] || (clickOrder[key] = []);
    const at  = arr.indexOf(id);
    if (at === -1) {
      const lim = LaxtMediaLimit(key);
      if (arr.length >= lim) { toast('Limit reached: ' + lim + ' files max for this section.'); return; }
      arr.push(id);
    } else {
      arr.splice(at, 1);
    }
    paintBadges(key);
  }

  function selectAll(key) {
    const grid = document.getElementById('apGrid-' + key);
    if (!grid) return;
    const lim = LaxtMediaLimit(key);
    // Add every not-yet-selected tile in the order shown, up to the cap.
    const arr = clickOrder[key] || (clickOrder[key] = []);
    grid.querySelectorAll('.ap-tile').forEach(t => {
      const id = t.dataset.id;
      if (arr.indexOf(id) === -1 && arr.length < lim) arr.push(id);
    });
    if (arr.length >= lim) toast('Selected the first ' + lim + ' (section limit).');
    paintBadges(key);
  }

  function clearSel(key) { clickOrder[key] = []; paintBadges(key); }

  // Reflect the click-order onto the tiles: selected tiles get their 1-based
  // sequence number, the rest are cleared.
  function paintBadges(key) {
    const grid = document.getElementById('apGrid-' + key);
    if (!grid) return;
    const arr = clickOrder[key] || [];
    grid.querySelectorAll('.ap-tile').forEach(t => {
      const pos = arr.indexOf(t.dataset.id);
      const badge = t.querySelector('.ap-tile-badge');
      if (pos === -1) { t.classList.remove('is-sel'); badge.textContent = ''; }
      else { t.classList.add('is-sel'); badge.textContent = String(pos + 1); }
    });
    updatePickCount(key);
  }

  function updatePickCount(key) {
    const el = document.getElementById('apPickCount-' + key);
    if (el) el.textContent = (clickOrder[key] || []).length + ' selected';
  }

  // Persist the chosen selection + order to the manifest.
  async function saveSel(key) {
    const save = document.getElementById('apPickSave-' + key);
    if (!window.LaxtMedia) return;
    const ids = (clickOrder[key] || []).slice();
    save.disabled = true;
    try {
      await window.LaxtMedia.setSelection(key, ids);
      toast('Saved — ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' live.');
      renderList(key);
      updateCount(key);
    } catch (e) {
      toast('Save failed: ' + (e.message || 'error'));
    } finally {
      save.disabled = false;
    }
  }

  // ── Upload a batch sequentially (keeps UI responsive, real progress) ──
  async function handleFiles(key, fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    const limit   = LaxtMediaLimit(key);
    let   current = window.LaxtMedia.count(key);
    const bar     = document.getElementById('apProgress-' + key);
    const barFill = bar.querySelector('.ap-progress-bar');
    const barLbl  = bar.querySelector('.ap-progress-label');

    let queued = [];
    for (const f of files) {
      if (!isAccepted(f)) { toast('Skipped "' + f.name + '" — only JPG/PNG/WEBP/MP4 allowed'); continue; }
      if (current + queued.length >= limit) { toast('Limit reached: ' + limit + ' files max for this section.'); break; }
      queued.push(f);
    }
    if (!queued.length) return;

    bar.hidden = false;
    // addMany appends one card per finished file instead of rebuilding the whole
    // grid per file, and writes the manifest once for the batch rather than once
    // per file. Uploading N files used to cost N grid teardowns + N manifest
    // round-trips, which is what made the gallery crawl after an upload.
    const results = await window.LaxtMedia.addMany(key, queued, p => {
      barLbl.textContent  = 'Uploading ' + (p.index + 1) + ' / ' + p.total + ' — ' + p.file.name;
      barFill.style.width = Math.round(p.fraction * 100) + '%';
      if (p.fraction === 1) { renderList(key); updateCount(key); }
    });

    results.forEach(r => {
      if (r.error) toast('Upload failed: ' + (r.error.message || 'error'));
    });
    renderList(key);
    updateCount(key);

    barLbl.textContent = 'Done';
    setTimeout(() => { bar.hidden = true; barFill.style.width = '0%'; }, 700);
  }

  // ── Live count badge (e.g. 9 / 15) ──
  function updateCount(key) {
    const el = document.getElementById('apCount-' + key);
    if (!el || !window.LaxtMedia) return;
    const n = window.LaxtMedia.count(key), lim = LaxtMediaLimit(key);
    el.textContent = n + ' / ' + lim;
    el.classList.toggle('is-full', n >= lim);
  }

  // ── Admin item list with delete + reorder (up/down) ──
  function renderList(key) {
    const list = document.getElementById('apList-' + key);
    if (!list || !window.LaxtMedia) return;
    const items = window.LaxtMedia.get(key);
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<div class="ap-empty">No files yet.</div>'; return; }

    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'ap-row';
      row.draggable = true;
      row.dataset.idx = idx;
      const thumb = it.type === 'video'
        ? '<span class="ap-thumb ap-thumb-vid">▶</span>'
        : '<img class="ap-thumb" loading="lazy" src="' + window.LAXT_CDN.base + '/api/media/' + it.id + '?w=120" alt="">';
      row.innerHTML =
        thumb +
        '<span class="ap-row-name" title="' + esc(it.name || '') + '">' + esc(it.name || '(untitled)') + '</span>' +
        '<span class="ap-row-type">' + esc(it.type) + '</span>' +
        '<span class="ap-row-actions">' +
          '<button class="ap-icon ap-up"   title="Move up"   ' + (idx === 0 ? 'disabled' : '') + '>&#9650;</button>' +
          '<button class="ap-icon ap-down" title="Move down" ' + (idx === items.length - 1 ? 'disabled' : '') + '>&#9660;</button>' +
          '<button class="ap-icon ap-del"  title="Delete">&times;</button>' +
        '</span>';

      row.querySelector('.ap-up').addEventListener('click', async () => {
        await window.LaxtMedia.reorder(key, idx, idx - 1); renderList(key);
      });
      row.querySelector('.ap-down').addEventListener('click', async () => {
        await window.LaxtMedia.reorder(key, idx, idx + 1); renderList(key);
      });
      row.querySelector('.ap-del').addEventListener('click', async () => {
        if (!confirm('Delete "' + (it.name || 'this file') + '"? This removes it from the site and your CDN.')) return;
        row.classList.add('is-busy');
        try { await window.LaxtMedia.remove(key, it.id); } catch (e) { toast('Delete failed'); }
        renderList(key); updateCount(key);
      });

      // Drag-and-drop reorder
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', idx); row.classList.add('is-dragging'); });
      row.addEventListener('dragend',   () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('is-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-over'));
      row.addEventListener('drop', async e => {
        e.preventDefault();
        row.classList.remove('is-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to   = idx;
        if (!isNaN(from) && from !== to) { await window.LaxtMedia.reorder(key, from, to); renderList(key); }
      });

      list.appendChild(row);
    });
  }

  // ── Tiny toast for warnings ──
  function toast(msg) {
    let t = document.getElementById('adminToast');
    if (!t) { t = document.createElement('div'); t.id = 'adminToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('is-in');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('is-in'), 3200);
  }

  // ── Keep the panel's list + count in sync when the engine re-renders ──
  document.addEventListener('laxt:media-rendered', e => {
    const key = e.detail && e.detail.section;
    if (!key || !document.getElementById('adminPanel')) return;
    updateCount(key);
  });

  // ── Boot ──
  function boot() { buildTrigger(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
