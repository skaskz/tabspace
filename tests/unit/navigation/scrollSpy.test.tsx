import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { goToSection, pickActiveSection, useScrollSpy } from '@/features/navigation/scrollSpy';
import { SectionNav } from '@/components/nav/SectionNav';

const rects = (tops: number[], h = 400) => tops.map((top, i) => ({ id: `s${i}`, top, bottom: top + h }));

describe('pickActiveSection', () => {
  const base = { readingLine: 250, viewportHeight: 800, atBottom: false };
  it('picks the last section whose top passed the reading line', () => {
    expect(pickActiveSection(rects([-500, 100, 600]), base)).toBe('s1');
    expect(pickActiveSection(rects([-900, -400, 240]), base)).toBe('s2');
    expect(pickActiveSection(rects([-900, -400, 260]), base)).toBe('s1');
  });
  it('falls back to the first section before any reaches the line', () => {
    expect(pickActiveSection(rects([400, 900]), base)).toBe('s0');
  });
  it('activates a short last section when scrolled to the bottom', () => {
    const r = [...rects([-900, -300]), { id: 'last', top: 500, bottom: 650 }];
    expect(pickActiveSection(r, base)).toBe('s1');
    expect(pickActiveSection(r, { ...base, atBottom: true })).toBe('last');
  });
  it('handles no sections', () => {
    expect(pickActiveSection([], base)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const observers: { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit }[] = [];
class FakeIO {
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    observers.push({ cb, opts });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let tops: Record<string, number> = {};
let renders = 0;

function Page() {
  renders++;
  const ids = ['alpha', 'beta', 'gamma'];
  const { active, setActive } = useScrollSpy(ids);
  return (
    <div>
      <SectionNav
        label="Sections"
        items={ids.map((id) => ({ id, label: id.toUpperCase() }))}
        active={active}
        hrefFor={(id) => `#${id}`}
        onSelect={(id) => {
          setActive(id);
          goToSection(document.getElementById(id), document.getElementById(`${id}-h`));
        }}
      />
      {ids.map((id) => (
        <section key={id} id={id}>
          <h2 id={`${id}-h`}>{id}</h2>
        </section>
      ))}
    </div>
  );
}

const fire = () => act(() => observers.forEach((o) => o.cb([], {} as IntersectionObserver)));

beforeEach(() => {
  observers.length = 0;
  renders = 0;
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = tops[this.id] ?? 0;
    return { top, bottom: top + 500, left: 0, right: 0, width: 0, height: 500, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
  // Long page: not at the bottom unless a test says so.
  Object.defineProperty(document.scrollingElement ?? document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  tops = { alpha: 0, beta: 600, gamma: 1200 };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useScrollSpy + SectionNav', () => {
  it('observes a band at the reading line and highlights the section crossing it', () => {
    render(<Page />);
    expect(observers.some((o) => o.opts?.rootMargin === '-30% 0px -69% 0px')).toBe(true);
    expect(screen.getByRole('link', { name: 'ALPHA' })).toHaveAttribute('aria-current', 'true');
    tops = { alpha: -700, beta: -100, gamma: 500 };
    fire();
    expect(screen.getByRole('link', { name: 'BETA' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'ALPHA' })).not.toHaveAttribute('aria-current');
  });

  it('re-renders only when the active section changes', () => {
    render(<Page />);
    tops = { alpha: -700, beta: -100, gamma: 500 };
    fire();
    const after = renders;
    fire();
    fire();
    expect(renders).toBe(after);
  });

  it('clicking an item highlights it at once, scrolls there and focuses its heading', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('link', { name: 'GAMMA' }));
    expect(screen.getByRole('link', { name: 'GAMMA' })).toHaveAttribute('aria-current', 'true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: expect.any(String), block: 'start' });
    expect(document.activeElement).toBe(document.getElementById('gamma-h'));
    // While the smooth scroll runs, intermediate sections don't steal the highlight.
    tops = { alpha: -700, beta: -100, gamma: 500 };
    fire();
    expect(screen.getByRole('link', { name: 'GAMMA' })).toHaveAttribute('aria-current', 'true');
  });

  it('scrolls instantly under reduced motion', () => {
    document.documentElement.dataset.motion = 'reduced';
    render(<Page />);
    fireEvent.click(screen.getByRole('link', { name: 'BETA' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    delete document.documentElement.dataset.motion;
  });
});
