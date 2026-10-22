/**
 * Focus-completion chime. Service workers can't play audio, so the chime runs
 * in an offscreen document (reason AUDIO_PLAYBACK, Chrome 109+). The document
 * synthesises an original two-note chime with WebAudio oscillators — no audio
 * asset ships with the extension.
 *
 * Lifetime: Chrome closes AUDIO_PLAYBACK offscreen documents automatically
 * after ~30 s without audio, so we don't close it ourselves (an immediate close
 * could cut the chime off). Only one offscreen document may exist at a time,
 * so an existing one is reused.
 */

export const OFFSCREEN_PATH = 'offscreen.html';
export const LAST_CHIME_KEY = 'ts.session.lastChime';

export interface ChimeResult {
  ok: boolean;
  /** AudioContext state reported by the offscreen document (e.g. 'running'). */
  state?: string;
  error?: string;
  at: number;
}

type OffscreenApi = {
  createDocument(p: { url: string; reasons: string[]; justification: string }): Promise<void>;
};

let creating: Promise<void> | null = null;

async function hasOffscreenDocument(url: string): Promise<boolean> {
  if (!chrome.runtime?.getContexts) return false;
  const ctx = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [url],
  });
  return ctx.length > 0;
}

/** Create the offscreen document unless it already exists (concurrent calls share one creation). */
export async function ensureOffscreen(): Promise<boolean> {
  const api = (chrome as unknown as { offscreen?: OffscreenApi }).offscreen;
  if (!api?.createDocument) return false;
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (await hasOffscreenDocument(url)) return true;
  if (!creating) {
    creating = api
      .createDocument({ url: OFFSCREEN_PATH, reasons: ['AUDIO_PLAYBACK'], justification: 'Play a short chime when a Tabspace focus session ends.' })
      .finally(() => {
        creating = null;
      });
  }
  try {
    await creating;
  } catch (e) {
    // "Only a single offscreen document may be created" — another call won the race.
    if (!(await hasOffscreenDocument(url))) throw e;
  }
  return true;
}

/** Play the chime. Never throws; the result is also stored in session storage for diagnostics/tests. */
export async function playChime(): Promise<ChimeResult> {
  let result: ChimeResult;
  try {
    if (!(await ensureOffscreen())) {
      result = { ok: false, error: 'Offscreen documents are not available', at: Date.now() };
    } else {
      const reply = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'chime' })) as { ok?: boolean; state?: string; error?: string } | undefined;
      result = { ok: !!reply?.ok, state: reply?.state, error: reply?.error, at: Date.now() };
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
  try {
    await chrome.storage.session?.set({ [LAST_CHIME_KEY]: result });
  } catch {
    /* diagnostics only */
  }
  if (!result.ok) console.warn('[Tabspace] completion chime failed', result.error);
  return result;
}
