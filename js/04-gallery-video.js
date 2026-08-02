/* =====================================================================
   LAXTLINE — js/04-gallery-video.js   (the largest, most important file)
   ---------------------------------------------------------------------
   Everything that powers the videos and the gallery:

     • Smart video playback   — desktop: hover to play with sound;
       mobile: autoplay muted when ~70% on-screen; tap to unmute
     • First-gesture unmute    — browsers block unmuted autoplay, so we
       quietly unmute on the first real click/tap/keypress
     • Lazy load + MEMORY RELEASE — a video's source loads only when it
       comes near the viewport, and is RELEASED when it scrolls far away.
       This is the key fix that stops the page from freezing/crashing
       after many videos have been scrolled past.
     • Aspect-ratio detection  — sets each card's height from the real
       media size (applyRatio) so the masonry grid never jumps
     • Fullscreen viewer (fsv) — the lightbox with play/pause, seek bar,
       volume, prev/next, keyboard shortcuts and counter
     • Missing-file fallback   — shows a labelled placeholder if a media
       file is absent, instead of a blank card

   Helper names to know: ensureLoaded() loads a source; playVideo()/
   stopVideo() handle hover; setupLazyLoad() wires the load/unload
   observers; fsvOpen()/closeViewer() drive the lightbox.
   ===================================================================== */

// ══════════════════════════════════════════════════════════════
//  SMART VIDEO SYSTEM — Hover (desktop) + Touch (mobile)
//  Works for BOTH: .proj (Work section) and .gal-item (Gallery)
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  SMART VIDEO SYSTEM v3
//  Desktop : hover → play with sound | leave → pause+mute
//  Mobile  : IntersectionObserver → autoplay muted when 60% visible
//            tap mute-btn → toggle sound
//  Thumbnail: video shows first frame (poster) until played
// ══════════════════════════════════════════════════════════════

const isTouch = () => window.matchMedia('(hover:none)').matches;

// ══════════════════════════════════════════════════════════════
//  AUTO QUALITY — every network-dependent decision below reads from
//  js/00-net-quality.js (window.LaxtNet) instead of being hard-coded.
//  The fallbacks are the values this file used before that engine
//  existed, so if it ever fails to load nothing here changes.
//
//    netPreload()   'none' on a slow link → a card costs one small JPEG
//                   until the visitor actually asks for the video
//    netAutoplay()  false on a slow link → scroll-autoplay and
//                   hover-to-play are withheld; the play button still works
//    netVideoSrc()  base CDN url → tier-appropriate url (identity until
//                   the CDN can serve renditions)
//    netStall()     "this video ran dry mid-playback" — the most honest
//                   bandwidth signal there is, feeds back into the tier
// ══════════════════════════════════════════════════════════════
const netPreload   = () => (window.LaxtNet ? window.LaxtNet.videoPreload()  : 'metadata');
const netAutoplay  = () => (window.LaxtNet ? window.LaxtNet.allowAutoplay() : true);
const netHoverPlay = () => (window.LaxtNet ? window.LaxtNet.allowHoverPlay(): true);
const netVideoSrc  = b  => (window.LaxtNet ? window.LaxtNet.videoSrc(b)     : b);

// Point every <source> at the url the current tier calls for. data-src always
// holds the UNQUALIFIED base url so it can be re-resolved after a tier change.
function applyVideoSources(video) {
  video.querySelectorAll('source').forEach(s => {
    const base = s.dataset.src || s.dataset.savedSrc;
    if (!base) return;
    s.dataset.savedSrc = base;
    const want = netVideoSrc(base);
    if (s.getAttribute('src') !== want) s.src = want;
  });
}

// 'waiting' also fires at the very start of playback, which is normal buffering
// rather than a stall — only a video that had already played counts.
function watchStalls(video) {
  if (video._stallWired) return;
  video._stallWired = true;
  const onStall = () => {
    if (video.currentTime > 0.3 && window.LaxtNet) window.LaxtNet.reportStall();
  };
  video.addEventListener('waiting', onStall);
  video.addEventListener('stalled', onStall);
}

// ── Re-resolve every loaded video after the tier changes ──
// A no-op while the CDN has no renditions (the url comes back identical). Once
// it does, a video that is mid-playback is swapped to the new rendition and
// resumed at the same timestamp — this is the actual quality switch.
function retuneVideos() {
  document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
    if (!v.dataset.loaded) { v.preload = netPreload(); return; }

    const src = v.querySelector('source');
    if (!src) return;
    const base = src.dataset.src || src.dataset.savedSrc;
    if (!base) return;
    const want = netVideoSrc(base);
    if (src.getAttribute('src') === want) return;   // nothing to switch to

    const at      = v.currentTime;
    const playing = !v.paused;
    src.src = want;
    v.load();
    const resume = () => {
      // Seeking past the buffered range is exactly what a quality switch has to
      // do; the browser refetches from there.
      if (at > 0) { try { v.currentTime = at; } catch (e) {} }
      if (playing) v.play().catch(() => {});
    };
    if (v.readyState >= 1) resume();
    else v.addEventListener('loadedmetadata', resume, { once: true });
  });
}
document.addEventListener('laxt:quality-change', retuneVideos);

// Escape user-controlled text (media filenames/categories) before it goes into
// innerHTML. Missing-file placeholders below build markup from dataset values,
// which originate from CDN filenames — a crafted name could otherwise inject HTML.
const galEsc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ══ BLACK BAR FIX — force cover on every video after metadata loads ══
function fixVideoCover(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  // Always force cover — eliminates letterbox/pillarbox regardless of ratio
  video.style.cssText += ';object-fit:cover!important;object-position:center center!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;';
  const wrap = video.parentElement;
  if (wrap) { wrap.style.overflow = 'hidden'; }
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('video.proj-video, video.gal-video').forEach(vid => {
    ['loadedmetadata','loadeddata','canplay'].forEach(evt =>
      vid.addEventListener(evt, () => fixVideoCover(vid), { once: true })
    );
    if (vid.readyState >= 1) fixVideoCover(vid);
  });
});

// ── SVG icons ──
const SVG_MI = `<svg class="mi-muted" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white"/><line x1="15" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="15" y2="15"/></svg><svg class="mi-sound" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white"/><path d="M15.5 8.5 Q19 12 15.5 15.5" fill="none"/><path d="M18 6 Q23 12 18 18" fill="none"/></svg>`;

// ── Ensure video src is loaded (only when needed) ──
function ensureLoaded(video) {
  if (!video.dataset.loaded) {
    applyPoster(video);
    applyVideoSources(video);
    video.preload = 'metadata';
    video.load();
    video.dataset.loaded = '1';
    watchStalls(video);
  }
}

// ── Sync mute button icons ──
function syncMuteBtn(video) {
  const wrap = video.closest('.proj-media-wrap') || video.closest('.gal-media-wrap');
  const mi = wrap?.querySelector('.mute-indicator');
  if (mi) mi.classList.toggle('is-sound', !video.muted);

  const galBtn = video.closest('.gal-item')?.querySelector('.gal-mute-btn');
  if (galBtn) {
    const m = galBtn.querySelector('.icon-muted');
    const s = galBtn.querySelector('.icon-sound');
    if (m) m.style.display = video.muted ? '' : 'none';
    if (s) s.style.display = video.muted ? 'none' : '';
  }
  const lbl = video.closest('.proj-media-wrap')?.querySelector('.vid-label');
  if (lbl) lbl.textContent = video.muted ? 'MUTED — CLICK TO UNMUTE' : 'PLAYING WITH AUDIO';
}

