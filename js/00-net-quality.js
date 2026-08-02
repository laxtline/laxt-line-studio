/* =====================================================================
   LAXTLINE — js/00-net-quality.js
   ---------------------------------------------------------------------
   AUTO QUALITY ENGINE  →  window.LaxtNet

   Decides HOW MUCH media this visitor's connection should be asked to
   download, and re-decides it while they browse. Everything else
   (js/04-gallery-video.js, js/05-media-engine.js) asks this file instead
   of hard-coding widths and preload values.

   THREE SIGNALS, worst one wins:
     1. Network Information API — effectiveType / downlink / saveData.
        Chrome + Android only; absent in Safari and Firefox.
     2. Measured throughput — real download speed of same-origin assets,
        read from the Resource Timing entries the browser already
        recorded. Costs zero extra requests. This is what covers the
        browsers that report nothing in (1).
     3. Rebuffering — a video that keeps stalling mid-playback is the
        most honest bandwidth signal there is, so two stalls drop the
        tier one step for the next 45s.

   THREE TIERS:
     slow   → poster-only cards, no autoplay, preload="none", small images
     medium → exactly how the site behaved before this file existed
     fast   → bigger posters, larger image candidates

   'medium' being the no-change baseline is deliberate: a browser that
   tells us nothing about the network is never made worse, only slow
   connections are throttled down and fast ones allowed more.

   VIDEO PIXELS: downscaling the actual video needs renditions from the
   CDN. Configure window.LAXT_CDN.video.qualityParam once the CDN can
   serve them and videoSrc() starts appending it — including switching
   mid-playback. Until then the tier still controls posters, image
   widths, preload and autoplay, which is where the megabytes are.

   The visitor can override the whole thing from the fullscreen viewer:
   Auto / High / Saver, remembered in localStorage.
   ===================================================================== */
