/**
 * youtube.js — Clarity YouTube ad killer
 * World: MAIN  |  run_at: document_start  |  matches: youtube.com
 *
 * Four layers, ordered from deepest to shallowest:
 *
 *  L1 – ytInitialPlayerResponse setter
 *       Intercepts the inline <script> that writes the player config before
 *       YouTube's own JS reads it. Strips adPlacements, playerAds, adSlots.
 *
 *  L2 – fetch + XHR hooks on /youtubei/v1/player
 *       Intercepts every subsequent player API response (new videos, SPA navs).
 *       Same field stripping as L1.
 *
 *  L3 – skip-button clicker + currentTime skip
 *       For any ad that survives L1/L2 (server-side injection, cached responses).
 *       Auto-clicks skip button; if unskippable, jumps currentTime to end.
 *
 *  L4 – enforcement-modal removal + nocookie-iframe fallback
 *       Removes the "disable your adblock" enforcement UI and, if it keeps
 *       reappearing, replaces the native player with the ad-free nocookie embed.
 */
(() => {
  'use strict';

  // ─── Fields to strip from every player API response ──────────────────────────
  const AD_FIELDS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adSafetyReason',
    'auxiliaryUi',          // contains enforcement overlays
  ];

  function stripAds(json) {
    if (!json || typeof json !== 'object') return;
    for (const f of AD_FIELDS) delete json[f];
    // Remove ad-related items from watchNextResults / sidebar
    const results = json?.contents?.twoColumnWatchNextResults;
    if (results?.secondaryResults) {
      const items = results.secondaryResults?.secondaryResults?.results;
      if (Array.isArray(items)) {
        results.secondaryResults.secondaryResults.results =
          items.filter((item) => !item.promotedSparklesWebRenderer && !item.compactPromotedVideoRenderer);
      }
    }
  }

  // ─── L1: ytInitialPlayerResponse setter ──────────────────────────────────────
  // YouTube inlines window.ytInitialPlayerResponse = {...} in a <script> tag.
  // By owning the setter we strip ad fields before any YouTube code reads them.

  let _ytInitialPlayerResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() { return _ytInitialPlayerResponse; },
    set(val) {
      stripAds(val);
      _ytInitialPlayerResponse = val;
    },
    configurable: true,
  });

  // Same for ytInitialData (contains promoted videos in search / home feed)
  let _ytInitialData;
  Object.defineProperty(window, 'ytInitialData', {
    get() { return _ytInitialData; },
    set(val) {
      if (val?.contents) removePromotedFromInitialData(val);
      _ytInitialData = val;
    },
    configurable: true,
  });

  function removePromotedFromInitialData(data) {
    try {
      // Home feed / search — walk all tabs' contents arrays
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (let i = obj.length - 1; i >= 0; i--) {
            const item = obj[i];
            if (
              item?.promotedSparklesWebRenderer ||
              item?.promotedVideoRenderer ||
              item?.searchPyvRenderer ||
              item?.carouselAdRenderer
            ) {
              obj.splice(i, 1);
            } else {
              walk(item);
            }
          }
        } else {
          for (const k of Object.keys(obj)) walk(obj[k]);
        }
      };
      walk(data.contents);
    } catch {}
  }

  // ─── L2a: fetch hook ─────────────────────────────────────────────────────────

  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    const response = await _fetch.apply(this, args);

    if (url.includes('/youtubei/v1/player')) {
      try {
        const json = await response.clone().json();
        stripAds(json);
        return new Response(JSON.stringify(json), {
          status:     response.status,
          statusText: response.statusText,
          headers:    response.headers,
        });
      } catch {}
    }
    return response;
  };

  // ─── L2b: XHR hook ───────────────────────────────────────────────────────────
  // Override responseText on the prototype so our getter fires before YouTube's
  // onreadystatechange handler reads the response.

  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _rtGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__clarityUrl = String(url ?? '');
    return _xhrOpen.apply(this, arguments);
  };

  Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
    get() {
      const raw = _rtGetter.call(this);
      if (
        this.__clarityUrl?.includes('/youtubei/v1/player') &&
        this.readyState === 4 &&
        raw
      ) {
        if (!this.__clarityDone) {
          this.__clarityDone = true;
          try {
            const json = JSON.parse(raw);
            stripAds(json);
            this.__clarityClean = JSON.stringify(json);
          } catch {}
        }
        return this.__clarityClean ?? raw;
      }
      return raw;
    },
    configurable: true,
  });

  // ─── L3: skip-button auto-clicker + currentTime skip ─────────────────────────

  function trySkipAd() {
    // Click the skip button (skippable pre-rolls)
    const skip = document.querySelector(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); return true; }

    // For unskippable ads: jump the video element to its end
    const video = document.querySelector('video');
    if (!video || !isFinite(video.duration)) return false;

    const adBadge = document.querySelector(
      '.ytp-ad-badge, .ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining'
    );
    if (adBadge) {
      try { video.currentTime = video.duration; } catch {}
      return true;
    }
    return false;
  }

  // ─── L4a: enforcement-modal removal ──────────────────────────────────────────

  let enforcementStrikes = 0;

  function removeEnforcementModal() {
    // Click the dismiss / "I understand" button before removing
    document.querySelector('#dismiss-button yt-button-shape button')?.click();
    document.querySelector('ytd-enforcement-message-view-model #dismiss-button')?.click();
    document.querySelector('.ytd-enforcement-message-view-model')?.remove();
    document.querySelector('ytd-enforcement-message-view-model')?.remove();

    // Remove the full-page backdrop that blocks interaction
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((el) => el.remove());

    // Unfreeze scroll (YouTube sets overflow:hidden on <body> while modal is open)
    document.body.style.setProperty('overflow-y', 'auto', 'important');

    // Resume video if paused by the enforcement code
    const video = document.querySelector('video');
    if (video?.paused) video.play().catch(() => {});

    enforcementStrikes++;

    // If the modal keeps reappearing, escalate to the nocookie-iframe fallback
    if (enforcementStrikes >= 3) {
      injectNocookiePlayer();
    }
  }

  // ─── L4b: youtube-nocookie.com iframe fallback ────────────────────────────────
  // Only invoked when enforcement modal appears 3+ times in a session
  // (meaning L1/L2 didn't fully neutralise detection on this page load).

  let iframeInjected = false;

  function injectNocookiePlayer() {
    if (iframeInjected) return;
    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    const videoId = getVideoId();
    if (!videoId) return;

    // Silence native video first
    const video = document.querySelector('video');
    if (video) { video.volume = 0; video.pause(); }
    document.querySelector('#error-screen')?.remove();

    // Remove any previously injected Clarity iframes
    player.querySelectorAll('iframe[data-clarity-yt]').forEach((f) => f.remove());

    const iframe = document.createElement('iframe');
    iframe.src = buildNocookieUrl(videoId);
    iframe.setAttribute('data-clarity-yt', '1');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    );
    iframe.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;z-index:9999;border:none;';
    player.appendChild(iframe);
    iframeInjected = true;
  }

  function getVideoId() {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const parts = u.pathname.split('/');
    const liveIdx = parts.indexOf('live');
    if (liveIdx >= 0) return parts[liveIdx + 1] || null;
    return null;
  }

  function buildNocookieUrl(id) {
    const u = new URL(location.href);
    let url = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&modestbranding=1&rel=0`;
    const t = u.searchParams.get('t');
    if (t) url += `&start=${t.replace('s', '')}`;
    const list = u.searchParams.get('list');
    if (list) url += `&listType=playlist&list=${list}`;
    return url;
  }

  // ─── Timestamp fix (restores comment timestamp clicks on nocookie iframe) ─────

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('.yt-core-attributed-string__link');
    if (!el?.href?.includes('&t=')) return;
    e.preventDefault();
    const ts = el.href.split('&t=')[1]?.split('s')[0];
    if (!ts) return;
    document.querySelectorAll('.html5-video-player iframe[data-clarity-yt]').forEach((f) => {
      f.src = f.src.replace(/[&?]start=\d*/, '') + `&start=${ts}`;
    });
  }, true);

  // ─── Suppress native video re-renders ────────────────────────────────────────
  // After iframe injection YouTube's Polymer components may re-insert <video>.

  function suppressNativeVideos() {
    document.querySelectorAll('video').forEach((v) => {
      if (!v.src?.includes('youtube.com') && !v.src?.includes('googlevideo.com')) return;
      v.muted = true;
      v.pause();
      if (!v.__clarityBound) {
        v.__clarityBound = true;
        v.addEventListener('play',         () => v.pause(),            { passive: true });
        v.addEventListener('volumechange', () => { v.muted = true; },  { passive: true });
      }
    });
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  function onMutation(mutations) {
    if (location.pathname.includes('/shorts/')) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (tag === 'VIDEO') suppressNativeVideos();
        if (
          tag === 'YTD-ENFORCEMENT-MESSAGE-VIEW-MODEL' ||
          node.querySelector?.('ytd-enforcement-message-view-model')
        ) {
          setTimeout(removeEnforcementModal, 80);
        }
        // Auto-dismiss "ad blocker detected" notice banners
        if (tag === 'TP-YT-IRON-OVERLAY-BACKDROP') {
          setTimeout(removeEnforcementModal, 80);
        }
      }
    }
  }

  const observer = new MutationObserver(onMutation);
  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true });
    }
  };
  startObserver();

  // ─── SPA navigation ───────────────────────────────────────────────────────────
  // YouTube fires 'yt-navigate-finish' after each SPA route change.

  window.addEventListener('yt-navigate-finish', () => {
    iframeInjected   = false;
    enforcementStrikes = 0;
  });

  window.addEventListener('yt-page-data-updated', () => {
    // Re-strip after YouTube injects new page data into window objects
    if (window.ytInitialPlayerResponse) stripAds(window.ytInitialPlayerResponse);
    if (window.ytInitialData) removePromotedFromInitialData(window.ytInitialData);
  });

  // ─── Polling loop ─────────────────────────────────────────────────────────────
  // Belt-and-suspenders: catches anything that slipped past the event hooks.

  setInterval(() => {
    if (location.pathname.includes('/shorts/')) return;
    trySkipAd();
    if (document.querySelector('ytd-enforcement-message-view-model, tp-yt-iron-overlay-backdrop')) {
      removeEnforcementModal();
    }
    if (iframeInjected) suppressNativeVideos();
  }, 500);
})();
