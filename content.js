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

  let settings = { enabled: true, dimMode: null };
  let wrappers = [];

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function getCalendarMode(width, height) {
    if (!width || !height) return 'week';
    const ratio = width / height;
    // If ratio is between 1/3 and 3 → day view (roughly square-ish)
    if (ratio >= 1 / 3 && ratio <= 3) return 'day';
    // Very wide (ratio > 5) or very tall (ratio < 0.2) → month
    if (ratio > 5 || ratio < 0.2) return 'month';
    // Moderately extreme → week
    return 'week';
  }

  function getTodayParam() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    return ymd;
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
    if (mode === 'day') {
      params.set('dates', `${today}/${today}`);
    }
    return `${base}?${params.toString()}`;
  }

  function removeAdjacentLabels(el) {
    // Walk siblings and parent's direct children looking for ad labels
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
      // eye open
      const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path1.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '3');
      svg.appendChild(path1);
      svg.appendChild(circle);
    } else {
      // eye closed (slash through)
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
      // hide labels of dimmed ones
      if (mode) {
        w.querySelectorAll('[data-clarity-hidden-label]').forEach((l) => {
          l.style.display = 'none';
        });
      }
    });
  }

  function promptDimMode(wrapper) {
    // Simple in-page modal instead of native confirm (avoids permission issues)
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
      chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload: { dimMode: mode } });
      if (mode) applyDimToOthers(wrapper, mode);
    };

    btnBlur.addEventListener('click', () => close('blur'));
    btnGrey.addEventListener('click', () => close('grey'));
    btnCancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  }

  // ─── Replace a single ad element ─────────────────────────────────────────────

  function replaceAdElement(el) {
    if (el.hasAttribute(CLARITY_ATTR)) return;
    if (el.closest(`.${CLARITY_WRAPPER_CLASS}`)) return;

    // Resolve dimensions — use explicit attributes or bounding rect
    const rect = el.getBoundingClientRect();
    let width = el.offsetWidth || rect.width || parseInt(el.getAttribute('width'), 10) || 0;
    let height = el.offsetHeight || rect.height || parseInt(el.getAttribute('height'), 10) || 0;

    // Skip elements too small to be real ads
    if (width < 60 || height < 30) return;

    el.setAttribute(CLARITY_ATTR, '1');

    const mode = getCalendarMode(width, height);
    const calURL = buildCalendarURL(mode);

    // Build wrapper
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

    // Calendar iframe
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

    // Mode badge
    const badge = document.createElement('div');
    badge.className = 'clarity-badge';
    badge.textContent = mode;

    // Eye toggle button
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
        // Restore all
        settings.dimMode = null;
        chrome.runtime.sendMessage({ type: 'SET_SETTINGS', payload: { dimMode: null } });
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

    // Replace original element in DOM
    el.style.display = 'none';
    el.parentNode.insertBefore(wrapper, el);

    removeAdjacentLabels(el);

    wrappers.push(wrapper);

    return wrapper;
  }

  // ─── Grey out a single element (manual action) ───────────────────────────────

  function greyOutElement(el) {
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

  // Elements that are native page content — never show hover bar on these
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
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 80 || h < 40) return false;
    // Must be iframe, ins, or a div/section with no substantial text of its own
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
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    hoverBar.style.top = `${rect.top + scrollY + 8}px`;
    hoverBar.style.left = `${rect.left + scrollX + 8}px`;
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
    // Don't hide if moving into the bar itself
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

    // Also scan iframes/divs that match IAB sizes but weren't caught by selectors
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
      chrome.runtime.sendMessage({ type: 'INCREMENT_COUNT', count });
    }
  }

  // ─── MutationObserver for dynamic content ─────────────────────────────────────

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndReplace, 400);
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      m.addedNodes.length > 0 || (m.type === 'attributes' && m.attributeName === 'src')
    );
    if (relevant) scheduleScan();
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (resp) => {
    if (resp) Object.assign(settings, resp);
    if (settings.enabled) {
      scanAndReplace();
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-ad-slot', 'data-ad-client'],
      });
    }
  });

  // Listen for enable/disable toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      Object.assign(settings, msg.payload);
      if (settings.enabled) {
        scanAndReplace();
      }
    }
  });
})();
