import type { QuoteState } from '@/types/models';
import { QUOTES } from './catalog';

/**
 * Daily quote rotation. The index is a pure function of the local date key,
 * so it is identical on every surface all day and changes at local midnight.
 * Stepping by a number coprime with the catalogue size visits every quote
 * once before repeating and never shows the same quote two days in a row.
 */

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function stepFor(n: number): number {
  let step = 37;
  while (n > 1 && gcd(step, n) !== 1) step++;
  return step;
}

/** Whole days between 1970-01-01 and the given `YYYY-MM-DD` (calendar arithmetic, timezone-free). */
export function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export function dailyQuoteIndex(dateKey: string, shift = 0, n = QUOTES.length): number {
  if (n <= 0) return 0;
  const raw = dayNumber(dateKey) * stepFor(n) + shift;
  return ((raw % n) + n) % n;
}

/** Manual-refresh offset that applies to `dateKey` (yesterday's refreshes don't carry over). */
export function shiftFor(state: QuoteState | undefined, dateKey: string): number {
  return state?.shift && state.shift.date === dateKey ? state.shift.n : 0;
}

export function withRefresh(state: QuoteState, dateKey: string): QuoteState {
  return { ...state, shift: { date: dateKey, n: shiftFor(state, dateKey) + 1 } };
}

export function toggleFavorite(state: QuoteState, index: number): QuoteState {
  const favs = state.favorites ?? [];
  return { ...state, favorites: favs.includes(index) ? favs.filter((i) => i !== index) : [...favs, index] };
}
