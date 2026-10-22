import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { ConfirmProvider, ToastProvider } from '@/components/ui';
import { set } from '@/storage/store';
import type { Bookmark } from '@/types/models';
import { useIncremental } from '@/features/search/useIncremental';
import BookmarksPage from '@/pages/bookmarks/BookmarksPage';

describe('useIncremental', () => {
  const items = Array.from({ length: 150 }, (_, i) => i);

  it('renders a window that grows by step and resets when the key changes', () => {
    const { result, rerender } = renderHook(({ list, k }) => useIncremental(list, k, 60), { initialProps: { list: items, k: 'a' } });
    expect(result.current.visible).toHaveLength(60);
    expect(result.current.remaining).toBe(90);
    act(() => result.current.more());
    expect(result.current.visible).toHaveLength(120);
    act(() => result.current.more());
    expect(result.current.visible).toHaveLength(150);
    expect(result.current.hasMore).toBe(false);
    rerender({ list: items, k: 'b' });
    expect(result.current.visible).toHaveLength(60);
  });

  it('returns short lists unchanged', () => {
    const short = [1, 2, 3];
    const { result } = renderHook(() => useIncremental(short, 'x'));
    expect(result.current.visible).toBe(short);
    expect(result.current.hasMore).toBe(false);
  });
});

describe('BookmarksPage with a large collection', () => {
  it('renders only the first window of rows plus a Show more control', async () => {
    const now = Date.now();
    const many: Bookmark[] = Array.from({ length: 2000 }, (_, i) => ({ id: `b${i}`, url: `https://site${i}.example.com/`, title: `Site ${i}`, tags: [], favorite: false, createdAt: now - i, updatedAt: now - i }));
    await set('ts.bookmarks', many);
    window.location.hash = '#/bookmarks';
    render(
      <ToastProvider>
        <ConfirmProvider>
          <BookmarksPage />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText('Site 0')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Show details for/ })).toHaveLength(60);
    const more = screen.getByRole('button', { name: /Show more \(1940 more links\)/ });
    act(() => more.click());
    expect(screen.getAllByRole('button', { name: /^Show details for/ })).toHaveLength(120);
  });
});
