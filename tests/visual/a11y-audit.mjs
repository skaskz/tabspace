// Self-contained in-page audit function (pass to page.evaluate). Extracted from ux-a11y.mjs.
export const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 5, g: 5, b: 5, a: 1 };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 1) break;
    }
    let bg = pageBg;
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
    const t = (el.innerText || el.textContent || '').trim();
    if (t) return t;
    const img = el.querySelector('img[alt]');
    if (img && img.alt) return img.alt;
    return (el.getAttribute('title') || '').trim();
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 4).join('.')} @${Math.round(el.getBoundingClientRect().x)},${Math.round(el.getBoundingClientRect().y)} html=${el.outerHTML.slice(0, 140)}`;

  const unnamed = [...document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"]')].filter(vis).filter((el) => !name(el)).map(desc);
  const unlabeled = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter((el) => {
    if (el.type === 'file' && !vis(el)) return false;
    return !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.labels && el.labels.length) && !el.getAttribute('title');
  }).map((el) => desc(el) + ` placeholder="${el.getAttribute('placeholder') || ''}"`);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(vis).map((h) => ({ l: Number(h.tagName[1] || h.getAttribute('aria-level')), t: h.textContent.trim().slice(0, 40) }));
  const skips = [];
  for (let i = 1; i < headings.length; i++) if (headings[i].l > headings[i - 1].l + 1) skips.push(`${headings[i - 1].l}:"${headings[i - 1].t}" -> ${headings[i].l}:"${headings[i].t}"`);
  const h1count = headings.filter((h) => h.l === 1).length;

  // Contrast scan over text nodes
  const low = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const tn = walker.currentNode;
    if (!tn.textContent.trim()) continue;
    const el = tn.parentElement;
    if (!el || !vis(el)) continue;
    if (el.closest('[aria-hidden="true"], svg')) continue;
    const s = getComputedStyle(el);
    let fg = parse(s.color);
    if (!fg) continue;
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    const bg = bgOf(el);
    fg = blend({ ...fg, a: fg.a * op }, bg);
    const r = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const disabled = el.closest('button:disabled, [aria-disabled="true"], input:disabled');
    if (r < need && !disabled) {
      const key = `${s.color}|${Math.round(r * 100)}|${size}`;
      const txt = tn.textContent.trim().slice(0, 40);
      if (seen.has(key + txt)) continue;
      seen.add(key + txt);
      low.push({ txt, ratio: Math.round(r * 100) / 100, size, color: s.color, cls: String(el.className).slice(0, 70) });
    }
  }
  // placeholders
  const ph = [...document.querySelectorAll('input[placeholder], textarea[placeholder]')].filter(vis).map((el) => {
    const c = parse(getComputedStyle(el, '::placeholder').color);
    const bg = bgOf(el);
    return c ? { ph: el.placeholder.slice(0, 40), ratio: Math.round(ratio(blend(c, bg), bg) * 100) / 100 } : null;
  }).filter((x) => x && x.ratio < 4.5);
  return { unnamed, unlabeled, headings: headings.map((h) => h.l + ' ' + h.t), skips, h1count, lowContrast: low.slice(0, 40), lowContrastCount: low.length, placeholderLow: ph };
};
