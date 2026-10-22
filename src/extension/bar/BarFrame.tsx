import { useCallback, useEffect, useState } from 'react';
import { LogoMark } from '@/components/layout/Logo';
import { update } from '@/storage/store';
import { useToast } from '@/components/ui';
import { TabspaceBar } from './TabspaceBar';
import { CLOSE_ALL_EVENT } from './BarMenu';
import { siteKey, type BarMode, type BarModeMessage } from './logic';
import type { PageInfo } from './BookmarkButton';

/**
 * bar.html — the website Tabspace Bar, loaded by the content script as a
 * cross-origin extension iframe (page scripts can't read it). It finds its
 * own tab with chrome.tabs.getCurrent() (fallback: ask the worker, which sees
 * sender.tab) and tells its page's content script how big the frame should be
 * via chrome.tabs.sendMessage(tabId, …, { frameId: 0 }) — never postMessage,
 * which page scripts could observe or forge.
 */
async function findTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const t = await chrome.tabs.getCurrent();
    if (t?.id !== undefined) return t;
  } catch {
    /* fall through */
  }
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'tsbar:whoami' })) as { tab?: chrome.tabs.Tab } | undefined;
    return r?.tab ?? null;
  } catch {
    return null;
  }
}

/** Nonce the content script put in our URL hash (`#n=<uuid>`). */
export function frameNonce(hash = location.hash): string | null {
  const m = /^#n=([0-9a-f-]{36})$/i.exec(hash);
  return m ? m[1] : null;
}

/**
 * Security review V21-5: render only when embedded by our own content script in
 * this tab's top frame — the content script confirms the nonce (only it and this
 * frame know it), and the sole ancestor must be the tab's own origin. A site that
 * frames bar.html itself (e.g. with a leaked dynamic URL) gets an empty frame.
 */
export async function verifyEmbedding(tab: chrome.tabs.Tab | null, nonce: string | null, ancestors: ArrayLike<string> | undefined = location.ancestorOrigins): Promise<boolean> {
  if (!tab?.id || !tab.url || !nonce) return false;
  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return false;
  }
  if (!ancestors || ancestors.length !== 1 || ancestors[0] !== origin) return false;
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { type: 'tsbar:verify', nonce }, { frameId: 0 })) as { ok?: boolean } | undefined;
    return r?.ok === true;
  } catch {
    return false;
  }
}

export function BarFrame() {
  const toast = useToast();
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let id: number | undefined;
    void findTab().then(async (t) => {
      if (!(await verifyEmbedding(t, frameNonce()))) return; // stays empty
      setTab(t);
      setVerified(true);
      id = t?.id;
    });
    // Keep url/title fresh (single-page apps, title changes) for the bookmark button.
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo, t: chrome.tabs.Tab) => {
      if (tabId === id && (info.url || info.title)) setTab(t);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // BUG-BAR3: our page's content script saw a click/Escape on the page while a menu was open.
    const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.tab.id !== id || sender.frameId !== 0) return;
      if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'tsbar:dismiss') window.dispatchEvent(new Event(CLOSE_ALL_EVENT));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    // Focus left the bar (the user clicked the page or another window): close menus too.
    const onBlur = () => window.dispatchEvent(new Event(CLOSE_ALL_EVENT));
    window.addEventListener('blur', onBlur);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const send = useCallback(
    (mode: BarMode) => {
      if (tab?.id === undefined) return;
      const msg: BarModeMessage = { type: 'tsbar:mode', mode };
      void chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => undefined);
    },
    [tab?.id],
  );

  const page: PageInfo | null = tab?.url ? { url: tab.url, title: tab.title ?? '' } : null;

  const hideSite = async () => {
    const key = tab?.url ? siteKey(tab.url) : null;
    if (!key) return;
    await update('ts.settings', (s) => ({ ...s, tabspaceBar: { ...s.tabspaceBar, disabledSites: [...new Set([...s.tabspaceBar.disabledSites, key])] } }));
    toast(`Tabspace Bar hidden on ${key}`);
    // The content script removes the frame when it sees the setting change.
  };

  if (!verified) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Show Tabspace Bar"
        title="Show Tabspace Bar"
        onClick={() => {
          setCollapsed(false);
          send('bar');
        }}
        className="flex h-full w-full items-center justify-center rounded-b-lg border border-t-0 border-line bg-bg hover:bg-surface-2"
      >
        <LogoMark size={14} />
      </button>
    );
  }

  return (
    <TabspaceBar
      surface="frame"
      page={page}
      tabId={tab?.id}
      onMenuOpenChange={(open) => send(open ? 'expanded' : 'bar')}
      onCollapse={() => {
        setCollapsed(true);
        send('collapsed');
      }}
      onHideSite={() => void hideSite()}
    />
  );
}
