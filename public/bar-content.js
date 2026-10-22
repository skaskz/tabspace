// Tabspace Bar content script (website bar, opt-in). Registered dynamically via
// chrome.scripting.registerContentScripts only after the user enables the
// website bar and grants the optional permissions.
//
// It inserts ONE element: a host with a closed shadow root containing an
// <iframe> of the extension's bar.html. All bookmark data lives inside that
// cross-origin extension frame, so the page can't read it. This script only:
//  - asks the service worker whether to show (it never reads extension storage),
//  - sizes the frame (bar / expanded menu / collapsed tab) and closes an open
//    bar menu when the page is clicked,
//  - pushes the page down 34px and moves the page's own fixed/sticky top
//    headers down with it, restoring everything when the bar goes away,
//  - hides in fullscreen, re-inserts the bar once if the page removes it,
//  - answers a per-page nonce so the frame can prove it was embedded by us,
//  - pins the host's visibility styles so the page can't make the bar
//    invisible-but-clickable (clickjacking).
/* global chrome, document, window, MutationObserver, crypto, getComputedStyle, requestIdleCallback, setTimeout, clearTimeout, Element */
'use strict';

(() => {
  if (window.top !== window || globalThis.__tabspaceBarLoaded) return;
  globalThis.__tabspaceBarLoaded = true;

  const HEIGHT = 34;
  const EXPANDED = 440;
  const MODES = ['bar', 'expanded', 'collapsed'];
  const MAX_CANDIDATES = 200;
  // Random per page; only our iframe (inside the closed shadow root) knows it.
  const NONCE = crypto.randomUUID();
  // Pinned on the host as inline !important declarations, which beat any page stylesheet rule.
  const PINNED = {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    'z-index': '2147483647',
    opacity: '1',
    visibility: 'visible',
    filter: 'none',
    'clip-path': 'none',
    'mask-image': 'none',
    transform: 'none',
    'mix-blend-mode': 'normal',
    'pointer-events': 'auto',
    contain: 'none',
  };
  let host = null;
  let frame = null;
  let guard = null;
  let removalWatch = null;
  let mode = 'bar';
  let prevMargin = null;
  let reinsertedAt = 0;
  let gaveUp = false;

  /* ---------------------------------------------------------------- */
  /* Host pinning (clickjacking)                                      */
  /* ---------------------------------------------------------------- */

  const GUARDED = { attributes: true, attributeFilter: ['style', 'class', 'hidden'] };

  function pin() {
    if (!host) return;
    // Our own writes must not re-trigger the observer (that could loop where a property is unsupported).
    guard?.disconnect();
    pinNow();
    guard?.observe(host, GUARDED);
  }

  function pinNow() {
    const s = host.style;
    for (const [k, v] of Object.entries(PINNED)) if (s.getPropertyValue(k) !== v || s.getPropertyPriority(k) !== 'important') s.setProperty(k, v, 'important');
    const display = document.fullscreenElement ? 'none' : 'block';
    if (s.getPropertyValue('display') !== display || s.getPropertyPriority('display') !== 'important') s.setProperty('display', display, 'important');
    if (host.hasAttribute('class')) host.removeAttribute('class');
    if (host.hasAttribute('hidden')) host.removeAttribute('hidden');
  }

  /* ---------------------------------------------------------------- */
  /* Page shift: html margin + the page's fixed/sticky top headers    */
  /* ---------------------------------------------------------------- */

  function shiftPage(on) {
    const s = document.documentElement.style;
    if (on) {
      if (prevMargin === null) prevMargin = { value: s.getPropertyValue('margin-top'), priority: s.getPropertyPriority('margin-top') };
      s.setProperty('margin-top', HEIGHT + 'px', 'important');
    } else if (prevMargin !== null) {
      if (prevMargin.value) s.setProperty('margin-top', prevMargin.value, prevMargin.priority);
      else s.removeProperty('margin-top');
      prevMargin = null;
    }
  }

  // element -> its original inline `top` (value + priority), so it can be restored exactly.
  const moved = new Map();
  let scanTimer = 0;
  let scanQueued = false;

  function candidates() {
    const out = new Set();
    const add = (el) => el && el !== host && el !== document.documentElement && el !== document.body && out.size < MAX_CANDIDATES && out.add(el);
    // 1) Whatever sits under the bar strip right now (fixed headers covered by the bar), and their ancestors.
    const w = window.innerWidth;
    for (const x of [8, Math.round(w * 0.25), Math.round(w / 2), Math.round(w * 0.75), w - 8]) {
      for (const y of [6, HEIGHT - 6]) {
        for (let el of document.elementsFromPoint(x, y)) {
          for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) add(el);
        }
      }
    }
    // 2) Cheap heuristics for sticky headers that aren't stuck yet.
    for (const el of document.body ? document.body.children : []) add(el);
    for (const el of document.querySelectorAll('header, nav, [role="banner"], [class*="header" i], [id*="header" i], [class*="navbar" i], [class*="topbar" i], [class*="sticky" i]')) {
      if (out.size >= MAX_CANDIDATES) break;
      add(el);
    }
    return out;
  }

  function scanHeaders() {
    scanQueued = false;
    if (!host || mode === 'collapsed' || document.fullscreenElement) return;
    for (const el of moved.keys()) if (!el.isConnected) moved.delete(el);
    for (const el of candidates()) {
      if (!(el instanceof Element)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const top = parseFloat(cs.top);
      if (!Number.isFinite(top)) continue; // top:auto — not pinned to the top edge
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Fixed: currently under the bar. Sticky: will stick under it (its `top` is within the bar's height).
      const under = cs.position === 'fixed' ? rect.top < HEIGHT && rect.bottom > 0 && top < HEIGHT : top < HEIGHT;
      if (!under) continue;
      const s = el.style;
      if (!moved.has(el)) moved.set(el, { value: s.getPropertyValue('top'), priority: s.getPropertyPriority('top') });
      // `top` here is the page's own value: once shifted it is >= HEIGHT and the element is skipped above,
      // so re-shifting only happens if the page reset it.
      s.setProperty('top', `calc(${top}px + ${HEIGHT}px)`, 'important');
    }
  }

  function restoreHeaders() {
    for (const [el, orig] of moved) {
      if (orig.value) el.style.setProperty('top', orig.value, orig.priority);
      else el.style.removeProperty('top');
    }
    moved.clear();
  }

  /** Throttled, idle-time re-scan (DOM changes, resize, scroll). */
  function queueScan(delay = 150) {
    if (scanQueued || !host) return;
    scanQueued = true;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(scanHeaders, { timeout: 500 }) : scanHeaders()), delay);
  }

  /* ---------------------------------------------------------------- */
  /* Mode / mount                                                     */
  /* ---------------------------------------------------------------- */

  function apply() {
    if (!host) return;
    const fullscreen = !!document.fullscreenElement;
    pin();
    const f = frame.style;
    if (mode === 'collapsed') {
      f.left = 'auto';
      f.right = '16px';
      f.width = '40px';
      f.height = '20px';
    } else {
      f.left = '0';
      f.right = '0';
      f.width = '100%';
      f.height = (mode === 'expanded' ? EXPANDED : HEIGHT) + 'px';
    }
    const shifted = !fullscreen && mode !== 'collapsed';
    shiftPage(shifted);
    if (shifted) queueScan(0);
    else restoreHeaders();
  }

  /** Close an open bar menu: shrink the frame now and tell our frame (in this tab) to close its menus. */
  function dismiss() {
    if (mode !== 'expanded') return;
    mode = 'bar';
    apply();
    chrome.runtime.sendMessage({ type: 'tsbar:dismiss' }).catch(() => undefined);
  }

  const onPointerDown = () => dismiss(); // events inside the bar's own iframe never reach the page document
  const onKeyDown = (e) => e.key === 'Escape' && dismiss();
  const onScroll = () => queueScan(250);
  const onResize = () => queueScan(150);
  let domWatch = null;

  function watchRemoval() {
    // BUG-BAR2: the page removing our host re-inserts it once; removed again soon after → give up cleanly.
    removalWatch = new MutationObserver(() => {
      if (!host || host.isConnected) return;
      const now = Date.now();
      if (reinsertedAt && now - reinsertedAt < 3000) {
        gaveUp = true;
        teardown();
        return;
      }
      reinsertedAt = now;
      document.documentElement.appendChild(host);
      apply();
    });
    removalWatch.observe(document.documentElement, { childList: true });
  }

  function mount() {
    if (host || gaveUp) return;
    host = document.createElement('tabspace-bar');
    host.style.cssText = 'all: initial !important;'; // reset once; longhands are pinned below (re-pinning a shorthand would loop)
    const root = host.attachShadow({ mode: 'closed' });
    frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('bar.html') + '#n=' + NONCE;
    frame.title = 'Tabspace Bar';
    frame.setAttribute('allowtransparency', 'true');
    frame.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:100%;height:' + HEIGHT + 'px;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;z-index:2147483647;';
    root.appendChild(frame);
    document.documentElement.appendChild(host);
    // Re-pin if the page edits the host's style/class attributes.
    guard = new MutationObserver(pin);
    guard.observe(host, GUARDED);
    watchRemoval();
    domWatch = new MutationObserver(() => queueScan(300));
    if (document.body) domWatch.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize, { passive: true });
    mode = 'bar';
    apply();
  }

  function teardown() {
    guard?.disconnect();
    removalWatch?.disconnect();
    domWatch?.disconnect();
    guard = removalWatch = domWatch = null;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onResize);
    clearTimeout(scanTimer);
    scanQueued = false;
    if (host?.isConnected) host.remove();
    host = null;
    frame = null;
    restoreHeaders();
    shiftPage(false);
  }

  function unmount() {
    if (host) teardown();
  }

  const sync = (show) => (show === true ? mount() : unmount());
  // The worker decides from the settings and this frame's URL (it sees sender.url); no storage access here.
  chrome.runtime.sendMessage({ type: 'tsbar:query' }).then((r) => sync(!!r && r.show === true), () => undefined);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object' || Object.keys(msg).length !== 2) return;
    if (msg.type === 'tsbar:mode' && MODES.includes(msg.mode)) {
      mode = msg.mode;
      apply();
    } else if (msg.type === 'tsbar:state' && typeof msg.show === 'boolean') {
      sync(msg.show);
    } else if (msg.type === 'tsbar:verify' && typeof msg.nonce === 'string') {
      sendResponse({ ok: !!host && msg.nonce === NONCE });
    }
  });

  document.addEventListener('fullscreenchange', apply);
})();
