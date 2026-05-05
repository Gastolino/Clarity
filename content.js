(() => {
  'use strict';

  const HIDDEN_ATTR  = 'data-clarity-hidden';
  const PICKER_CLASS = 'clarity-picker-hover';

  // ─── All cosmetic selectors (mirrors cosmetic.css + platform-specific) ────────
  // These run via MutationObserver to catch dynamically injected ad elements that
  // cosmetic.css alone won't reach (lazy renders, SPA route changes, etc.)
  const SELECTORS = [
    'ins.adsbygoogle', 'ins[data-ad-client]',
    '[data-ad-slot]', '[data-ad-unit-path]', '[data-google-query-id]',
    '[id^="div-gpt-ad"]', '[id*="google_ads_iframe"]', '[id*="GoogleActiveViewElement"]',
    'iframe[id^="aswift"]',
    'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]',
    'iframe[src*="googleadservices.com"]',
    '[id*="ad-container"]:not([id*="no-ad"])',
    '[class*="ad-container"]:not([class*="no-ad"])',
    '[id*="banner-ad"]', '[class*="banner-ad"]',
    '[id*="ad-banner"]', '[class*="ad-banner"]',
    '[id*="display-ad"]', '[class*="display-ad"]',
    '[class*="adsbygoogle"]',
    '.ad-slot', '.ad-unit', '.dfp-ad', '.gpt-ad',
    '[aria-label="advertisement" i]',
    '[data-ad-rendered]',
    '.trc_rbox_container', '.trc_spotlight_item',
    '[id^="taboola-"]', '[class*="taboola"]',
    '.OUTBRAIN', '[class*="ob-widget"]', '[data-widget-id^="AR_"]',
    '[data-testid="placementTracking"]',
    '[data-promoted="true"]', 'shreddit-ad-post',
    '#masthead-ad',
    'ytd-display-ad-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer', 'ytd-search-pyv-renderer',
    '[data-component-type="sp-sponsored-result"]',
    '[data-testid="promoted"]', '[data-testid="ad"]',
  ];

  let settings = { enabled: true };
  let pickerActive = false;

  // ─── Core: hide a single element ─────────────────────────────────────────────

  function hide(el) {
    if (!el || el.hasAttribute(HIDDEN_ATTR)) return false;
    el.setAttribute(HIDDEN_ATTR, '1');
    el.style.setProperty('display', 'none', 'important');
    return true;
  }

  // ─── Pinterest: find pin card by pin ID extracted from JSON feed ──────────────

  function findPinById(id) {
    let el = document.querySelector(`[data-pin-id="${id}"]`);
    if (el) return el.closest('[data-test-id="pin"]') || el;
    const link = document.querySelector(`a[href*="/pin/${id}/"]`);
    if (link) return link.closest('[data-test-id="pin"]') || link;
    return null;
  }

  // ─── Full cosmetic scan ───────────────────────────────────────────────────────

  function scan() {
    if (!settings.enabled) return;
    let count = 0;

    // Generic selector pass
    for (const sel of SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => { if (hide(el)) count++; });
      } catch {}
    }

    // Pinterest: Sponsored label → hide the pin card
    document.querySelectorAll(
      '[title="Sponsored"], [title="sponsored"], [aria-label*="Sponsored" i]'
    ).forEach((label) => {
      const pin = label.closest('[data-test-id="pin"]');
      if (pin && hide(pin)) count++;
    });

    // Pinterest: video ads
    document.querySelectorAll('video[data-test-id="duplo-hls-video"]').forEach((v) => {
      const pin = v.closest('[data-test-id="pin"]') || v;
      if (hide(pin)) count++;
    });

    // Twitter/X: promoted tweets
    document.querySelectorAll('[data-testid="promotedIndicator"]').forEach((badge) => {
      const article = badge.closest('article');
      if (article && hide(article)) count++;
    });

    // Facebook: sponsored posts
    document.querySelectorAll('[aria-label="Sponsored"]').forEach((badge) => {
      const post = badge.closest('[data-pagelet*="FeedUnit"]') || badge.parentElement;
      if (post && post !== document.body && hide(post)) count++;
    });

    // Reddit: promoted posts
    document.querySelectorAll('[data-promoted="true"], shreddit-ad-post').forEach((el) => {
      if (hide(el)) count++;
    });

    // YouTube: display ads in sidebar/page
    document.querySelectorAll(
      'ytd-display-ad-renderer, ytd-promoted-video-renderer, ytd-search-pyv-renderer, #masthead-ad'
    ).forEach((el) => { if (hide(el)) count++; });

    // Custom user-defined rules (element picker)
    applyCustomRules();

    if (count > 0) bumpHiddenCount(count);
  }

  // ─── Custom rules (element picker) ───────────────────────────────────────────

  let customSelectors = [];

  function applyCustomRules() {
    for (const sel of customSelectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => hide(el));
      } catch {}
    }
  }

  function loadCustomRules() {
    chrome.storage.local.get(['customRules'], (data) => {
      customSelectors = data.customRules || [];
      if (customSelectors.length > 0) applyCustomRules();
    });
  }

  // ─── Element picker mode ──────────────────────────────────────────────────────

  let pickerHovered = null;

  function generateSelector(el) {
    // Prefer stable ID
    if (el.id && !/^\d/.test(el.id) && el.id.length < 60) {
      return `#${CSS.escape(el.id)}`;
    }
    // data-test-id
    if (el.dataset.testId) return `[data-test-id="${CSS.escape(el.dataset.testId)}"]`;
    // Stable classes (skip generated/dynamic ones)
    const stableClasses = Array.from(el.classList)
      .filter((c) => c.length > 2 && c.length < 40 && !/^[A-Z0-9]{5,}$/.test(c))
      .slice(0, 2);
    if (stableClasses.length > 0) {
      return `${el.tagName.toLowerCase()}.${stableClasses.map(CSS.escape).join('.')}`;
    }
    return el.tagName.toLowerCase();
  }

  function enablePicker() {
    pickerActive = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', onPickerHover, true);
    document.addEventListener('click',     onPickerClick, true);
    document.addEventListener('keydown',   onPickerKey,   true);
  }

  function disablePicker() {
    pickerActive = false;
    document.body.style.cursor = '';
    document.removeEventListener('mouseover', onPickerHover, true);
    document.removeEventListener('click',     onPickerClick, true);
    document.removeEventListener('keydown',   onPickerKey,   true);
    if (pickerHovered) {
      pickerHovered.classList.remove(PICKER_CLASS);
      pickerHovered = null;
    }
  }

  function onPickerHover(e) {
    e.stopPropagation();
    if (pickerHovered) pickerHovered.classList.remove(PICKER_CLASS);
    pickerHovered = e.target;
    if (pickerHovered) pickerHovered.classList.add(PICKER_CLASS);
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    disablePicker();
    const selector = generateSelector(el);
    hide(el);
    // Persist rule
    chrome.storage.local.get(['customRules'], (data) => {
      const rules = data.customRules || [];
      if (!rules.includes(selector)) {
        rules.push(selector);
        chrome.storage.local.set({ customRules: rules });
        customSelectors = rules;
      }
    });
    // Tell popup picker is done
    chrome.runtime.sendMessage({ type: 'PICKER_DONE', selector }).catch(() => {});
  }

  function onPickerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); disablePicker(); }
  }

  // ─── Storage helpers ──────────────────────────────────────────────────────────

  function bumpHiddenCount(n) {
    chrome.storage.local.get(['hiddenCount'], (data) => {
      chrome.storage.local.set({ hiddenCount: (data.hiddenCount || 0) + n });
    });
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  // When page-hook already knows a pin's ID, process it immediately on insertion
  // without waiting for the debounced scan.
  const hookedAdIds = new Set();

  function checkNewNodes(nodes) {
    if (hookedAdIds.size === 0) return;
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const pins = node.matches('[data-test-id="pin"]')
        ? [node]
        : Array.from(node.querySelectorAll('[data-test-id="pin"]'));
      for (const pin of pins) {
        const id = getPinId(pin);
        if (id && hookedAdIds.has(id)) hide(pin);
      }
    }
  }

  function getPinId(el) {
    if (el.dataset.pinId) return el.dataset.pinId;
    const a = el.querySelector('a[href*="/pin/"]');
    if (a) { const m = a.href.match(/\/pin\/(\d+)\//); if (m) return m[1]; }
    return null;
  }

  const observer = new MutationObserver((mutations) => {
    const added = [];
    let relevant = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) { relevant = true; m.addedNodes.forEach((n) => added.push(n)); }
      else if (m.type === 'attributes') relevant = true;
    }
    if (added.length > 0) checkNewNodes(added);
    if (relevant) scheduleScan();
  });

  // ─── page-hook event: Pinterest feed pins pre-tagged from JSON ────────────────

  document.addEventListener('clarity:ads-tagged', (e) => {
    if (!settings.enabled) return;
    const ids = e.detail?.ids || [];
    for (const id of ids) {
      hookedAdIds.add(id);
      const el = findPinById(id);
      if (el) hide(el);
    }
  });

  // ─── Messages from popup ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      Object.assign(settings, msg.payload);
      if (settings.enabled) scheduleScan();
    }
    if (msg.type === 'SCAN_NOW') {
      clearTimeout(scanTimer);
      scan();
    }
    if (msg.type === 'PICKER_START') enablePicker();
    if (msg.type === 'PICKER_CANCEL') disablePicker();
    if (msg.type === 'CLEAR_CUSTOM_RULES') {
      customSelectors = [];
      chrome.storage.local.set({ customRules: [] });
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────

  chrome.storage.local.get(['enabled'], (data) => {
    if (data.enabled !== undefined) settings.enabled = data.enabled;
    if (!settings.enabled) return;
    loadCustomRules();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-ad-slot', 'title', 'aria-label', 'data-promoted'],
    });
    setTimeout(scan, 800);
  });
})();
