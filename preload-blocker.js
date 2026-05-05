(() => {
  'use strict';

  // Domains whose preconnect/dns-prefetch/preload hints and script tags we kill
  // before the browser acts on them. This runs at document_start — before any
  // ad JS has had a chance to execute or establish connections.
  const AD_DOMAINS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    'adnxs.com',
    'rubiconproject.com',
    'pubmatic.com',
    'openx.net',
    'criteo.com',
    'amazon-adsystem.com',
    'media.net',
    'outbrain.com',
    'taboola.com',
    'moatads.com',
    'scorecardresearch.com',
    'serving-sys.com',
    '2mdn.net',
    'adsafeprotected.com',
    'adroll.com',
    'advertising.com',
    'smartadserver.com',
    'sovrn.com',
    'lijit.com',
    'sharethrough.com',
    'indexexchange.com',
    'casalemedia.com',
    'contextweb.com',
    'triplelift.com',
    '33across.com',
    'appnexus.com',
    'yieldmo.com',
    'rhythmone.com',
    'spotxchange.com',
    'bidswitch.net',
    'adsymptotic.com',
    'districtm.ca',
    'adform.net',
  ];

  function isAdURL(url) {
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      return AD_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
    } catch {
      return false;
    }
  }

  function shouldKillNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName;

    // <link rel="preconnect|dns-prefetch|preload|prefetch|prerender"> to ad domains
    if (tag === 'LINK') {
      const rel = (node.getAttribute('rel') || '').toLowerCase();
      const href = node.getAttribute('href') || '';
      const killRels = ['preconnect', 'dns-prefetch', 'preload', 'prefetch', 'prerender'];
      if (killRels.some((r) => rel.includes(r)) && isAdURL(href)) return true;
    }

    // <script src="..."> from ad domains
    if (tag === 'SCRIPT') {
      const src = node.getAttribute('src') || '';
      if (src && isAdURL(src)) return true;
    }

    // <iframe src="..."> from ad domains — caught early before it loads
    if (tag === 'IFRAME') {
      const src = node.getAttribute('src') || '';
      if (src && isAdURL(src)) return true;
    }

    return false;
  }

  // Walk existing nodes already in <head> when this script runs
  function purgeExisting() {
    document.querySelectorAll('link, script, iframe').forEach((el) => {
      if (shouldKillNode(el)) el.remove();
    });
  }

  // Watch for nodes added dynamically (lazy ad loaders, header-bidding scripts, etc.)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (shouldKillNode(node)) {
          node.remove();
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // Also check children of added subtrees
          node.querySelectorAll('link, script, iframe').forEach((child) => {
            if (shouldKillNode(child)) child.remove();
          });
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Run once synchronously in case <head> already has hints
  if (document.head) purgeExisting();

  // Also purge after DOMContentLoaded to catch anything we may have missed
  document.addEventListener('DOMContentLoaded', purgeExisting, { once: true });
})();
