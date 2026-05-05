/**
 * page-hook.js — runs in the page's MAIN JavaScript context at document_start.
 *
 * Monkey-patches window.fetch and XMLHttpRequest before Pinterest's app bundle
 * loads. When a Pinterest feed endpoint responds, walks the JSON to find every
 * promoted pin, collects their IDs, and fires a "clarity:ads-tagged" CustomEvent
 * on document so the isolated-world content script can act on them immediately.
 *
 * This runs on Pinterest only (see manifest content_scripts entry).
 */
(() => {
  'use strict';

  // Feed endpoints that carry pin data with promotion flags
  const FEED_PATTERN = /\/resource\/.*Resource\/get\//;

  // ─── JSON walker ─────────────────────────────────────────────────────────────
  // Recursively visits known data-container keys looking for pin objects that
  // carry is_promoted, promoter, ad_data, or ad_match_reason.

  function collectAdIds(obj, ids) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) collectAdIds(item, ids);
      return;
    }

    // Promoted pin object
    if (
      obj.id &&
      (obj.is_promoted || obj.promoter || obj.ad_data || obj.ad_match_reason)
    ) {
      ids.add(String(obj.id));
      return; // don't recurse further into the pin's own sub-objects
    }

    // Pinterest nests results under several known key names
    for (const key of ['data', 'results', 'pins', 'items', 'stories', 'module_output', 'resource_response']) {
      if (key in obj) collectAdIds(obj[key], ids);
    }
  }

  function handleFeedPayload(text) {
    let json;
    try { json = JSON.parse(text); } catch { return; }
    const ids = new Set();
    collectAdIds(json, ids);
    if (ids.size === 0) return;
    document.dispatchEvent(
      new CustomEvent('clarity:ads-tagged', { detail: { ids: [...ids] } })
    );
  }

  // ─── Patch fetch ─────────────────────────────────────────────────────────────

  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const p = _fetch.apply(this, arguments);
    if (FEED_PATTERN.test(url)) {
      p.then((res) => {
        // Clone so the page still gets the original body
        res.clone().text().then(handleFeedPayload);
      }).catch(() => {});
    }
    return p;
  };

  // ─── Patch XMLHttpRequest ─────────────────────────────────────────────────────

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__clarityUrl = url;
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this.__clarityUrl && FEED_PATTERN.test(this.__clarityUrl)) {
      this.addEventListener('load', function () {
        handleFeedPayload(this.responseText);
      });
    }
    return _send.apply(this, arguments);
  };
})();
