import { isSafeUrl } from '@/utils/url';

/** Open an http(s) link in a new tab from any extension surface. Non-http(s) URLs are ignored. */
export async function openUrl(url: string, active = true): Promise<boolean> {
  if (!isSafeUrl(url)) return false;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await chrome.tabs.create({ url, active });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return true;
}
