import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { update } from '@/storage/store';
import { toDateKey } from '@/utils/date';
import { QUOTES, type Quote } from './catalog';
import { dailyQuoteIndex, shiftFor, toggleFavorite, withRefresh } from './daily';

/** Today's quote with refresh / favourite actions. Re-evaluates each minute so it rolls over at midnight. */
export function useDailyQuote(): { quote: Quote; index: number; favorite: boolean; refresh: () => void; toggleFav: () => void } {
  const [state] = useStore('ts.quotes');
  const now = useNow(60_000);
  const today = toDateKey(now);
  const index = dailyQuoteIndex(today, shiftFor(state, today));
  return {
    quote: QUOTES[index],
    index,
    favorite: (state.favorites ?? []).includes(index),
    refresh: () => void update('ts.quotes', (s) => withRefresh(s, toDateKey())),
    toggleFav: () => void update('ts.quotes', (s) => toggleFavorite(s, index)),
  };
}