// ── Cached video list — avoids DOM query every pause call ──
let _allVideos = null;
function getAllVideos() {
  if (!_allVideos) _allVideos = Array.from(document.querySelectorAll('video.proj-video, video.gal-video'));
  return _allVideos;
}

// ── Stop all other videos ──
function pauseOthers(current) {
  getAllVideos().forEach(v => {
    if (v === current) return;
    if (!v.paused) {
      v.pause();
      v.currentTime = 0;
    }
    v.closest('.proj, .gal-item')?.classList.remove('touch-playing');
    // Remove any stale sound banner from other cards
    const w = v.closest('.proj-media-wrap') || v.closest('.gal-media-wrap');
  });
}

// ── Play video ──
// Browser blocks unmuted autoplay until a real user gesture (click / pointerdown /
// touchstart / keydown) has occurred on the page. mouseenter does NOT qualify.
// Strategy:
//   1. Try unmuted — succeeds when browser policy already unlocked.
//   2. On rejection, fall back to muted play so the user sees the video.
//   3. Register a one-time pointerdown on document — this IS a user gesture.
//      • If the video is still playing when pointerdown fires → unmute in-place.
//      • If it has been paused (mouseleave → stopVideo) → skip; browser is now
//        unlocked so the NEXT mouseenter will successfully play unmuted.
function playVideo(video) {
  ensureLoaded(video);
  pauseOthers(video);
  video.preload = 'auto';
  video.dataset.wantPlay = '1';
  video.removeAttribute('muted');
  video.muted = false;

  const p = video.play();
  if (p) {
    p.catch(() => {
      // ── Autoplay blocked — play muted as immediate fallback ──
      video.muted = true;
      video.play().catch(() => {});

      // Track the most-recently muted video so the gesture handler can find it
      window._pendingUnmuteVideo = video;

      // ── Wire ONE global pointerdown/keydown handler (never duplicated) ──
      if (!window._firstGestureWired) {
        window._firstGestureWired = true;

        function onFirstGesture() {
          window._userInteracted     = true;
          window._firstGestureWired  = false;

          // Unmute in-place if the pending video is still playing
          const target = window._pendingUnmuteVideo;
          if (target && !target.paused) {
            target.muted = false;
            syncMuteBtn(target);
          }
          window._pendingUnmuteVideo = null;

          // Also sweep all other non-paused gallery/project videos
          document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
            if (!v.paused && v !== target) {
              v.muted = false;
              syncMuteBtn(v);
            }
          });

          document.removeEventListener('pointerdown', onFirstGesture);
          document.removeEventListener('keydown',     onFirstGesture);
        }

        // pointerdown fires on any mouse button press anywhere on the page —
        // this is the earliest possible real user gesture event.
        document.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
        document.addEventListener('keydown',     onFirstGesture, { once: true, passive: true });
      }

      // ── Also wire the card's own click for direct-card interaction ──
      const card = video.closest('.proj') || video.closest('.gal-item');
      if (card && !card._unmuteWired) {
        card._unmuteWired = true;
        card.addEventListener('click', function unmute() {
          video.muted = false;
          syncMuteBtn(video);
          card._unmuteWired    = false;
          window._userInteracted = true;
        }, { once: true });
      }
    });
  }
  syncMuteBtn(video);
}

function stopVideo(video) {
  video.dataset.wantPlay = '0';
  video.pause();
  video.currentTime = 0;
  syncMuteBtn(video);
}

// ── Inject mute indicator button ──
function injectMuteIndicator(video) {
  const wrap = video.closest('.proj-media-wrap') || video.closest('.gal-media-wrap');
  if (!wrap || wrap.querySelector('.mute-indicator')) return;
  const btn = document.createElement('button');
  btn.className = 'mute-indicator';
  btn.title = 'Toggle Mute';
  btn.innerHTML = SVG_MI;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted && video.paused) { ensureLoaded(video); video.play().catch(() => { video.muted = true; }); }
    syncMuteBtn(video);
  });
  wrap.appendChild(btn);
}

// ── Desktop hover play ──
function attachHoverPlay(video) {
  const card = video.closest('.proj') || video.closest('.gal-item');
  if (!card || card._hover) return;
  card._hover = true;
  // Moving the pointer across a card is an aim, not an intent — on a slow link
  // that speculative metadata fetch is bandwidth the visitor never asked for.
  card.addEventListener('mousemove', () => { if (netPreload() !== 'none') ensureLoaded(video); }, { once: true });
  card.addEventListener('mouseenter', () => {
    // Hover-to-play is withheld on a slow connection — the play button and the
    // thumbnail overlay still start it on a real click.
    if (!isTouch() && netHoverPlay()) {
      // Always keep track of the most-recently hovered video so that the
      // pointerdown / onFirstInteraction handler knows which video to unmute.
      window._pendingUnmuteVideo = video;
      playVideo(video);
    }
  });
  card.addEventListener('mouseleave', () => {
    if (isTouch()) return;
    // Reels-style: leaving a card must NOT stop it — the autoplay observer keeps
    // it running, and the observer only re-fires on an intersection change, so a
    // paused-in-view video would never restart. Just drop the sound instead, so
    // only the hovered card is audible.
    video.muted = true;
    syncMuteBtn(video);
  });
}

// ── Mobile IntersectionObserver ──
let mobObs = null;
function setupMobileObs() {
  if (!('IntersectionObserver' in window)) return;
  mobObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      // Autoplay on EVERY device (desktop included), reels-style: a card that is
      // ~35% on-screen starts playing muted. Desktop hover then only adds sound.
      const video = entry.target;
      const card = video.closest('.proj') || video.closest('.gal-item');
      if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
        // Slow connection / Data Saver: scrolling past a card must not pull a
        // multi-megabyte MP4 down. The poster stays up with its play overlay,
        // and a tap plays it — the same deal every data-saving video app makes.
        if (!netAutoplay()) { video.pause(); card?.classList.remove('touch-playing'); return; }
        ensureLoaded(video);
        pauseOthers(video);
        // Instagram-style: the video currently on-screen plays WITH sound once
        // the user has enabled audio via the sound prompt. Until then (or if the
        // browser blocks unmuted autoplay) it falls back to muted playback.
        video.muted = !window._soundEnabled;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
        card?.classList.add('touch-playing');
        syncMuteBtn(video);
      } else {
        video.pause();
        card?.classList.remove('touch-playing');
      }
    });
  }, { threshold: [0.35] });
}

function attachMobilePlay(video) { if (mobObs) mobObs.observe(video); }

// ── Attach mute button for gal-item bottom bar ──
function attachMuteBtn(video) {
  const galBtn = video.closest('.gal-item')?.querySelector('.gal-mute-btn');
  if (galBtn && !galBtn._mute) {
    galBtn._mute = true;
    galBtn.addEventListener('click', e => {
      e.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted && video.paused) { ensureLoaded(video); video.play().catch(() => { video.muted = true; }); }
      syncMuteBtn(video);
    });
  }
  const projBtn = video.closest('.proj-media-wrap')?.querySelector('.vid-btn[onclick*="toggleMute"]');
  if (projBtn && !projBtn._mute) {
    projBtn._mute = true;
    projBtn.removeAttribute('onclick');
    projBtn.addEventListener('click', e => {
      e.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted && video.paused) { ensureLoaded(video); video.play().catch(() => { video.muted = true; }); }
      syncMuteBtn(video);
    });
  }
}

