// Tabspace look for search results (opt-in) — companion to search-theme.css.
// Registered only for the engines the user selected and granted. It:
//  - turns the look on by setting html[data-tabspace-search="<engine>"], but only
//    when the engine itself renders in dark mode (light text); light-mode pages
//    are left untouched;
//  - adds one fixed, non-interactive starfield layer behind the page (a static
//    canvas inside a closed shadow root; no animation);
//  - removes everything live when the worker says the look was turned off.
// It reads no page content (only the hostname/query presence and the body's
// computed text colour for the dark-mode check) and makes no network requests.
/* global chrome, document, window, getComputedStyle, matchMedia, requestAnimationFrame, setTimeout, clearTimeout, URLSearchParams, location */
'use strict';

(() => {
  if (window.top !== window || globalThis.__tabspaceSearchLoaded) return;
  globalThis.__tabspaceSearchLoaded = true;

  const host = location.hostname;
  const engine = host === 'www.google.com' ? 'google' : host === 'duckduckgo.com' ? 'duckduckgo' : host === 'www.bing.com' ? 'bing' : null;
  if (!engine) return;
  // DuckDuckGo's home page shares the origin; only theme result pages.
  if (engine === 'duckduckgo' && !new URLSearchParams(location.search).has('q')) return;

  const root = document.documentElement;
  let on = true; // the worker only registers us while the look is on
  let stars = null;
  let resizeTimer = 0;

  /** Relative luminance of a CSS rgb()/rgba() colour (0 = black, 1 = white). */
  function luminance(css) {
    const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css || '');
    if (!m) return null;
    const ch = [m[1], m[2], m[3]].map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  /** The engine is in dark mode when its body text is light. */
  function engineIsDark() {
    if (!document.body) return null;
    const l = luminance(getComputedStyle(document.body).color);
    return l === null ? null : l > 0.4;
  }

  function drawStars(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const count = Math.round((w * h) / 3200);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < count; i++) {
      const big = rnd() > 0.93;
      ctx.globalAlpha = (big ? 0.55 : 0.35) * (rnd() * 0.7 + 0.3);
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, big ? rnd() * 0.9 + 0.7 : rnd() * 0.7 + 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function addStars() {
    if (stars) return;
    stars = document.createElement('tabspace-stars');
    stars.setAttribute('aria-hidden', 'true');
    stars.style.cssText = 'all:initial;position:fixed;inset:0;z-index:-1;pointer-events:none;display:block;';
    const shadow = stars.attachShadow({ mode: 'closed' });
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    shadow.appendChild(canvas);
    root.appendChild(stars);
    drawStars(canvas);
    stars.__canvas = canvas;
  }

  function removeStars() {
    stars?.remove();
    stars = null;
  }

  function enable() {
    root.setAttribute('data-tabspace-search', engine);
    if (document.body) addStars();
  }

  function disable() {
    root.removeAttribute('data-tabspace-search');
    removeStars();
  }

  function evaluate() {
    if (!on) return disable();
    const dark = engineIsDark();
    if (dark === false) return disable();
    if (dark === true || matchMedia('(prefers-color-scheme: dark)').matches) enable();
  }

  // Optimistic first paint for dark-mode devices (avoids a grey→black flash); verified once the body exists.
  if (matchMedia('(prefers-color-scheme: dark)').matches) root.setAttribute('data-tabspace-search', engine);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', evaluate, { once: true });
  else evaluate();
  window.addEventListener('load', () => requestAnimationFrame(evaluate), { once: true });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => stars && drawStars(stars.__canvas), 200);
  });

  // Live off/on from the worker (unregistering doesn't remove already-injected CSS; dropping the attribute does).
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object' || msg.type !== 'tssearch:state' || typeof msg.on !== 'boolean' || Object.keys(msg).length !== 2) return;
    on = msg.on;
    evaluate();
  });
})();