(function () {
  'use strict';

  const MODE_KEY = 'laxtline_quality_mode';
  const MODES    = ['auto', 'high', 'saver'];
  const TIERS    = ['slow', 'medium', 'fast'];   // ordered worst → best

  // ── Policy table ────────────────────────────────────────────────────
  //   posterW  : width requested for a video's poster JPEG (?w=)
  //   imgMax   : largest srcset candidate a gallery photo may offer
  //   preload  : <video preload> for a card that is near the viewport
  //   autoplay : may a card start playing on its own (scroll / hover)?
  //   videoH   : target video height, used only when the CDN can serve
  //              renditions (0 = original file)
  const POLICY = {
    slow:   { posterW: 360, imgMax: 600,  preload: 'none',     autoplay: false, videoH: 360 },
    medium: { posterW: 600, imgMax: 1200, preload: 'metadata', autoplay: true,  videoH: 720 },
    fast:   { posterW: 900, imgMax: 1600, preload: 'metadata', autoplay: true,  videoH: 0   }
  };

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

  let mode     = readMode();
  let measured = 0;      // EWMA of observed throughput in Mbit/s, 0 = unknown
  let stalls   = 0;      // rebuffer events in the current window
  let tier     = null;   // set by the first settle() below

  function readMode() {
    try {
      const m = localStorage.getItem(MODE_KEY);
      return MODES.indexOf(m) !== -1 ? m : 'auto';
    } catch (e) { return 'auto'; }
  }

  // ── Signal 1: what the browser claims about the connection ──────────
  function apiTier() {
    if (!conn) return null;
    // saveData is an explicit "send me less" from the user — it outranks
    // whatever the measured speed happens to be.
    if (conn.saveData) return 'slow';
    switch (conn.effectiveType) {
      case 'slow-2g':
      case '2g': return 'slow';
      case '3g': return 'medium';
      case '4g': return 'fast';
    }
    // No effectiveType but a downlink estimate (Mbit/s) — grade that instead.
    if (typeof conn.downlink === 'number' && conn.downlink > 0) return gradeMbps(conn.downlink);
    return null;
  }

  // ── Signal 2: measured throughput ───────────────────────────────────
  // A gallery card is a few hundred KB, so the interesting boundary is
  // "can this connection deliver a poster in well under a second".
  function gradeMbps(mbps) {
    if (mbps < 1.5) return 'slow';
    if (mbps < 5)   return 'medium';
    return 'fast';
  }
  function measuredTier() { return measured ? gradeMbps(measured) : null; }

  const MIN_SAMPLE_BYTES = 12 * 1024;   // smaller transfers are all latency, no signal
  const MIN_SAMPLE_MS    = 8;           // guards against a cache hit reading as infinite speed

  function feed(bytes, ms) {
    if (!bytes || bytes < MIN_SAMPLE_BYTES || !(ms >= MIN_SAMPLE_MS)) return;
    const mbps = (bytes * 8) / (ms / 1000) / 1e6;
    // Weighted toward history so one slow response can't flip the whole page
    // into saver mode, but a genuinely slow link converges within a few files.
    measured = measured ? (measured * 0.6 + mbps * 0.4) : mbps;
    settle();
  }

  function sampleEntry(e) {
    // Cross-origin responses report 0 bytes unless the server sends
    // Timing-Allow-Origin, so in practice these samples come from this
    // site's own CSS / JS / images. That is enough — they are downloaded
    // over the same connection as the CDN media.
    const bytes = e.encodedBodySize || e.transferSize || 0;
    if (!bytes) return;
    // responseEnd - responseStart is the download phase only, with queueing,
    // DNS and TTFB excluded — those measure latency, not bandwidth.
    feed(bytes, e.responseEnd - e.responseStart);
  }

  function watchTimings() {
    if (!window.performance) return;
    if (window.PerformanceObserver) {
      try {
        // buffered:true replays the entries recorded before this file ran,
        // which is where the biggest early downloads live.
        new PerformanceObserver(list => list.getEntries().forEach(sampleEntry))
          .observe({ type: 'resource', buffered: true });
        return;
      } catch (e) { /* older Safari: no {type, buffered} support */ }
    }
    try { performance.getEntriesByType('resource').forEach(sampleEntry); } catch (e) {}
  }

  // ── Signal 3: rebuffering ───────────────────────────────────────────
  // Reported by js/04-gallery-video.js when a video that had already started
  // playing runs out of data. Decays so one bad patch of signal doesn't pin
  // the visitor in saver mode for the rest of the session.
  let stallTimer = 0;
  function reportStall() {
    stalls++;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { stalls = 0; settle(); }, 45000);
    settle();
  }

  // ── Resolve the three signals into one tier ─────────────────────────
  function computeTier() {
    if (mode === 'saver') return 'slow';
    if (mode === 'high')  return 'fast';

    const seen = [apiTier(), measuredTier()].filter(Boolean);
    // Nothing measurable yet → 'medium', the pre-existing behaviour.
    let t = seen.length
      ? seen.reduce((worst, c) => (TIERS.indexOf(c) < TIERS.indexOf(worst) ? c : worst))
      : 'medium';

    // Repeated stalls beat any estimate — the video itself is the evidence.
    if (stalls >= 2) t = TIERS[Math.max(0, TIERS.indexOf(t) - 1)];
    return t;
  }

  const listeners = [];

  function notify(prev) {
    const detail = { tier: tier, prev: prev, mode: mode };
    listeners.forEach(fn => { try { fn(detail); } catch (e) {} });
    document.dispatchEvent(new CustomEvent('laxt:quality-change', { detail: detail }));
  }

  // force=true announces even when the tier is unchanged, so a mode switch
  // (High → Auto on an already-fast link) still refreshes the UI label.
  function settle(force) {
    const next = computeTier();
    const prev = tier;
    if (next === prev && !force) return;
    tier = next;
    if (prev === null) return;          // first computation isn't a change
    notify(prev);
  }

  settle();                             // establish the starting tier
  watchTimings();
  if (conn && conn.addEventListener) {
    // Wi-Fi → cellular, or a cell handing over between generations.
    conn.addEventListener('change', () => settle());
  }

  // ── CDN video rendition config (window.LAXT_CDN.video) ──────────────
  function vcfg() {
    return (window.LAXT_CDN && window.LAXT_CDN.video) || {};
  }
  // Returns the CDN query-string parameter name for video renditions, or null
  // when renditions are not configured (window.LAXT_CDN.video.qualityParam).
  // Active since 2026-07-27: the CDN serves height-based renditions via ?h=.
  function qualityParam() {
    const p = vcfg().qualityParam;
    return (typeof p === 'string' && p) ? p : null;
  }
  function videoHeight() {
    const ladder = vcfg().ladder;
    if (ladder && typeof ladder[tier] === 'number') return ladder[tier];
    return POLICY[tier].videoH;
  }
  // '' when renditions aren't available or the tier wants the original.
  function videoQuery() {
    const p = qualityParam();
    if (!p) return '';
    const h = videoHeight();
    if (!h) return '';
    return '?' + encodeURIComponent(p) + '=' + encodeURIComponent(h);
  }

  // ── Human-readable label for the viewer's quality chip ──────────────
  // Says what is actually happening. Claiming "360p" while the CDN is still
  // handing out the original file would be a lie, so without renditions the
  // label describes the data policy instead of a resolution.
  function tierLabel() {
    if (qualityParam()) {
      const h = videoHeight();
      return h ? h + 'p' : 'SOURCE';
    }
    return { slow: 'SAVER', medium: 'BALANCED', fast: 'FULL' }[tier];
  }

  const LaxtNet = {
    // ── State ──
    tier:  () => tier,
    mode:  () => mode,
    label: () => (mode === 'auto' ? 'AUTO · ' + tierLabel() : mode === 'high' ? 'HIGH' : 'SAVER'),
    saveData: () => !!(conn && conn.saveData),
    mbps:  () => measured,

    setMode(next) {
      if (MODES.indexOf(next) === -1) return;
      if (next === mode) return;
      mode = next;
      try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
      settle(true);
    },
    // Auto → High → Saver → Auto. Drives the single chip in the viewer.
    cycleMode() {
      LaxtNet.setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
      return mode;
    },

    // ── Policy ──
    posterWidth:  () => POLICY[tier].posterW,
    videoPreload: () => POLICY[tier].preload,
    allowAutoplay:  () => POLICY[tier].autoplay,
    // Hover-to-play is an aim, not an intent — on a slow link it costs
    // megabytes the visitor never asked for, so it needs a real click there.
    allowHoverPlay: () => POLICY[tier].autoplay,

    // Drop srcset candidates this connection shouldn't be offered. Never
    // returns empty — the smallest rung always survives.
    imgWidths(all) {
      const max  = POLICY[tier].imgMax;
      const kept = (all || []).filter(w => w <= max);
      return kept.length ? kept : (all || []).slice(0, 1);
    },
    // Width for the plain src= fallback (browsers without srcset support, and
    // the value the browser starts from while it evaluates candidates).
    imgWidth(preferred) {
      return Math.min(preferred || 900, POLICY[tier].imgMax);
    },

    // ── Video URLs ──
    videoQuery: videoQuery,
    // Base CDN url in, tier-appropriate url out. Identity while the CDN has
    // no renditions, so nothing about today's playback changes.
    videoSrc(base) {
      if (!base) return base;
      const q = videoQuery();
      if (!q) return base;
      return base + (base.indexOf('?') === -1 ? q : '&' + q.slice(1));
    },

    // ── Feedback in ──
    reportStall: reportStall,
    sample: feed,

    // ── Change subscription (returns an unsubscribe fn) ──
    onChange(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    }
  };

  window.LaxtNet = LaxtNet;
  console.log('[Quality] Auto quality engine active — tier:', tier, '| mode:', mode);
})();