// ── Seek to first frame so thumbnail is visible (preload=metadata) ──
function seekFirstFrame(video) {
  if (video._firstFrame) return;
  video._firstFrame = true;
  // Seek a tiny bit to force browser to render first frame
  try { video.currentTime = 0.001; } catch(e){}
}

// ── Smart ratio detection ──
// The grid is CSS multi-column masonry, so writing one card's padding-bottom
// re-balances every column. Metadata for N cards arrives N separate times as
// the network responds, which used to mean N full-grid reflows. Queue the
// writes and flush them in a single frame instead: N events → 1 layout pass.
let _ratioQueue = [], _ratioRaf = 0;

function applyRatio(el, item) {
  _ratioQueue.push([el, item]);
  if (!_ratioRaf) _ratioRaf = requestAnimationFrame(flushRatios);
}

function flushRatios() {
  _ratioRaf = 0;
  const queued = _ratioQueue;
  _ratioQueue = [];
  queued.forEach(pair => applyRatioNow(pair[0], pair[1]));
}

function applyRatioNow(el, item) {
  const w = el.tagName === 'VIDEO' ? el.videoWidth : el.naturalWidth;
  const h = el.tagName === 'VIDEO' ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return;
  const wrap = item.querySelector('.gal-media-wrap');
  if (!wrap) return;

  // Remember it, so this media paints at the right ratio on the next visit
  // instead of being re-measured (and re-reflowed) every time.
  if (item.dataset.mediaId && window.LaxtMedia && window.LaxtMedia.rememberRatio) {
    window.LaxtMedia.rememberRatio(item.dataset.mediaId, w, h);
  }

  // Set padding-bottom to exact h/w ratio — masonry column sizes to this.
  // Skip the write when the card was already built at this ratio (known from
  // the manifest or the local cache) — that would be a reflow for nothing.
  const pct = (h / w * 100).toFixed(4) + '%';
  if (wrap.style.paddingBottom !== pct) wrap.style.paddingBottom = pct;

  // Inject human-readable ratio badge
  let badge = wrap.querySelector('.gal-ratio-badge');
  if (!badge) { badge = document.createElement('span'); badge.className = 'gal-ratio-badge'; wrap.appendChild(badge); }
  const gcd = (a,b) => b===0?a:gcd(b,a%b);
  const g = gcd(Math.round(w), Math.round(h));
  badge.textContent = Math.round(w/g) + ':' + Math.round(h/g);
}

function detectVideoRatio(video) {
  const item = video.closest('.gal-item'); if (!item) return;
  if (video.readyState >= 1 && video.videoWidth) { applyRatio(video, item); seekFirstFrame(video); return; }
  // Use event listeners instead of polling — fires reliably after data-src swap + load()
  const onMeta = () => { applyRatio(video, item); seekFirstFrame(video); };
  video.addEventListener('loadedmetadata', onMeta, { once: true });
  // canplay fallback in case loadedmetadata fired while paused/unloaded
  video.addEventListener('canplay', () => {
    if (video.videoWidth) { applyRatio(video, item); seekFirstFrame(video); }
  }, { once: true });
}
function detectImageRatio(img) {
  const item = img.closest('.gal-item'); if (!item) return;
  if (img.complete && img.naturalWidth) { applyRatio(img, item); return; }
  img.addEventListener('load', () => applyRatio(img, item), { once: true });
}

// ── Lazy load + memory release with IntersectionObserver ──
// Near viewport  → swap data-src → src and load() (download dims + first frame)
// Far offscreen  → release the buffer so memory does not grow unbounded.
// This is what stops the page from crashing / freezing once dozens of videos
// have been scrolled past (each decoded video otherwise stays resident forever).
// Persistent lazy-load observers — created once, reused across re-renders so
// dynamically injected cards can be wired without leaking observers.
let _lazyLoadObs = null, _lazyKeepObs = null;

// Promote data-poster → poster. Kept separate from loadVid so the no-observer
// fallback can use it too. Idempotent: the attribute is cleared once consumed,
// and unloadVid() deliberately leaves the poster in place so a released card
// still shows its thumbnail instead of going black.
function applyPoster(v) {
  const url = v.dataset.poster;
  if (!url || v.poster) return;
  v.poster = url;
  delete v.dataset.poster;
}

// root defaults to document; pass a single freshly-appended card to wire just
// that one instead of walking every card in both grids.
function setupLazyLoad(selector, root) {
  const scope = root || document;
  const findAll = sel => {
    const list = Array.from(scope.querySelectorAll(sel));
    // A root that is itself a match (or contains the match) still needs to be
    // covered — querySelectorAll only looks at descendants.
    if (scope !== document && scope.matches && scope.matches(sel)) list.unshift(scope);
    return list;
  };

  if (!('IntersectionObserver' in window)) {
    // Fallback: no IntersectionObserver — load everything immediately
    findAll(selector).forEach(v => {
      applyPoster(v);
      applyVideoSources(v);
      v.preload = netPreload();
      v.load();
      watchStalls(v);
    });
    return;
  }

  // ── Load a video's sources. savedSrc preserves the URL so it can reload later. ──
  function loadVid(v) {
    if (v.dataset.loaded) return;
    // Poster FIRST, before the video request is queued. The CDN serves a ~60KB
    // JPEG frame for a video id, which paints far sooner than the MP4's own
    // first frame (that needs headers + moov + keyframe off a slow Drive
    // backend). Ordering it ahead of load() means the cheap request isn't stuck
    // behind the expensive one. Once the video can paint, it replaces this.
    applyPoster(v);
    applyVideoSources(v);
    // On a slow connection this is 'none': the src is in place so a tap can
    // play it instantly, but nothing is fetched until then. The card is not
    // blank — the poster above is already painting, and the aspect ratio came
    // from the CDN listing rather than from the video's own metadata.
    v.preload = netPreload();
    v.load();
    v.dataset.loaded = '1';
    watchStalls(v);
    // After load starts, metadata fires → ratio detection
    if (v.classList.contains('gal-video')) {
      v.addEventListener('loadedmetadata', () => {
        const item = v.closest('.gal-item');
        if (item) applyRatio(v, item);
        seekFirstFrame(v);
      }, { once: true });
    }
  }

  // ── Release a far-offscreen video to free memory. Layout stays intact because
  //    the wrap keeps its padding-bottom ratio, so nothing shifts on screen. ──
  function unloadVid(v) {
    if (!v.dataset.loaded) return;
    if (!v.paused || v.dataset.wantPlay === '1') return; // never touch a playing/hovered video
    v.querySelectorAll('source').forEach(s => {
      const cur = s.getAttribute('src');
      if (cur) s.dataset.savedSrc = cur;
      s.removeAttribute('src');
    });
    v.removeAttribute('src');
    v.load();              // detach the media → frees the decoded video buffer
    delete v.dataset.loaded;
    v._firstFrame = false; // allow the first-frame thumbnail to re-seek on reload
  }

  // Load margin: how far outside the viewport to start fetching.
  // Fast/medium → 900px so posters are already in cache when the card scrolls in.
  // Slow → 150px so we don't speculatively pull megabytes the visitor never reaches.
  const loadMargin = (window.LaxtNet && window.LaxtNet.tier() === 'slow') ? '150px' : '900px';
  // Keep margin: once loaded, hold the buffer until the card is this far offscreen.
  const keepMargin = (window.LaxtNet && window.LaxtNet.tier() === 'slow') ? '600px'  : '1800px';

  if (!_lazyLoadObs) {
    _lazyLoadObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) loadVid(e.target); });
    }, { rootMargin: loadMargin });
    _lazyKeepObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (!e.isIntersecting) unloadVid(e.target); });
    }, { rootMargin: keepMargin });
  }

  findAll(selector).forEach(v => {
    if (v._lazyWired) return;          // already observed (survives re-render)
    v._lazyWired = true;
    // Snapshot the source URLs up-front so a video can always be reloaded,
    // even after another code path (hover/click) deletes its data-src.
    v.querySelectorAll('source[data-src]').forEach(s => {
      if (!s.dataset.savedSrc) s.dataset.savedSrc = s.dataset.src;
    });
    _lazyLoadObs.observe(v);
    _lazyKeepObs.observe(v);
  });
}

