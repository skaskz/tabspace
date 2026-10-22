import type { Priority } from '@/types/models';
import { addDays, toDateKey } from '@/utils/date';

/**
 * Tiny quick-add parser. Recognised trailing tokens (any order, case-insensitive):
 *   today · tomorrow · someday · !high · !medium / !med · !low
 * e.g. "Push Tabspace to GitHub tomorrow !high". Tokens are only stripped from
 * the end, so a title like "Plan today's run" keeps its words.
 */
export interface QuickAddResult {
  title: string;
  dueDate?: string;
  priority?: Priority;
  someday?: boolean;
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  '!high': 'high',
  '!h': 'high',
  '!medium': 'medium',
  '!med': 'medium',
  '!m': 'medium',
  '!low': 'low',
  '!l': 'low',
};

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const out: Omit<QuickAddResult, 'title'> = {};
  let end = words.length;
  // Strip recognised tokens from the end, but always keep at least one word for the title.
  while (end > 1) {
    const w = words[end - 1].toLowerCase();
    if (w in PRIORITY_TOKENS && !out.priority) out.priority = PRIORITY_TOKENS[w];
    else if (w === 'today' && !out.dueDate && !out.someday) out.dueDate = toDateKey(now);
    else if ((w === 'tomorrow' || w === 'tmrw') && !out.dueDate && !out.someday) out.dueDate = toDateKey(addDays(now, 1));
    else if (w === 'someday' && !out.dueDate && !out.someday) out.someday = true;
    else break;
    end--;
  }
  return { title: words.slice(0, end).join(' '), ...out };
}
