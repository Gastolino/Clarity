(() => {
  'use strict';

  // ─── Ad detection selectors ──────────────────────────────────────────────────
  const AD_SELECTORS = [
    'ins.adsbygoogle',
    'ins[data-ad-client]',
    '[id^="div-gpt-ad"]',
    '[id*="google_ads_iframe"]',
    '[id*="GoogleActiveViewElement"]',
    '[data-google-query-id]',
    '[data-ad-slot]',
    '[data-ad-unit]',
    '[data-ad-zone]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="googleadservices.com"]',
    'iframe[src*="adnxs.com"]',
    'iframe[src*="rubiconproject.com"]',
    'iframe[src*="pubmatic.com"]',
    'iframe[src*="openx.net"]',
    'iframe[src*="criteo.com"]',
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[src*="media.net"]',
    'div[class*="adsbygoogle"]',
    'div[id*="ad-container"]',
    'div[class*="ad-container"]',
    'div[id*="banner-ad"]',
    'div[class*="banner-ad"]',
    'div[class*="display-ad"]',
    'div[id*="display-ad"]',
    'div[class*="advertisement"]:not([class*="no-ad"])',
    'div[id*="advertisement"]',
    '.ad-slot',
    '.ad-unit',
    '.dfp-ad',
    '.gpt-ad',
    '[data-testid*="ad"]',
    '[aria-label="advertisement"]',
    '[aria-label="Advertisement"]',
  ];

  const IAB_SIZES = new Set([
    '728x90', '970x90', '970x250', '300x250', '336x280',
    '300x600', '160x600', '320x50', '320x100', '468x60',
    '250x250', '200x200', '120x600', '120x240',
  ]);

  const AD_LABEL_PATTERNS = /^(advertisement|sponsored|ad|ads|promoted|partner content)$/i;

  const CLARITY_ATTR = 'data-clarity-replaced';
  const CLARITY_WRAPPER_CLASS = 'clarity-ad-wrapper';
  const BLOCKED_IDS = new Set(['__PWS_ROOT__', '__next', 'root', 'app', '__nuxt']);

  let settings = { enabled: true, dimMode: null };
  let wrappers = [];

  // ─── 1-in-5 calendar ratio ───────────────────────────────────────────────────
  // Every 5th detected ad gets a calendar. The other 4 are silently axed.
  let adsProcessed = 0;
  function shouldShowCalendar() {
    adsProcessed += 1;
    return adsProcessed % 5 === 1; // 1st, 6th, 11th, …
  }

  // ─── Pinterest pin IDs pre-tagged by page-hook.js ────────────────────────────
  const hookedAdIds = new Set();

  // ─── Calendar URL — always day view, always today ────────────────────────────

  function buildCalendarURL() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const params = new URLSearchParams({
      showTitle: '0',
      showNav: '1',
      showDate: '1',
      showPrint: '0',
      showTabs: '0',
      showCalendars: '0',
      showTz: '0',
      mode: 'DAY',
      dates: `${ymd}/${ymd}`,
    });
    return `https://calendar.google.com/calendar/embed?${params}`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function removeAdjacentLabels(el) {
    const candidates = [];
    if (el.previousElementSibling) candidates.push(el.previousElementSibling);
    if (el.nextElementSibling) candidates.push(el.nextElementSibling);
    if (el.parentElement) {
      Array.from(el.parentElement.children).forEach((c) => {
        if (c !== el) candidates.push(c);
      });
    }
    candidates.forEach((c) => {
      const text = (c.textContent || '').trim();
      if (AD_LABEL_PATTERNS.test(text)) {
        c.style.display = 'none';
        c.setAttribute('data-clarity-hidden-label', '1');
      }
    });
  }

  function buildEyeIcon(open) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (open) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '3');
      svg.appendChild(p); svg.appendChild(c);
    } else {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24');
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', '1'); l.setAttribute('y1', '1');
      l.setAttribute('x2', '23'); l.setAttribute('y2', '23');
      svg.appendChild(p); svg.appendChild(l);
    }
    return svg;
  }

  // ─── Safety check ────────────────────────────────────────────────────────────

  function isSafeToReplace(el) {
    if (el === document.documentElement || el === document.body) return false;
    if (el.id && BLOCKED_IDS.has(el.id)) return false;
    if (el.tagName === 'HTML' || el.tagName === 'BODY') return false;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    if (el.offsetWidth * el.offsetHeight > vw * vh * 0.6) return false;
    return true;
  }

  // ─── Axe: silently collapse the ad (4 of every 5) ───────────────────────────

  function axeAdElement(el) {
    el.setAttribute(CLARITY_ATTR, 'axed');
    el.style.setProperty('display', 'none', 'important');
    removeAdjacentLabels(el);
  }

  // ─── Replace with calendar (1 of every 5, or explicit user action) ───────────

  function replaceWithCalendar(el) {
    if (el.hasAttribute(CLARITY_ATTR)) return;
    if (el.closest(`.${CLARITY_WRAPPER_CLASS}`)) return;
    if (!isSafeToReplace(el)) return;

    const rect = el.getBoundingClientRect();
    const width  = el.offsetWidth  || rect.width  || parseInt(el.getAttribute('width'),  10) || 0;
    const height = el.offsetHeight || rect.height || parseInt(el.getAttribute('height'), 10) || 0;
    if (width < 60 || height < 30) return;

    el.setAttribute(CLARITY_ATTR, '1');

    const wrapper = document.createElement('div');
    wrapper.className = CLARITY_WRAPPER_CLASS;
    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      border-radius: 4px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.12);
    `;

    const iframe = document.createElement('iframe');
    iframe.className = 'clarity-calendar';
    iframe.src = buildCalendarURL();
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('title', 'Clarity – today\'s calendar');
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      transition: filter 0.3s, opacity 0.3s;
    `;

    const badge = document.createElement('div');
    badge.className = 'clarity-badge';
    badge.textContent = 'today';

    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'clarity-eye-btn';
    eyeBtn.setAttribute('aria-label', 'Toggle banner focus');
    eyeBtn.setAttribute('title', 'Click to focus this calendar and dim others');
    eyeBtn.appendChild(buildEyeIcon(true));

    let eyeOpen = true;
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eyeOpen = !eyeOpen;
      eyeBtn.innerHTML = '';
      eyeBtn.appendChild(buildEyeIcon(eyeOpen));
      if (eyeOpen) {
        settings.dimMode = null;
        chrome.storage.local.set({ dimMode: null });
        applyDimToOthers(wrapper, null);
      } else {
        if (settings.dimMode) {
          applyDimToOthers(wrapper, settings.dimMode);
        } else {
          promptDimMode(wrapper);
        }
      }
    });

    wrapper.appendChild(iframe);
    wrapper.appendChild(badge);
    wrapper.appendChild(eyeBtn);

    el.style.display = 'none';
    el.parentNode.insertBefore(wrapper, el);

    removeAdjacentLabels(el);
    wrappers.push(wrapper);
    return wrapper;
  }

  // ─── Route: calendar or axe based on the 1-in-5 counter ─────────────────────

  function processAdElement(el) {
    if (el.hasAttribute(CLARITY_ATTR)) return false;
    if (!isSafeToReplace(el)) return false;
    if (shouldShowCalendar()) {
      return !!replaceWithCalendar(el);
    } else {
      axeAdElement(el);
      return true;
    }
  }

  // ─── Dim all other wrappers ───────────────────────────────────────────────────

  function applyDimToOthers(activeWrapper, mode) {
    wrappers.forEach((w) => {
      if (w === activeWrapper) return;
      const iframe = w.querySelector('iframe.clarity-calendar');
      if (!iframe) return;
      iframe.style.filter  = mode === 'blur'  ? 'blur(6px)'                          : mode === 'grey' ? 'grayscale(100%) brightness(0.6)' : '';
      iframe.style.opacity = mode             ? '0.4'                                 : '';
    });
  }

  function promptDimMode(wrapper) {
    const overlay = document.createElement('div');
    overlay.className = 'clarity-dim-overlay';
    const box    = document.createElement('div');   box.className = 'clarity-dim-box';
    const title  = document.createElement('p');     title.textContent = 'What should happen to other banners?';
    const btnB   = document.createElement('button'); btnB.className = 'clarity-btn';           btnB.textContent = 'Blur them';
    const btnG   = document.createElement('button'); btnG.className = 'clarity-btn';           btnG.textContent = 'Grey them out';
    const btnC   = document.createElement('button'); btnC.className = 'clarity-btn clarity-btn-ghost'; btnC.textContent = 'Keep as-is';
    box.append(title, btnB, btnG, btnC);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = (mode) => {
      overlay.remove();
      settings.dimMode = mode;
      chrome.storage.local.set({ dimMode: mode });
      if (mode) applyDimToOthers(wrapper, mode);
    };
    btnB.addEventListener('click', () => close('blur'));
    btnG.addEventListener('click', () => close('grey'));
    btnC.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  }

  // ─── findAdContainer ─────────────────────────────────────────────────────────

  const MAX_AD_W = 1200;
  const MAX_AD_H = 1400;

  function findAdContainer(el) {
    const pinCard = el.closest('[data-test-id="pin"]');
    if (pinCard) return pinCard;
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const w = node.offsetWidth, h = node.offsetHeight;
      if (w >= 100 && h >= 100 && w <= MAX_AD_W && h <= MAX_AD_H) return node;
      node = node.parentElement;
    }
    return el;
  }

  // ─── Grey out (manual hover-bar action) ──────────────────────────────────────

  function greyOutElement(el) {
    if (!isSafeToReplace(el)) return;
    el.setAttribute(CLARITY_ATTR, 'greyed');
    el.style.transition = 'filter 0.3s, opacity 0.3s';
    el.style.filter     = 'grayscale(100%) brightness(0.55)';
    el.style.opacity    = '0.5';
    el.style.pointerEvents = 'none';
    removeAdjacentLabels(el);
  }

  // ─── Hover bar (manual action for undetected ads) ────────────────────────────

  const hoverBar = document.createElement('div');
  hoverBar.className = 'clarity-hover-bar';
  hoverBar.innerHTML = `
    <button class="clarity-hover-btn" data-action="calendar">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      Replace with Calendar
    </button>
    <button class="clarity-hover-btn clarity-hover-btn-grey" data-action="grey">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
      Grey out
    </button>
  `;
  document.documentElement.appendChild(hoverBar);

  const NATIVE_TAGS = new Set([
    'A', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE', 'ASIDE',
    'SECTION', 'UL', 'OL', 'LI', 'BUTTON', 'INPUT', 'TEXTAREA',
    'SELECT', 'LABEL', 'FORM', 'TABLE', 'IMG', 'VIDEO', 'AUDIO',
    'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE', 'PRE', 'CODE', 'SPAN',
  ]);

  function isHoverCandidate(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (el.hasAttribute(CLARITY_ATTR)) return false;
    if (el.closest(`.${CLARITY_WRAPPER_CLASS}`)) return false;
    if (NATIVE_TAGS.has(el.tagName)) return false;
    if (!isSafeToReplace(el)) return false;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < 80 || h < 40) return false;
    if (el.tagName === 'IFRAME' || el.tagName === 'INS') return true;
    if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim()).join('');
      return ownText.length < 20;
    }
    return false;
  }

  let hoverTarget = null, hideTimer = null;

  function positionHoverBar(el) {
    const rect = el.getBoundingClientRect();
    hoverBar.style.top  = `${rect.top  + window.scrollY + 8}px`;
    hoverBar.style.left = `${rect.left + window.scrollX + 8}px`;
    hoverBar.style.display = 'flex';
  }

  document.addEventListener('mouseover', (e) => {
    if (!settings.enabled) return;
    const el = e.target.closest('iframe, ins, div, section');
    if (!el || !isHoverCandidate(el)) return;
    clearTimeout(hideTimer);
    hoverTarget = el;
    positionHoverBar(el);
  });

  document.addEventListener('mouseout', (e) => {
    if (!hoverTarget) return;
    if (hoverBar.contains(e.relatedTarget)) return;
    hideTimer = setTimeout(() => { hoverBar.style.display = 'none'; hoverTarget = null; }, 180);
  });

  hoverBar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  hoverBar.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => { hoverBar.style.display = 'none'; hoverTarget = null; }, 180);
  });

  hoverBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !hoverTarget) return;
    hoverBar.style.display = 'none';
    const el = hoverTarget;
    hoverTarget = null;
    // Hover bar is always an explicit user choice — bypass the 1-in-5 counter
    if (btn.dataset.action === 'calendar') replaceWithCalendar(el);
    else greyOutElement(el);
  });

  // ─── Pinterest: find pin DOM element by pin ID ────────────────────────────────

  function findPinElementById(id) {
    // Try data-pin-id attribute (Pinterest sometimes sets this)
    let el = document.querySelector(`[data-pin-id="${id}"]`);
    if (el) return el.closest('[data-test-id="pin"]') || el;

    // Try matching an anchor href inside a pin card
    const link = document.querySelector(`a[href*="/pin/${id}/"]`);
    if (link) return link.closest('[data-test-id="pin"]') || link;

    return null;
  }

  // ─── Process a batch of hook-tagged pin IDs ───────────────────────────────────

  function processHookedPins(ids) {
    let count = 0;
    for (const id of ids) {
      const el = findPinElementById(id);
      if (!el || el.hasAttribute(CLARITY_ATTR)) continue;
      if (processAdElement(el)) count++;
    }
    if (count > 0) bumpCount(count);
  }

  // ─── Full DOM scan ────────────────────────────────────────────────────────────

  function scanAndReplace() {
    if (!settings.enabled) return;
    let count = 0;
    const seen = new Set();

    // Generic selector pass
    for (const selector of AD_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (processAdElement(el)) count++;
      });
    }

    // Pinterest: Sponsored label → pin card ancestor
    document.querySelectorAll('[title="Sponsored"], [title="sponsored"]').forEach((label) => {
      const container = findAdContainer(label);
      if (seen.has(container) || container.hasAttribute(CLARITY_ATTR)) return;
      seen.add(container);
      label.setAttribute('data-clarity-hidden-label', '1');
      if (processAdElement(container)) count++;
    });

    // Pinterest: HLS video ad → pin card ancestor
    document.querySelectorAll('video[data-test-id="duplo-hls-video"]').forEach((video) => {
      const container = findAdContainer(video);
      if (seen.has(container) || container.hasAttribute(CLARITY_ATTR)) return;
      seen.add(container);
      if (processAdElement(container)) count++;
    });

    // Pinterest: any pin whose ID was pre-tagged by page-hook.js
    for (const id of hookedAdIds) {
      const el = findPinElementById(id);
      if (!el || seen.has(el) || el.hasAttribute(CLARITY_ATTR)) continue;
      seen.add(el);
      if (processAdElement(el)) count++;
    }

    // IAB size match
    document.querySelectorAll('div, iframe').forEach((el) => {
      if (seen.has(el) || el.hasAttribute(CLARITY_ATTR)) return;
      if (IAB_SIZES.has(`${el.offsetWidth}x${el.offsetHeight}`)) {
        seen.add(el);
        if (processAdElement(el)) count++;
      }
    });

    if (count > 0) bumpCount(count);
  }

  function bumpCount(n) {
    chrome.storage.local.get(['replacedCount'], (data) => {
      chrome.storage.local.set({ replacedCount: (data.replacedCount || 0) + n });
    });
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndReplace, 800);
  }

  // When page-hook has already identified ad pin IDs, process newly added pin
  // elements immediately — no debounce — to prevent any flash of the ad.
  function checkNewNodesForHookedPins(nodes) {
    if (hookedAdIds.size === 0) return;
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const pins = node.matches('[data-test-id="pin"]')
        ? [node]
        : Array.from(node.querySelectorAll('[data-test-id="pin"]'));
      for (const pin of pins) {
        const id = getPinId(pin);
        if (id && hookedAdIds.has(id) && !pin.hasAttribute(CLARITY_ATTR)) {
          processAdElement(pin);
        }
      }
    }
  }

  function getPinId(el) {
    if (el.dataset.pinId) return el.dataset.pinId;
    const link = el.querySelector('a[href*="/pin/"]');
    if (link) { const m = link.href.match(/\/pin\/(\d+)\//); if (m) return m[1]; }
    return null;
  }

  const observer = new MutationObserver((mutations) => {
    const addedNodes = [];
    let needsScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        needsScan = true;
        m.addedNodes.forEach((n) => addedNodes.push(n));
      } else if (m.type === 'attributes') {
        needsScan = true;
      }
    }
    if (addedNodes.length > 0) checkNewNodesForHookedPins(addedNodes);
    if (needsScan) scheduleScan();
  });

  // ─── page-hook event listener ─────────────────────────────────────────────────
  // page-hook.js (MAIN world) fires this when it parses promoted pin IDs from
  // the Pinterest API feed response — before React renders those pins.

  document.addEventListener('clarity:ads-tagged', (e) => {
    if (!settings.enabled) return;
    const ids = e.detail?.ids || [];
    const newIds = [];
    for (const id of ids) {
      if (!hookedAdIds.has(id)) {
        hookedAdIds.add(id);
        newIds.push(id);
      }
    }
    // Any of these pins might already be in the DOM (e.g. re-renders, back-nav)
    if (newIds.length > 0) processHookedPins(newIds);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────

  chrome.storage.local.get(['enabled', 'dimMode'], (data) => {
    if (data.enabled !== undefined) settings.enabled = data.enabled;
    if (data.dimMode !== undefined) settings.dimMode = data.dimMode;
    if (!settings.enabled) return;

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-ad-slot', 'data-ad-client', 'title'],
    });

    setTimeout(scanAndReplace, 1200);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      Object.assign(settings, msg.payload);
      if (settings.enabled) scheduleScan();
    }
    if (msg.type === 'REPLACE_ALL') {
      clearTimeout(scanTimer);
      scanAndReplace();
    }
  });
})();