// Exposed so js/05-media-engine.js can eagerly load above-fold cards
// without waiting for the IntersectionObserver to fire.
window.loadVidEager = function (v) {
  if (!v || v.dataset.loaded) return;
  applyPoster(v);
  applyVideoSources(v);
  v.preload = netPreload() === 'none' ? 'metadata' : netPreload();
  v.load();
  v.dataset.loaded = '1';
  watchStalls(v);
  if (v.classList.contains('gal-video')) {
    v.addEventListener('loadedmetadata', () => {
      const item = v.closest('.gal-item');
      if (item) applyRatio(v, item);
      seekFirstFrame(v);
    }, { once: true });
  }
};

// ══════════════════════════════════════════════════════════════
//  MOBILE / TABLET SOUND PROMPT
//  Browsers block unmuted autoplay until a real gesture. On touch
//  devices we show a one-time popup ("Tap to enable sound"). Tapping
//  it sets window._soundEnabled = true and unmutes every playing
//  video — after that, sound follows whichever video is on-screen
//  (Instagram style, handled in the mobile IntersectionObserver).
// ══════════════════════════════════════════════════════════════
function enableSoundEverywhere() {
  window._soundEnabled   = true;
  window._userInteracted = true;
  document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
    if (!v.paused) {
      v.muted = false;
      syncMuteBtn(v);
    }
  });
}

