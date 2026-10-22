import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Providers } from '@/app/Providers';
import '@/styles/global.css';

/**
 * Mount a Tabspace page. Pages are never meant to be framed (security review
 * V21-5, defence in depth behind web_accessible_resources): if one is, it
 * renders nothing. Only bar.html opts in (`allowFramed`), and it verifies its
 * embedder itself.
 */
export function mount(node: ReactNode, opts: { allowFramed?: boolean } = {}) {
  if (!opts.allowFramed && window.top !== window) {
    document.body.replaceChildren();
    return;
  }
  const el = document.getElementById('root');
  if (!el) throw new Error('Missing #root');
  createRoot(el).render(
    <StrictMode>
      <Providers>{node}</Providers>
    </StrictMode>,
  );
}
