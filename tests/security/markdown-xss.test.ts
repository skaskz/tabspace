import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderInline, escapeHtml } from '@/features/notes/markdown';

/**
 * Security regression: the notes Markdown renderer output goes straight into
 * dangerouslySetInnerHTML (src/pages/notes/NoteEditor.tsx). Whatever the input,
 * the output must contain only the renderer's fixed tag set, no event-handler
 * / style / src attributes, and only http(s) link targets.
 */

const ALLOWED_TAGS = new Set(['H1', 'H2', 'H3', 'P', 'UL', 'OL', 'LI', 'INPUT', 'STRONG', 'EM', 'CODE', 'PRE', 'BLOCKQUOTE', 'A', 'BR', 'HR']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
  INPUT: new Set(['type', 'disabled', 'checked']),
  UL: new Set(['class']),
  LI: new Set(['class']),
};

function assertSafe(html: string, label: string) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root')!;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    expect(ALLOWED_TAGS.has(el.tagName), `${label}: unexpected <${el.tagName}>`).toBe(true);
    for (const attr of Array.from(el.attributes)) {
      const allowed = ALLOWED_ATTRS[el.tagName];
      expect(allowed?.has(attr.name) ?? false, `${label}: unexpected attribute ${attr.name} on <${el.tagName}>`).toBe(true);
      expect(attr.name.startsWith('on'), `${label}: event handler ${attr.name}`).toBe(false);
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      expect(/^https?:\/\//i.test(href), `${label}: non-http href ${href}`).toBe(true);
      expect(el.getAttribute('rel')).toContain('noopener');
      expect(new URL(href).protocol).toMatch(/^https?:$/);
    }
    if (el.tagName === 'INPUT') {
      expect(el.getAttribute('type')).toBe('checkbox');
      expect(el.hasAttribute('disabled')).toBe(true);
    }
  }
  // Belt and braces on the raw string: every '<' must open one of the renderer's own tags
  // (escaped user text such as "&lt;script" or the word "onerror=" inside text is fine).
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
    expect(ALLOWED_TAGS.has(m[1].toUpperCase()), `${label}: raw tag <${m[1]}>`).toBe(true);
  }
}

const PAYLOADS: string[] = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](  javascript:alert(1))',
  '[click](javascript&#58;alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[click](vbscript:msgbox(1))',
  '[click](file:///etc/passwd)',
  '[click](chrome://settings)',
  '[click](//evil.example/x)',
  '[x](https://ok.example/"onmouseover="alert(1))',
  "[x](https://ok.example/'onmouseover='alert(1))",
  '[x](https://ok.example/?a=<script>)',
  '[x](https://ok.example/`onmouseover=alert(1)`)',
  '[x](https://ok.example/&quot;onmouseover=&quot;alert(1))',
  '[<img src=x onerror=alert(1)>](https://ok.example)',
  '[**bold** _it_ `code`](https://ok.example/a_b_c*d*)',
  '[nested [x](javascript:alert(1))](https://ok.example)',
  '`<script>alert(1)</script>`',
  '```\n<script>alert(1)</script>\n```',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '# <script>alert(1)</script>',
  '> <img src=x onerror=alert(1)>',
  '- [x] <svg onload=alert(1)>',
  '- [ ] [t](javascript:alert(1))',
  '1. <a href="javascript:alert(1)">x</a>',
  '**<b onclick=alert(1)>x</b>**',
  '0 0 placeholder injection',
  '[a](https://ok.example)0',
  '`1`[a](https://ok.example)',
  '<a href="https://ok.example" onclick="alert(1)">x</a>',
  '<style>body{display:none}</style>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<form action="https://evil.example"><input name=x></form>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',
  '[x](https://ok.example)[y](javascript:alert(1))[z](https://ok2.example)',
  '***[x](https://a.example/*b*)***',
  '_[x](https://a.example/_b_)_',
  '[x](https://a.example/%22onmouseover=alert(1))',
  '[x](https://user:pass@a.example/)',
  '[x](http://[::1]/)',
  '\u0000<script>alert(1)</script>',
  '<scr<script>ipt>alert(1)</script>',
];

describe('notes Markdown renderer — XSS corpus', () => {
  it.each(PAYLOADS.map((p, i) => [i, p]))('payload #%i stays inert', (_i, payload) => {
    assertSafe(renderMarkdown(payload as string), String(payload));
  });

  it('payloads remain inert when combined in one document', () => {
    assertSafe(renderMarkdown(PAYLOADS.join('\n')), 'joined');
    assertSafe(renderMarkdown(PAYLOADS.join('\n\n')), 'joined-paras');
  });

  it('raw HTML is shown as text, not parsed', () => {
    const html = renderMarkdown('<b>hi</b>');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('unsafe links keep their text but lose the link', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a');
  });

  it('safe links get noopener/noreferrer and an escaped href', () => {
    const html = renderMarkdown('[ok](https://ok.example/?a=1&b=2)');
    expect(html).toContain('href="https://ok.example/?a=1&amp;b=2"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renderInline never un-escapes on its own', () => {
    const s = renderInline(escapeHtml('<img src=x onerror=alert(1)> **x**'));
    assertSafe(s, 'inline');
  });

  it('fuzz: random mixes of markdown and HTML metacharacters stay inert', () => {
    const atoms = ['<', '>', '"', "'", '`', '[', ']', '(', ')', '*', '_', '#', '>', '-', ' ', '\n', 'javascript:', 'https://a.example/', 'onerror=', 'alert(1)', '&quot;', '&#39;', '', '', '0', '```'];
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 400; n++) {
      let s = '';
      const len = 5 + Math.floor(rnd() * 40);
      for (let i = 0; i < len; i++) s += atoms[Math.floor(rnd() * atoms.length)];
      assertSafe(renderMarkdown(s), JSON.stringify(s));
    }
  });

  it('large input renders in bounded time (no catastrophic regex backtracking)', () => {
    const t0 = performance.now();
    renderMarkdown('*'.repeat(50_000) + 'a');
    renderMarkdown('['.repeat(20_000) + '](' + 'a'.repeat(20_000));
    renderMarkdown('_a'.repeat(30_000));
    renderMarkdown(('**x ' + '*'.repeat(50) + '\n').repeat(2000));
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