function showSoundPrompt() {
  // Shown on ALL devices (phone, tablet AND laptop/desktop) — one tap/click
  // unlocks audio everywhere, matching the mobile behaviour.
  if (window._soundEnabled) return;
  if (document.getElementById('soundPrompt')) return;

  const pop = document.createElement('div');
  pop.id = 'soundPrompt';
  pop.className = 'sound-prompt';
  pop.innerHTML = `
    <button class="sound-prompt-card" aria-label="Tap to enable sound">
      <span class="sound-prompt-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white" stroke="none"/>
          <path d="M15.5 8.5 Q19 12 15.5 15.5"/>
          <path d="M18 6 Q23 12 18 18"/>
        </svg>
      </span>
      <span class="sound-prompt-text">
        <span class="sound-prompt-title">Tap to enable sound</span>
      </span>
    </button>`;

  function dismiss() {
    enableSoundEverywhere();
    pop.classList.remove('is-in');
    setTimeout(() => pop.remove(), 300);
  }
  // Click anywhere on the blurred overlay (card or backdrop) dismisses it
  pop.addEventListener('click', dismiss);
  document.body.appendChild(pop);
  // Trigger enter animation on next frame
  requestAnimationFrame(() => pop.classList.add('is-in'));
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // ── Strip HTML muted attribute from ALL videos on load ──
  document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
    v.removeAttribute('muted');
    v.muted = false;
  });

  // Show the "tap to enable sound" prompt on ALL devices (opens with the page)
  showSoundPrompt();

  // ── Unmute all playing videos on first user interaction ──
  // Browsers block unmuted autoplay — this silently unmutes on first real gesture.
  // pointerdown is added because it fires before 'click' and is an earlier user gesture.
  function onFirstInteraction() {
    if (window._userInteracted) return;
    window._userInteracted    = true;
    window._soundEnabled      = true; // any real gesture also enables Instagram-style sound
    window._firstGestureWired = false;
    document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
      if (!v.paused) {
        v.muted = false;
        syncMuteBtn(v);
      }
    });
    // Remove the sound prompt if it's still showing
    const sp = document.getElementById('soundPrompt');
    if (sp) { sp.classList.remove('is-in'); setTimeout(() => sp.remove(), 300); }
    document.removeEventListener('pointerdown', onFirstInteraction);
    document.removeEventListener('click',       onFirstInteraction);
    document.removeEventListener('touchend',    onFirstInteraction);
    document.removeEventListener('keydown',     onFirstInteraction);
  }
  document.addEventListener('pointerdown', onFirstInteraction, { passive: true });
  document.addEventListener('click',       onFirstInteraction, { passive: true });
  document.addEventListener('touchend',    onFirstInteraction, { passive: true });
  document.addEventListener('keydown',     onFirstInteraction, { passive: true });

  setupMobileObs();

  // Ensure all thumb overlays exist on video cards AND wire click to play
  document.querySelectorAll('.gal-item[data-type="video"], .gal-item[data-fs-type="video"]').forEach(item => {
    const wrap = item.querySelector('.gal-media-wrap');
    const video = item.querySelector('video.gal-video');
    if (wrap && !wrap.querySelector('.vid-thumb-overlay')) {
      const ov = document.createElement('div');
      ov.className = 'vid-thumb-overlay';
      ov.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>';
      wrap.appendChild(ov);
    }
    // Wire thumb overlay click → play
    const ov = wrap?.querySelector('.vid-thumb-overlay');
    if (ov && video && !ov._wired) {
      ov._wired = true;
      ov.addEventListener('click', e => {
        e.stopPropagation();
        ensureLoaded(video);
        pauseOthers(video);
        video.removeAttribute('muted');
        video.muted = false;
        const p = video.play();
        if (p) p.catch(() => { video.muted = true; video.play().catch(()=>{}); });
        item.classList.add('touch-playing');
        syncMuteBtn(video);
      });
    }
  });

  // Init all proj-videos (Work section)
  document.querySelectorAll('video.proj-video').forEach(v => {
    injectMuteIndicator(v);
    attachHoverPlay(v);
    attachMobilePlay(v);
    attachMuteBtn(v);
    // Apply ratio detection so work-section cards show in correct aspect ratio
    const projItem = v.closest('.proj');
    if (projItem) {
      const wrap = projItem.querySelector('.proj-media-wrap');
      if (wrap) {
        const applyProjRatio = () => {
          if (!v.videoWidth) return;
          // Skip ratio override for portrait videos in frame-hero — CSS handles them
          if (projItem.classList.contains('proj-portrait')) return;
          const ratio = v.videoHeight / v.videoWidth;
          // Portrait video (9:16): set height based on ratio
          wrap.style.height = '';
          wrap.style.paddingBottom = (ratio * 100).toFixed(4) + '%';
          // For portrait, cap max-height so it doesn't become too tall in grid
          if (ratio > 1) {
            wrap.style.maxHeight = '520px';
          } else {
            wrap.style.maxHeight = '';
          }
        };
        if (v.readyState >= 1 && v.videoWidth) applyProjRatio();
        else {
          v.addEventListener('loadedmetadata', applyProjRatio, { once: true });
          v.addEventListener('canplay', () => { if(v.videoWidth) applyProjRatio(); }, { once: true });
        }
      }
    }
    v.addEventListener('playing', () => {
      v.closest('.proj')?.querySelector('.vid-thumb-overlay')?.style.setProperty('opacity', '0');
    });
    v.addEventListener('pause', () => {
      v.closest('.proj')?.querySelector('.vid-thumb-overlay')?.style.removeProperty('opacity');
    });
  });

  // Init all gal-videos (Gallery section)
  document.querySelectorAll('video.gal-video').forEach(v => {
    injectMuteIndicator(v);
    attachHoverPlay(v);
    attachMobilePlay(v);
    attachMuteBtn(v);
    detectVideoRatio(v);
    // Seek first frame once metadata is ready
    if (v.readyState >= 1) { seekFirstFrame(v); }
    else { v.addEventListener('loadedmetadata', () => seekFirstFrame(v), { once: true }); }
    v.addEventListener('playing', () => {
      v.closest('.gal-item')?.classList.add('gal-video-playing');
      v.closest('.gal-item')?.querySelector('.vid-thumb-overlay')?.style.setProperty('opacity', '0');
    });
    v.addEventListener('pause', () => {
      v.closest('.gal-item')?.classList.remove('gal-video-playing');
      v.closest('.gal-item')?.querySelector('.vid-thumb-overlay')?.style.removeProperty('opacity');
    });
    // Error handling — show placeholder when file missing
    v.addEventListener('error', () => {
      const item = v.closest('.gal-item');
      if (!item) return;
      const wrap = item.querySelector('.gal-media-wrap');
      if (!wrap) return;
      // Add visual placeholder so card doesn't look blank
      wrap.style.background = 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)';
      const placeholder = wrap.querySelector('.gal-missing-placeholder');
      if (!placeholder) {
        const ph = document.createElement('div');
        ph.className = 'gal-missing-placeholder';
        ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;z-index:1;';
        const name = item.dataset.fsName || item.querySelector('.gal-name')?.textContent || 'Video';
        const cat = item.dataset.fsCat || item.querySelector('.gal-cat')?.textContent || '';
        ph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(232,57,42,0.6)" stroke-width="1.5" style="width:40px;height:40px"><polygon points="5,3 19,12 5,21" fill="rgba(232,57,42,0.15)"/></svg><span style="font-family:var(--font-mono);font-size:.55rem;letter-spacing:2px;color:rgba(232,57,42,0.7);text-transform:uppercase;">${galEsc(cat)}</span><span style="font-family:var(--font-display);font-size:1.2rem;letter-spacing:2px;color:rgba(245,242,238,0.7);text-transform:uppercase;text-align:center;padding:0 1rem">${galEsc(name)}</span>`;
        wrap.appendChild(ph);
      }
      // Show name/cat in bottom bar always (not just on hover)
      item.querySelector('.gal-bottom')?.style.setProperty('opacity', '1');
      item.querySelector('.gal-bottom')?.style.setProperty('transform', 'translateY(0)');
    });
  });

  // Detect image ratios
  document.querySelectorAll('img.gal-photo').forEach(img => {
    detectImageRatio(img);
    img.addEventListener('error', () => {
      const item = img.closest('.gal-item');
      if (!item) return;
      const wrap = item.querySelector('.gal-media-wrap');
      if (!wrap || wrap.querySelector('.gal-missing-placeholder')) return;
      wrap.style.background = 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)';
      const ph = document.createElement('div');
      ph.className = 'gal-missing-placeholder';
      ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;z-index:1;';
      const name = item.dataset.fsName || item.querySelector('.gal-name')?.textContent || 'Image';
      const cat = item.dataset.fsCat || item.querySelector('.gal-cat')?.textContent || '';
      ph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(232,57,42,0.6)" stroke-width="1.5" style="width:40px;height:40px"><rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(232,57,42,0.1)"/><circle cx="8.5" cy="8.5" r="1.5" fill="rgba(232,57,42,0.5)"/><polyline points="21,15 16,10 5,21" stroke="rgba(232,57,42,0.5)"/></svg><span style="font-family:var(--font-mono);font-size:.55rem;letter-spacing:2px;color:rgba(232,57,42,0.7);text-transform:uppercase;">${galEsc(cat)}</span><span style="font-family:var(--font-display);font-size:1.2rem;letter-spacing:2px;color:rgba(245,242,238,0.7);text-transform:uppercase;text-align:center;padding:0 1rem">${galEsc(name)}</span>`;
      wrap.appendChild(ph);
    });
  });

  // Wire onclick for dynamically injected gal-items (no inline onclick)
  document.querySelectorAll('.gal-item').forEach(item => {
    item.style.cursor = 'pointer';
    const playBtn = item.querySelector('.gal-play-btn');
    const video = item.querySelector('video.gal-video');
    if (playBtn && video && !playBtn._wired) {
      playBtn._wired = true;
      playBtn.addEventListener('click', e => {
        e.stopPropagation();
        ensureLoaded(video);
        if (video.paused) {
          pauseOthers(video);
          video.removeAttribute('muted');
          video.muted = false;
          const p = video.play();
          if (p) p.catch(() => { video.muted = true; video.play().catch(()=>{}); });
          item.classList.add('touch-playing');
          playBtn.classList.add('playing');
        } else {
          video.pause();
          video.currentTime = 0;
          item.classList.remove('touch-playing');
          playBtn.classList.remove('playing');
        }
        syncMuteBtn(video);
      });
    }
  });

  // Lazy load — only load video data when near viewport
  setupLazyLoad('video.proj-video');
  setupLazyLoad('video.gal-video');

  // Invalidate video cache after init (all videos now in DOM)
  _allVideos = null;

  // ── Pause hero animations when scrolled away — saves GPU/CPU ──
  if ('IntersectionObserver' in window) {
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
      const glows = heroSection.querySelectorAll('.hero-glow-1,.hero-glow-2,.hero-glow-3,.hero-bg-text');
      const heroObs = new IntersectionObserver(entries => {
        entries.forEach(e => {
          const state = e.isIntersecting ? 'running' : 'paused';
          glows.forEach(el => el.style.animationPlayState = state);
        });
      }, { threshold: 0 });
      heroObs.observe(heroSection);
    }
    // Pause marquee when off-screen
    const marquee = document.querySelector('.marquee-wrap');
    if (marquee) {
      const rows = marquee.querySelectorAll('.marquee-row');
      const mObs = new IntersectionObserver(entries => {
        entries.forEach(e => {
          const state = e.isIntersecting ? 'running' : 'paused';
          rows.forEach(r => r.style.animationPlayState = state);
        });
      }, { threshold: 0 });
      mObs.observe(marquee);
    }
  }
});

// ══════════════════════════════════════════════════════════════
//  RE-INIT — wire up cards injected dynamically by the media engine
//  (js/05-media-engine.js). Idempotent: every helper below skips a
//  card it has already wired, so this is safe to call after every
//  re-render. Mirrors the per-card setup in the DOMContentLoaded init.
// ══════════════════════════════════════════════════════════════
// Detach a grid's videos from the singleton observers before the media engine
// clears the grid, so removed <video> nodes can be garbage-collected instead of
// being retained by loadObs/keepObs/mobObs across every re-render.
window.unwireGallery = function unwireGallery(grid) {
  if (!grid) return;
  grid.querySelectorAll('video.gal-video').forEach(v => {
    try { if (_lazyLoadObs) _lazyLoadObs.unobserve(v); } catch (e) {}
    try { if (_lazyKeepObs) _lazyKeepObs.unobserve(v); } catch (e) {}
    try { if (mobObs)       mobObs.unobserve(v);       } catch (e) {}
    if (!v.paused) v.pause();
  });
  _allVideos = null;   // cached list is stale once these nodes are gone
};

// root is optional and defaults to the whole document. The media engine passes
// the grid it just rebuilt — or the single card it just appended — so wiring one
// new upload no longer walks every card in both galleries.
window.reinitGallery = function reinitGallery(root) {
  const scope = root || document;
  // querySelectorAll only sees descendants, so a root that is itself a match
  // (the single-appended-card case) has to be included explicitly.
  const findAll = sel => {
    const list = Array.from(scope.querySelectorAll(sel));
    if (scope !== document && scope.matches && scope.matches(sel)) list.unshift(scope);
    return list;
  };

  // Video-card thumbnail overlays + click-to-play
  findAll('.gal-item[data-type="video"], .gal-item[data-fs-type="video"]').forEach(item => {
    const wrap  = item.querySelector('.gal-media-wrap');
    const video = item.querySelector('video.gal-video');
    if (wrap && !wrap.querySelector('.vid-thumb-overlay')) {
      const ov = document.createElement('div');
      ov.className = 'vid-thumb-overlay';
      ov.innerHTML = '<svg viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>';
      wrap.appendChild(ov);
    }
    const ov = wrap?.querySelector('.vid-thumb-overlay');
    if (ov && video && !ov._wired) {
      ov._wired = true;
      ov.addEventListener('click', e => {
        e.stopPropagation();
        ensureLoaded(video);
        pauseOthers(video);
        video.removeAttribute('muted');
        video.muted = false;
        const p = video.play();
        if (p) p.catch(() => { video.muted = true; video.play().catch(()=>{}); });
        item.classList.add('touch-playing');
        syncMuteBtn(video);
      });
    }
  });

  // Videos — playback, ratio, first frame, play/pause visuals
  findAll('video.gal-video').forEach(v => {
    if (v._galWired) return;
    v._galWired = true;
    injectMuteIndicator(v);
    attachHoverPlay(v);
    attachMobilePlay(v);
    attachMuteBtn(v);
    detectVideoRatio(v);
    if (v.readyState >= 1) { seekFirstFrame(v); }
    else { v.addEventListener('loadedmetadata', () => seekFirstFrame(v), { once: true }); }
    v.addEventListener('playing', () => {
      v.closest('.gal-item')?.classList.add('gal-video-playing');
      v.closest('.gal-item')?.querySelector('.vid-thumb-overlay')?.style.setProperty('opacity', '0');
    });
    v.addEventListener('pause', () => {
      v.closest('.gal-item')?.classList.remove('gal-video-playing');
      v.closest('.gal-item')?.querySelector('.vid-thumb-overlay')?.style.removeProperty('opacity');
    });
    v.addEventListener('error', () => {
      const item = v.closest('.gal-item'); if (!item) return;
      const wrap = item.querySelector('.gal-media-wrap'); if (!wrap) return;
      if (wrap.querySelector('.gal-missing-placeholder')) return;
      wrap.style.background = 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)';
      const ph = document.createElement('div');
      ph.className = 'gal-missing-placeholder';
      ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;z-index:1;';
      const name = item.dataset.fsName || 'Video';
      const cat  = item.dataset.fsCat  || '';
      ph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(232,57,42,0.6)" stroke-width="1.5" style="width:40px;height:40px"><polygon points="5,3 19,12 5,21" fill="rgba(232,57,42,0.15)"/></svg><span style="font-family:var(--font-mono);font-size:.55rem;letter-spacing:2px;color:rgba(232,57,42,0.7);text-transform:uppercase;">${galEsc(cat)}</span><span style="font-family:var(--font-display);font-size:1.2rem;letter-spacing:2px;color:rgba(245,242,238,0.7);text-transform:uppercase;text-align:center;padding:0 1rem">${galEsc(name)}</span>`;
      wrap.appendChild(ph);
    });
  });

  // Images — ratio + missing-file placeholder
  findAll('img.gal-photo').forEach(img => {
    if (img._galWired) return;
    img._galWired = true;
    detectImageRatio(img);
    img.addEventListener('error', () => {
      const item = img.closest('.gal-item'); if (!item) return;
      const wrap = item.querySelector('.gal-media-wrap');
      if (!wrap || wrap.querySelector('.gal-missing-placeholder')) return;
      wrap.style.background = 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)';
      const ph = document.createElement('div');
      ph.className = 'gal-missing-placeholder';
      ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;z-index:1;';
      const name = item.dataset.fsName || 'Image';
      const cat  = item.dataset.fsCat  || '';
      ph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(232,57,42,0.6)" stroke-width="1.5" style="width:40px;height:40px"><rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(232,57,42,0.1)"/><circle cx="8.5" cy="8.5" r="1.5" fill="rgba(232,57,42,0.5)"/><polyline points="21,15 16,10 5,21" stroke="rgba(232,57,42,0.5)"/></svg><span style="font-family:var(--font-mono);font-size:.55rem;letter-spacing:2px;color:rgba(232,57,42,0.7);text-transform:uppercase;">${galEsc(cat)}</span><span style="font-family:var(--font-display);font-size:1.2rem;letter-spacing:2px;color:rgba(245,242,238,0.7);text-transform:uppercase;text-align:center;padding:0 1rem">${galEsc(name)}</span>`;
      wrap.appendChild(ph);
    });
  });

  // gal-play-btn click wiring. (The pointer cursor is a CSS rule now — writing
  // it inline here forced a style recalc on every card on every re-init.)
  findAll('.gal-item').forEach(item => {
    const playBtn = item.querySelector('.gal-play-btn');
    const video   = item.querySelector('video.gal-video');
    if (playBtn && video && !playBtn._wired) {
      playBtn._wired = true;
      playBtn.addEventListener('click', e => {
        e.stopPropagation();
        ensureLoaded(video);
        if (video.paused) {
          pauseOthers(video);
          video.removeAttribute('muted');
          video.muted = false;
          const p = video.play();
          if (p) p.catch(() => { video.muted = true; video.play().catch(()=>{}); });
          item.classList.add('touch-playing');
          playBtn.classList.add('playing');
        } else {
          video.pause();
          video.currentTime = 0;
          item.classList.remove('touch-playing');
          playBtn.classList.remove('playing');
        }
        syncMuteBtn(video);
      });
    }
  });

  // Lazy-load + fullscreen viewer buttons for the new cards
  setupLazyLoad('video.gal-video', scope);
  if (window.fsvInjectExpandButtons) window.fsvInjectExpandButtons(scope);

  // Invalidate cached video list so pauseOthers() sees the new videos
  _allVideos = null;
};

// ── Gallery scroll helper ──
function openGallery() {
  const s = document.getElementById('all-work');
  if (s) s.scrollIntoView({ behavior: 'smooth' });
}
function closeGallery() {}

// ═══════════════════════════════════════════════════════════════
//  FULLSCREEN MEDIA VIEWER — Professional WhatsApp-style viewer
// ═══════════════════════════════════════════════════════════════
(function () {
  // ── Build viewer DOM ──
  const overlay = document.createElement('div');
  overlay.id = 'fsvOverlay';
  overlay.className = 'fsv-overlay';
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('role', 'dialog');
  overlay.innerHTML = `
    <div class="fsv-header">
      <div class="fsv-meta">
        <span class="fsv-cat" id="fsvCat"></span>
        <span class="fsv-name" id="fsvName"></span>
      </div>
      <div class="fsv-header-right">
        <span class="fsv-counter" id="fsvCounter"></span>
        <button class="fsv-close-btn" id="fsvCloseBtn" aria-label="Close viewer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="fsv-media-area">
      <button class="fsv-nav fsv-prev" id="fsvPrev" aria-label="Previous">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="fsv-media-wrap">
        <img decoding="async" loading="lazy" class="fsv-img" id="fsvImg" alt="">
        <video class="fsv-video" id="fsvVideo" playsinline preload="auto"></video>
      </div>
      <button class="fsv-nav fsv-next" id="fsvNext" aria-label="Next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <div class="fsv-controls" id="fsvControls">
      <input type="range" class="fsv-seek" id="fsvSeek" min="0" max="100" value="0" step="0.01" aria-label="Seek">
      <div class="fsv-ctrl-row">
        <button class="fsv-ctrl-btn" id="fsvPlayBtn" aria-label="Play/Pause">
          <svg id="fsvPlayIcon" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="white"/></svg>
        </button>
        <span class="fsv-time"><span id="fsvCurrent">0:00</span> / <span id="fsvDuration">0:00</span></span>
        <div class="fsv-spacer"></div>
        <!-- Quality chip — cycles Auto → High → Saver. "Auto" follows the
             connection (js/00-net-quality.js); the choice is remembered and
             applies to the whole site, not just this viewer. -->
        <button class="fsv-q-btn" id="fsvQualityBtn" aria-label="Playback quality">AUTO</button>
        <div class="fsv-vol-wrap">
          <button class="fsv-ctrl-btn" id="fsvMuteBtn" aria-label="Mute/Unmute">
            <svg id="fsvVolIcon" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
              <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="white" stroke="none"/>
              <path id="fsvVolWave1" d="M15.5 8.5 Q19 12 15.5 15.5" fill="none"/>
              <path id="fsvVolWave2" d="M18 6 Q23 12 18 18" fill="none"/>
              <line id="fsvVolX1" x1="15" y1="9" x2="21" y2="15" style="display:none"/>
              <line id="fsvVolX2" x1="21" y1="9" x2="15" y2="15" style="display:none"/>
            </svg>
          </button>
          <input type="range" class="fsv-vol-slider" id="fsvVolSlider" min="0" max="1" step="0.02" value="1" aria-label="Volume">
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── Refs ──
  const img        = document.getElementById('fsvImg');
  const video      = document.getElementById('fsvVideo');
  const closeBtn   = document.getElementById('fsvCloseBtn');
  const prevBtn    = document.getElementById('fsvPrev');
  const nextBtn    = document.getElementById('fsvNext');
  const playBtn    = document.getElementById('fsvPlayBtn');
  const playIcon   = document.getElementById('fsvPlayIcon');
  const muteBtn    = document.getElementById('fsvMuteBtn');
  const seekBar    = document.getElementById('fsvSeek');
  const volSlider  = document.getElementById('fsvVolSlider');
  const currentEl  = document.getElementById('fsvCurrent');
  const durationEl = document.getElementById('fsvDuration');
  const counterEl  = document.getElementById('fsvCounter');
  const qualityBtn = document.getElementById('fsvQualityBtn');
  const catEl      = document.getElementById('fsvCat');
  const nameEl     = document.getElementById('fsvName');
  const volX1      = document.getElementById('fsvVolX1');
  const volX2      = document.getElementById('fsvVolX2');
  const volW1      = document.getElementById('fsvVolWave1');
  const volW2      = document.getElementById('fsvVolWave2');

  // ── State ──
  let items = [];
  let currentIdx = 0;
  let seekDragging = false;

  // ── Time formatter ──
  function fmtTime(s) {
    if (isNaN(s) || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${m}:${sec}`;
  }

  // ── Update seek bar fill ──
  function updateSeekFill(pct) {
    seekBar.style.setProperty('--seek-pct', pct + '%');
  }

  // ── Update play icon ──
  function syncPlayIcon() {
    if (video.paused) {
      playIcon.setAttribute('viewBox', '0 0 24 24');
      playIcon.innerHTML = '<polygon points="5,3 19,12 5,21" fill="white"/>';
    } else {
      playIcon.setAttribute('viewBox', '0 0 24 24');
      playIcon.innerHTML = '<rect x="5" y="3" width="4" height="18" fill="white"/><rect x="15" y="3" width="4" height="18" fill="white"/>';
    }
  }

  // ── Update mute icon ──
  function syncMuteIcon() {
    const muted = video.muted || video.volume === 0;
    volX1.style.display = muted ? '' : 'none';
    volX2.style.display = muted ? '' : 'none';
    volW1.style.display = muted ? 'none' : '';
    volW2.style.display = muted ? 'none' : '';
  }

  // ── Quality chip ──────────────────────────────────────────────────
  // One button, three states, because a popup menu on a phone in fullscreen is
  // more chrome than this earns. The label reports what is actually happening
  // ("AUTO · BALANCED", "SAVER"), and the tooltip names the next state.
  const MODE_HINT = {
    auto:  'Quality: Auto — follows your connection. Click for High.',
    high:  'Quality: High — always full size. Click for Data Saver.',
    saver: 'Quality: Data Saver — smallest files, tap to play. Click for Auto.'
  };
  function syncQualityBtn() {
    if (!qualityBtn || !window.LaxtNet) return;
    const mode = window.LaxtNet.mode();
    qualityBtn.textContent = window.LaxtNet.label();
    qualityBtn.title = MODE_HINT[mode] || '';
    qualityBtn.dataset.mode = mode;
  }
  if (qualityBtn) {
    if (!window.LaxtNet) qualityBtn.style.display = 'none';   // engine absent → no control to offer
    qualityBtn.addEventListener('click', e => {
      e.stopPropagation();
      window.LaxtNet.cycleMode();
      syncQualityBtn();
    });
  }
  // The chip's label and the open video both follow a tier change — including
  // one the visitor didn't cause, like walking off Wi-Fi mid-clip.
  document.addEventListener('laxt:quality-change', () => {
    syncQualityBtn();
    if (!overlay.classList.contains('fsv-active')) return;
    const item = items[currentIdx];
    if (!item || item.type === 'photo') return;
    const want = netVideoSrc(item.src);
    if (video.src === want) return;          // no rendition to switch to
    const at = video.currentTime, playing = !video.paused;
    video.src = want;
    video.load();
    const resume = () => {
      if (at > 0) { try { video.currentTime = at; } catch (err) {} }
      if (playing) video.play().catch(() => {});
    };
    if (video.readyState >= 1) resume();
    else video.addEventListener('loadedmetadata', resume, { once: true });
  });
  watchStalls(video);

  // ── Load item at index ──
  function loadItem(idx) {
    currentIdx = idx;
    const item = items[idx];

    catEl.textContent  = item.cat  || '';
    nameEl.textContent = item.name || '';
    counterEl.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';

    prevBtn.classList.toggle('fsv-hidden', items.length <= 1);
    nextBtn.classList.toggle('fsv-hidden', items.length <= 1);

    // Stop current video
    video.pause();
    video.src = '';
    video.removeAttribute('poster');   // else the previous item's frame lingers
    video.load();

    if (item.type === 'photo') {
      overlay.className = 'fsv-overlay fsv-active fsv-type-photo';
      img.src = item.src;
      img.alt = item.name || '';
    } else {
      overlay.className = 'fsv-overlay fsv-active fsv-type-video';
      img.src = '';
      // Poster first, so the viewer opens on the frame instead of on black
      // while the MP4's headers and first keyframe come off Drive.
      video.poster = item.poster || '';
      // Opening the viewer IS an explicit request for this one video, so it
      // plays on every tier — but a slow link is not asked to buffer the whole
      // file ahead of playback.
      video.preload = netPreload() === 'none' ? 'metadata' : 'auto';
      video.src = netVideoSrc(item.src);
      video.volume = parseFloat(volSlider.value);
      video.muted  = false;
      seekBar.value = 0;
      updateSeekFill(0);
      currentEl.textContent  = '0:00';
      durationEl.textContent = '0:00';
      syncPlayIcon();
      syncMuteIcon();
      syncQualityBtn();
      // Autoplay
      video.load();
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
        syncMuteIcon();
      });
    }
  }

  // ── Open viewer ──
  window.fsvOpen = function (itemsArr, startIdx) {
    items = itemsArr;
    // Pause all card videos
    document.querySelectorAll('video.gal-video, video.proj-video').forEach(v => {
      if (!v.paused) { v.pause(); v.currentTime = 0; }
      v.closest('.proj, .gal-item')?.classList.remove('touch-playing');
    });
    document.body.style.overflow = 'hidden';
    loadItem(startIdx || 0);
  };

  // ── Close viewer ──
  function closeViewer() {
    overlay.classList.remove('fsv-active', 'fsv-type-photo', 'fsv-type-video');
    video.pause();
    video.src = '';
    img.src   = '';
    document.body.style.overflow = '';
    items = [];
  }

  // ── Navigation ──
  function goNext() { if (items.length > 1) loadItem((currentIdx + 1) % items.length); }
  function goPrev() { if (items.length > 1) loadItem((currentIdx - 1 + items.length) % items.length); }

  // ── Video events ──
  video.addEventListener('timeupdate', () => {
    if (seekDragging || !video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    seekBar.value = pct;
    updateSeekFill(pct);
    currentEl.textContent = fmtTime(video.currentTime);
    syncPlayIcon();
  });
  video.addEventListener('loadedmetadata', () => {
    durationEl.textContent = fmtTime(video.duration);
    seekBar.value = 0;
    updateSeekFill(0);
  });
  video.addEventListener('durationchange', () => {
    if (video.duration) durationEl.textContent = fmtTime(video.duration);
  });
  video.addEventListener('play',  syncPlayIcon);
  video.addEventListener('pause', syncPlayIcon);
  video.addEventListener('ended', syncPlayIcon);
  video.addEventListener('volumechange', () => {
    syncMuteIcon();
    volSlider.value = video.muted ? 0 : video.volume;
  });

  // ── Seek bar events ──
  seekBar.addEventListener('mousedown', () => { seekDragging = true; }, {passive:true});
  seekBar.addEventListener('touchstart', () => { seekDragging = true; }, { passive: true });
  seekBar.addEventListener('input', () => {
    const pct = parseFloat(seekBar.value);
    updateSeekFill(pct);
    if (video.duration) {
      currentEl.textContent = fmtTime((pct / 100) * video.duration);
    }
  });
  seekBar.addEventListener('change', () => {
    seekDragging = false;
    if (video.duration) {
      video.currentTime = (parseFloat(seekBar.value) / 100) * video.duration;
    }
  });
  document.addEventListener('mouseup', () => { seekDragging = false; });
  document.addEventListener('touchend', () => { seekDragging = false; });

  // ── Volume slider ──
  volSlider.addEventListener('input', () => {
    video.volume = parseFloat(volSlider.value);
    video.muted  = video.volume === 0;
    syncMuteIcon();
  });

  // ── Control button clicks ──
  playBtn.addEventListener('click', () => {
    if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
    syncPlayIcon();
  });
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 0.7; volSlider.value = 0.7; }
    syncMuteIcon();
  });

  // ── Nav buttons ──
  nextBtn.addEventListener('click', goNext);
  prevBtn.addEventListener('click', goPrev);

  // ── Close ──
  closeBtn.addEventListener('click', closeViewer);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeViewer();
  });

  // ── Keyboard ──
  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('fsv-active')) return;
    if (e.key === 'Escape')      { e.preventDefault(); closeViewer(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
    else if (e.key === ' ') {
      e.preventDefault();
      if (overlay.classList.contains('fsv-type-video')) {
        if (video.paused) video.play().catch(() => {}); else video.pause();
        syncPlayIcon();
      }
    }
  });

  // ── Inject expand button on every gal-item & proj ──
  // root is optional (defaults to document) so re-rendering one grid, or
  // appending one card, doesn't re-scan every card on the page.
  function injectExpandButtons(root) {
    const scope = root || document;
    const sel = '.gal-item[data-fs-src], .proj[data-fs-src]';
    const cards = Array.from(scope.querySelectorAll(sel));
    if (scope !== document && scope.matches && scope.matches(sel)) cards.unshift(scope);
    cards.forEach(card => {
      if (card.querySelector('.fsv-expand-btn')) return; // already injected
      const btn = document.createElement('button');
      btn.className = 'fsv-expand-btn';
      btn.title = 'Open fullscreen';
      btn.setAttribute('aria-label', 'Open fullscreen viewer');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
        <polyline points="15 3 21 3 21 9"/>
        <polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
      </svg>`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        // Build items array from the parent grid container
        const gridId  = card.closest('[id]')?.id;
        const gridSel = gridId ? `#${gridId} [data-fs-src]` : '[data-fs-src]';
        const allCards = Array.from(document.querySelectorAll(gridSel));
        const itemsArr = allCards.map(c => ({
          type:   c.dataset.fsType   || 'video',
          src:    c.dataset.fsSrc    || '',
          cat:    c.dataset.fsCat    || '',
          name:   c.dataset.fsName   || '',
          // Already-cached poster JPEG — paints instantly instead of black.
          poster: c.dataset.fsPoster || '',
        }));
        const startIdx = allCards.indexOf(card);
        fsvOpen(itemsArr, startIdx >= 0 ? startIdx : 0);
      });
      // Append into the media wrap so it sits inside the card visuals
      const wrap = card.querySelector('.gal-media-wrap') || card.querySelector('.proj-media-wrap') || card;
      wrap.appendChild(btn);
    });
  }

  // Run after DOM ready (accounts for late-injected cards).
  // Wrapped, not passed directly — the listener would hand the Event object in
  // as `root`, which has no querySelectorAll.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => injectExpandButtons());
  } else {
    injectExpandButtons();
  }
  // Expose so the media engine can re-inject expand buttons after re-rendering.
  window.fsvInjectExpandButtons = injectExpandButtons;
})();

