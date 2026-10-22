import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/features/notes/markdown';

function dom(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('renderMarkdown — formatting', () => {
  it('headings, paragraphs and emphasis', () => {
    expect(renderMarkdown('# Title\n## Sub\n### Small')).toBe('<h1>Title</h1><h2>Sub</h2><h3>Small</h3>');
    expect(renderMarkdown('Hello **bold** and _it_ and *it2* and `code`')).toBe(
      '<p>Hello <strong>bold</strong> and <em>it</em> and <em>it2</em> and <code>code</code></p>',
    );
  });
  it('lists and read-only task checkboxes', () => {
    const d = dom(renderMarkdown('- one\n- two\n\n1. a\n2. b\n\n- [ ] todo\n- [x] done'));
    expect(d.querySelectorAll('ul > li')).toHaveLength(4);
    expect(d.querySelectorAll('ol > li')).toHaveLength(2);
    const boxes = d.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect([...boxes].every((b) => b.disabled)).toBe(true);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
  });
  it('blockquote', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });
  it('does not format inside code spans', () => {
    expect(renderMarkdown('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
  });
  it('http(s) links get target=_blank and rel=noopener noreferrer', () => {
    const a = dom(renderMarkdown('[Tabspace](https://example.com/a?b=1&c=2)')).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1&c=2');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.textContent).toBe('Tabspace');
  });
});

describe('renderMarkdown — XSS safety', () => {
  const allowedTags = new Set(['H1', 'H2', 'H3', 'P', 'UL', 'OL', 'LI', 'INPUT', 'STRONG', 'EM', 'CODE', 'PRE', 'BLOCKQUOTE', 'A', 'BR', 'HR']);
  const allowedAttrs = ['href', 'target', 'rel', 'type', 'disabled', 'checked', 'class'];
  const assertSafe = (src: string) => {
    const d = dom(renderMarkdown(src));
    for (const el of d.querySelectorAll('*')) {
      expect(allowedTags.has(el.tagName), el.tagName).toBe(true);
      for (const attr of el.getAttributeNames()) expect(allowedAttrs, attr).toContain(attr);
      const href = el.getAttribute('href');
      if (href !== null) expect(href).toMatch(/^https?:\/\//);
    }
    return d;
  };

  it('escapes raw HTML and script tags', () => {
    const d = assertSafe('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(d.querySelector('script, img')).toBeNull();
    expect(d.textContent).toContain('<script>alert(1)</script>');
  });
  it('drops javascript:, data:, vbscript: and protocol-relative links but keeps the text', () => {
    for (const url of ['javascript:alert`1`', 'JaVaScRiPt:void0', 'data:text/html;base64,xx', 'vbscript:msgbox', '//evil.com']) {
      const d = assertSafe(`[click](${url})`);
      expect(d.querySelector('a')).toBeNull();
      expect(d.textContent).not.toContain('<');
    }
    // Parentheses end the URL early; whatever remains is plain text, never a link.
    const d = assertSafe('[click](javascript:alert(1))');
    expect(d.querySelector('a')).toBeNull();
    expect(d.textContent).toBe('click)');
  });
  it('blocks attribute injection through link URLs', () => {
    const d = assertSafe('[x](https://a.com/"onmouseover="alert(1))');
    const a = d.querySelector('a');
    if (a) expect(a.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
    assertSafe("[x](https://a.com/'onmouseover='alert(1))");
  });
  it('blocks injection through link text, headings, tasks and quotes', () => {
    assertSafe('[<img src=x onerror=alert(1)>](https://a.com)');
    assertSafe('# <svg onload=alert(1)>');
    assertSafe('- [ ] <iframe src="javascript:alert(1)">');
    assertSafe('> <a href="javascript:alert(1)">x</a>');
  });
  it('escapes HTML inside fenced code blocks', () => {
    const d = assertSafe('```\n<b onclick="x()">hi</b>\n```');
    expect(d.querySelector('pre code')!.textContent).toBe('<b onclick="x()">hi</b>');
  });
  it('placeholder characters in the source cannot smuggle markup', () => {
    const d = assertSafe('0 [a](https://a.com) 0 `c`');
    expect(d.querySelectorAll('a')).toHaveLength(1);
  });
});
