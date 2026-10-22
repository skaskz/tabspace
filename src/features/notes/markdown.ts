/**
 * Small, XSS-safe Markdown renderer for notes.
 *
 * Safety model: the entire source is HTML-escaped FIRST, so no user-supplied
 * tag or attribute can survive. The renderer then emits only a fixed set of
 * tags (h1-h3, p, ul/ol/li, read-only task checkboxes, strong/em/code,
 * blockquote, a, br, hr) with attributes it builds itself. Link targets must be
 * http(s) and may not contain quotes or whitespace (already escaped anyway).
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Undo our own escaping (for URL protocol validation only). */
function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function safeHref(escapedUrl: string): string | null {
  const raw = unescapeHtml(escapedUrl).trim();
  if (!/^https?:\/\/[^\s"'<>`]+$/i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return escapeHtml(u.toString());
  } catch {
    return null;
  }
}

/** Inline formatting on an already-escaped string. */
export function renderInline(escaped: string): string {
  const codes: string[] = [];
  // Protect code spans from further formatting.
  let s = escaped.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  const links: string[] = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
    const href = safeHref(url);
    if (!href) return text; // unsafe link: keep the text, drop the link
    links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${formatEmphasis(text)}</a>`);
    return `\uE001${links.length - 1}\uE001`;
  });
  s = formatEmphasis(s);
  s = s.replace(/\uE001(\d+)\uE001/g, (_, i: string) => links[Number(i)]);
  s = s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]);
  return s;
}

function formatEmphasis(s: string): string {
  return s
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
}

type ListKind = 'ul' | 'ol';

export function renderMarkdown(source: string): string {
  // Strip private-use placeholder chars so they can't collide with our placeholders.
  const lines = escapeHtml(source.replace(/[\uE000\uE001]/g, '')).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: ListKind | null = null;
  let quote: string[] = [];
  let inFence = false;
  let fence: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    closeList();
    flushQuote();
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
        fence = [];
        inFence = false;
      } else {
        flushAll();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const n = heading[1].length;
      out.push(`<h${n}>${renderInline(heading[2].trim())}</h${n}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }
    const q = /^&gt;\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      closeList();
      quote.push(q[1]);
      continue;
    }
    flushQuote();
    const task = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (task || bullet || ordered) {
      flushPara();
      const kind: ListKind = ordered && !task && !bullet ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        out.push(kind === 'ul' ? (task ? '<ul class="ts-tasklist">' : '<ul>') : '<ol>');
        list = kind;
      }
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        out.push(`<li class="ts-task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${renderInline(task[2])}</li>`);
      } else {
        out.push(`<li>${renderInline((bullet ?? ordered)![1])}</li>`);
      }
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  if (inFence) out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
  flushAll();
  return out.join('');
}