// ── Legacy stubs — keep onclick= attributes from breaking ──
function togglePlay(id, btn) {
  const v = document.getElementById(id); if (!v) return;
  ensureLoaded(v);
  if (v.paused) {
    pauseOthers(v);
    v.removeAttribute('muted');
    v.muted = false;
    const p = v.play();
    if (p) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
    v.closest('.proj,.gal-item')?.classList.add('touch-playing');
    if (btn) btn.classList.add('playing');
  } else {
    v.pause();
    v.currentTime = 0;
    v.closest('.proj,.gal-item')?.classList.remove('touch-playing');
    if (btn) btn.classList.remove('playing');
  }
  syncMuteBtn(v);
}
function toggleMute(id, btn) {
  const v = document.getElementById(id); if (!v) return;
  v.muted = !v.muted; syncMuteBtn(v);
}
function galTogglePlay(id, btn) { togglePlay(id, btn); }
function galToggleMute(id, btn) {
  const v = document.getElementById(id); if (!v) return;
  v.muted = !v.muted; syncMuteBtn(v);
}
// PERF: Pause all CSS animations when tab is hidden
document.addEventListener('visibilitychange',()=>{
  document.documentElement.classList.toggle('page-hidden', document.hidden);
  // Also pause/play all videos
  if(document.hidden){
    document.querySelectorAll('video').forEach(v=>{if(!v.paused)v.pause();});
  }
},{passive:true});

