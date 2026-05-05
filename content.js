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
    // Note: Pinterest video/sponsored are handled in the site-specific scan pass
    // because they require findAdContainer() rather than direct replacement.
  ];

  // IAB standard banner sizes (w×h) — used to validate size-based detection
  const IAB_SIZES = new Set([
    '728x90', '970x90', '970x250', '300x250', '336x280',
    '300x600', '160x600', '320x50', '320x100', '468x60',
    '250x250', '200x200', '120x600', '120x240',
  ]);

  // Caption text patterns near ads
  const AD_LABEL_PATTERNS = /^(advertisement|sponsored|ad|ads|promoted|partner content)$/i;

  // Marker so we don't double-process
  const CLARITY_ATTR = 'data-clarity-replaced';
  const CLARITY_WRAPPER_CLASS = 'clarity-ad-wrapper';

  // Elements that must never be replaced — page roots and chrome
  const BLOCKED_IDS = new Set(['__PWS_ROOT__', '__next', 'root', 'app', '__nuxt']);

  let settings = { enabled: true, dimMode: null };
  let wrappers = [];

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function getCalendarMode(width, height) {
    if (!width || !height) return 'week';
    const ratio = width / height;
    if (ratio >= 1 / 3 && ratio <= 3) return 'day';
    if (ratio > 5 || ratio < 0.2) return 'month';
    return 'week';
  }

  function getTodayParam() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  function buildCalendarURL(mode) {
    const base = 'https://calendar.google.com/calendar/embed';
    const today = getTodayParam();
    const params = new URLSearchParams({
      showTitle: '0',
      showNav: '1',
      showDate: '1',
      showPrint: '0',
      showTabs: '0',
      showCalendars: '0',
      showTz: '0',
      mode: mode.toUpperCase(),
    });
    if (mode === 'day') params.set('dates', `${today}/${today}`);
    return `${base}?${params.toString()}`;
  }

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
      const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '3');
      svg.appendChild(path1);
      svg.appendChild(circle);
    } else {
      const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '1');
      line.setAttribute('y1', '1');
      line.setAttribute('x2', '23');
      line.setAttribute('y2', '23');
      svg.appendChild(path1);
      svg.appendChild(line);
    }
    return svg;
  }

  // ─── Dim all other wrappers ───────────────────────────────────────────────────

  function applyDimToOthers(activeWrapper, mode) {
    wrappers.forEach((w) => {
      if (w === activeWrapper) return;
      const iframe = w.querySelector('iframe.clarity-calendar');
      if (!iframe) return;
      if (mode === 'blur') {
        iframe.style.filter = 'blur(6px)';
        iframe.style.opacity = '0.4';
      } else if (mode === 'grey') {
        iframe.style.filter = 'grayscale(100%) brightness(0.6)';
        iframe.style.opacity = '0.5';
      } else {
        iframe.style.filter = '';
        iframe.style.opacity = '';
      }
    });
  }

  function promptDimMode(wrapper) {
    const overlay = document.createElement('div');
    overlay.className = 'clarity-dim-overlay';

    const box = document.createElement('div');
    box.className = 'clarity-dim-box';

    const title = document.createElement('p');
    title.textContent = 'What should happen to other banners?';

    const btnBlur = document.createElement('button');
    btnBlur.className = 'clarity-btn';
    btnBlur.textContent = 'Blur them';

    const btnGrey = document.createElement('button');
    btnGrey.className = 'clarity-btn';
    btnGrey.textContent = 'Grey them out';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'clarity-btn clarity-btn-ghost';
    btnCancel.textContent = 'Keep as-is';

    box.appendChild(title);
    box.appendChild(btnBlur);
    box.appendChild(btnGrey);
    box.appendChild(btnCancel);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (mode) => {
      overlay.remove();
      settings.dimMode = mode;
      chrome.storage.local.set({ dimMode: mode });
      if (mode) applyDimToOthers(wrapper, mode);
    };

    btnBlur.addEventListener('click', () => close('blur'));
    btnGrey.addEventListener('click', () => close('grey'));
    btnCancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  }

  // ─── Walk up to the real ad container ────────────────────────────────────────
  // Prefers a semantic data-test-id="pin" ancestor (Pinterest).
  // Falls back to the first ancestor within a safe size window.
  // Never returns anything bigger than MAX_W × MAX_H to avoid grabbing page roots.

  const MAX_AD_W = 1200;
  const MAX_AD_H = 1400;

  function findAdContainer(el) {
    // Pinterest pin card — exact match, most reliable
    const pinCard = el.closest('[data-test-id="pin"]');
    if (pinCard) return pinCard;

    // Generic: walk up, stop at first element with a reasonable ad-like size
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (w >= 100 && h >= 100 && w <= MAX_AD_W && h <= MAX_AD_H) return node;
      node = node.parentElement;
    }

    // Nothing suitable found — return the element itself
    return el;
  }

  // ─── Replace a single ad element ─────────────────────────────────────────────

  function isSafeToReplace(el) {
    // Never replace page roots
    if (el === document.documentElement || el === document.body) return false;
    if (el.id && BLOCKED_IDS.has(el.id)) return false;
    if (el.tagName === 'HTML' || el.tagName === 'BODY') return false;

    // Refuse if the element covers more than 60% of the viewport area
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w * h > vw * vh * 0.6) return false;

    return true;
  }

  function replaceAdElement(el) {
    if (el.hasAttribute(CLARITY_ATTR)) return;
    if (el.closest(`.${CLARITY_WRAPPER_CLASS}`)) return;
    if (!isSafeToReplace(el)) return;

    const rect = el.getBoundingClientRect();
    const width = el.offsetWidth || rect.width || parseInt(el.getAttribute('width'), 10) || 0;
    const height = el.offsetHeight || rect.height || parseInt(el.getAttribute('height'), 10) || 0;

    if (width < 60 || height < 30) return;

    el.setAttribute(CLARITY_ATTR, '1');

    const mode = getCalendarMode(width, height);
    const calURL = buildCalendarURL(mode);

    const wrapper = document.createElement('div');
    wrapper.className = CLARITY_WRAPPER_CLASS;
    wrapper.setAttribute('data-clarity-mode', mode);
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
    iframe.src = calURL;
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      transition: filter 0.3s, opacity 0.3s;
    `;
    iframe.setAttribute('title', `Clarity – ${mode} calendar`);

    const badge = document.createElement('div');
    badge.className = 'clarity-badge';
    badge.textContent = mode;

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

  // ─── Grey out a single element (manual action) ───────────────────────────────

  function greyOutElement(el) {
    if (!isSafeToReplace(el)) return;
    el.setAttribute(CLARITY_ATTR, 'greyed');
    el.style.transition = 'filter 0.3s, opacity 0.3s';
    el.style.filter = 'grayscale(100%) brightness(0.55)';
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    removeAdjacentLabels(el);
  }

  // ─── Hover overlay for undetected ads ────────────────────────────────────────

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
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 80 || h < 40) return false;
    if (el.tagName === 'IFRAME' || el.tagName === 'INS') return true;
    if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join('');
      return ownText.length < 20;
    }
    return false;
  }

  let hoverTarget = null;
  let hideTimer = null;

  function positionHoverBar(el) {
    const rect = el.getBoundingClientRect();
    hoverBar.style.top = `${rect.top + window.scrollY + 8}px`;
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
    hideTimer = setTimeout(() => {
      hoverBar.style.display = 'none';
      hoverTarget = null;
    }, 180);
  });

  hoverBar.addEventListener('mouseenter', () => clearTimeout(hideTimer));

  hoverBar.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => {
      hoverBar.style.display = 'none';
      hoverTarget = null;
    }, 180);
  });

  hoverBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !hoverTarget) return;
    hoverBar.style.display = 'none';
    const el = hoverTarget;
    hoverTarget = null;
    if (btn.dataset.action === 'calendar') {
      replaceAdElement(el);
    } else {
      greyOutElement(el);
    }
  });

  // ─── Scan document for ads ────────────────────────────────────────────────────

  function scanAndReplace() {
    if (!settings.enabled) return;

    let count = 0;
    const seen = new Set();

    AD_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (replaceAdElement(el)) count++;
      });
    });

    // Pinterest: sponsored label → find the pin card ancestor
    document.querySelectorAll('[title="Sponsored"], [title="sponsored"]').forEach((label) => {
      const container = findAdContainer(label);
      if (seen.has(container) || container.hasAttribute(CLARITY_ATTR)) return;
      seen.add(container);
      label.setAttribute('data-clarity-hidden-label', '1');
      if (replaceAdElement(container)) count++;
    });

    // Pinterest: HLS video ad → find the pin card ancestor
    document.querySelectorAll('video[data-test-id="duplo-hls-video"]').forEach((video) => {
      const container = findAdContainer(video);
      if (seen.has(container) || container.hasAttribute(CLARITY_ATTR)) return;
      seen.add(container);
      if (replaceAdElement(container)) count++;
    });

    // IAB size match for anything not caught above
    document.querySelectorAll('div, iframe').forEach((el) => {
      if (seen.has(el) || el.hasAttribute(CLARITY_ATTR)) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (IAB_SIZES.has(`${w}x${h}`)) {
        seen.add(el);
        if (replaceAdElement(el)) count++;
      }
    });

    if (count > 0) {
      chrome.storage.local.get(['replacedCount'], (data) => {
        chrome.storage.local.set({ replacedCount: (data.replacedCount || 0) + count });
      });
    }
  }

  // ─── MutationObserver for dynamic content ─────────────────────────────────────

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    // 800ms debounce — long enough for SPA hydration bursts to settle
    scanTimer = setTimeout(scanAndReplace, 800);
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      m.addedNodes.length > 0 || (m.type === 'attributes' && m.attributeName === 'src')
    );
    if (relevant) scheduleScan();
  });

  // ─── Init — read settings directly from storage (avoids MV3 service-worker timing) ──

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

    // Delay first scan so SPA frameworks (Pinterest, etc.) have time to hydrate
    // before we measure element dimensions and walk the DOM.
    setTimeout(scanAndReplace, 1200);
  });

  // Listen for enable/disable toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      Object.assign(settings, msg.payload);
      if (settings.enabled) scheduleScan();
    }
  });
})();
