import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Profiler } from 'react';
import { easeFactor, normalisePointer, PARALLAX_DEPTHS, parallaxOffsets, stepParallax } from '@/components/layout/parallax';
import { Starfield } from '@/components/layout/Starfield';

describe('parallax math', () => {
  it('normalises the pointer to [-1, 1] with the viewport centre at 0', () => {
    expect(normalisePointer(500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
    expect(normalisePointer(0, 0, 1000, 800)).toEqual({ x: -1, y: -1 });
    expect(normalisePointer(1000, 800, 1000, 800)).toEqual({ x: 1, y: 1 });
    expect(normalisePointer(750, 200, 1000, 800)).toEqual({ x: 0.5, y: -0.5 });
  });

  it('clamps pointers outside the viewport and guards degenerate sizes', () => {
    expect(normalisePointer(-300, 5000, 1000, 800)).toEqual({ x: -1, y: 1 });
    expect(normalisePointer(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(normalisePointer(Number.NaN, 10, 1000, 800).x).toBe(0);
  });

  it('gives far 2px, mid 6px, near 14px max offsets, moving opposite the pointer', () => {
    expect(PARALLAX_DEPTHS).toEqual([2, 6, 14]);
    expect(parallaxOffsets({ x: 1, y: -1 })).toEqual([
      { x: -2, y: 2 },
      { x: -6, y: 6 },
      { x: -14, y: 14 },
    ]);
    const centred = parallaxOffsets({ x: 0, y: 0 });
    expect(centred.every((o) => Object.is(o.x, 0) && Object.is(o.y, 0))).toBe(true);
  });

  it('nearer layers always move more, and nothing exceeds its max even for out-of-range input', () => {
    const [far, mid, near] = parallaxOffsets({ x: 0.4, y: 0.7 });
    expect(Math.abs(far.x)).toBeLessThan(Math.abs(mid.x));
    expect(Math.abs(mid.x)).toBeLessThan(Math.abs(near.x));
    const wild = parallaxOffsets({ x: 9, y: -42 });
    wild.forEach((o, i) => {
      expect(Math.abs(o.x)).toBeLessThanOrEqual(PARALLAX_DEPTHS[i]);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(PARALLAX_DEPTHS[i]);
    });
  });

  it('smoothing is frame-rate independent and settles (snaps) onto the target', () => {
    // Two 60 Hz frames ≈ one 30 Hz frame.
    const k60 = easeFactor(1000 / 60);
    const k30 = easeFactor(2000 / 60);
    expect(1 - (1 - k60) ** 2).toBeCloseTo(k30, 10);
    expect(easeFactor(0)).toBe(0);
    let cur = { x: 0, y: 0 };
    const target = { x: 1, y: -0.5 };
    let frames = 0;
    let settled = false;
    while (!settled && frames < 500) {
      ({ next: cur, settled } = stepParallax(cur, target, 1000 / 60));
      frames++;
    }
    expect(settled).toBe(true);
    expect(cur).toEqual(target);
    expect(frames).toBeLessThan(90); // settles in well under 1.5 s, then the loop can stop
  });
});

describe('<Starfield parallax>', () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;
  const flushFrame = () => {
    const queued = frames;
    frames = [];
    now += 1000 / 60;
    queued.forEach((cb) => cb(now));
  };

  beforeEach(() => {
    frames = [];
    // jsdom has no 2D canvas; a no-op context lets the layers "draw".
    const noop = () => undefined;
    const gradient = { addColorStop: noop };
    const ctx = new Proxy({}, { get: (_t, key) => (key === 'createLinearGradient' || key === 'createRadialGradient' ? () => gradient : noop), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames = [];
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const layers = () => Array.from(document.querySelectorAll<HTMLElement>('[data-layer]'));
  const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));

  it('renders three depth layers, each pre-rendered to its own canvas', () => {
    render(<Starfield animate parallax />);
    expect(layers().map((l) => l.dataset.layer)).toEqual(['far', 'mid', 'near']);
    expect(document.querySelectorAll('[data-layer] canvas')).toHaveLength(3);
    // Nothing animates until the pointer moves: no frame requested at rest.
    expect(frames).toHaveLength(0);
  });

  it('moves layers with translate3d on pointer move without any React re-render', () => {
    const onRender = vi.fn();
    render(
      <Profiler id="sky" onRender={onRender}>
        <Starfield animate parallax />
      </Profiler>,
    );
    const rendersAfterMount = onRender.mock.calls.length;
    act(() => {
      for (let i = 0; i < 20; i++) move(1024 - i, 0);
    });
    // Twenty events coalesce into a single pending frame.
    expect(frames).toHaveLength(1);
    act(() => {
      for (let i = 0; i < 200 && frames.length; i++) flushFrame();
    });
    expect(onRender.mock.calls.length).toBe(rendersAfterMount);
    const [far, mid, near] = layers().map((l) => l.style.transform);
    // Last pointer position (1005, 0) → layers settle opposite the pointer, scaled by depth.
    const nx = (1005 / window.innerWidth) * 2 - 1;
    expect(near).toBe(`translate3d(${(-nx * 14).toFixed(2)}px, 14.00px, 0)`);
    expect(mid).toBe(`translate3d(${(-nx * 6).toFixed(2)}px, 6.00px, 0)`);
    expect(far).toBe(`translate3d(${(-nx * 2).toFixed(2)}px, 2.00px, 0)`);
  });

  it('idle-throttles: the rAF loop stops once settled and restarts on the next move', () => {
    render(<Starfield animate parallax />);
    act(() => move(0, 0));
    let ticks = 0;
    act(() => {
      while (frames.length && ticks < 500) {
        flushFrame();
        ticks++;
      }
    });
    expect(ticks).toBeGreaterThan(5);
    expect(ticks).toBeLessThan(90);
    expect(frames).toHaveLength(0); // settled → no further frames while the mouse is still
    act(() => move(512, 384));
    expect(frames).toHaveLength(1);
  });

  it('pauses while the document is hidden', () => {
    render(<Starfield animate parallax />);
    act(() => move(0, 0));
    expect(frames).toHaveLength(1);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frames).toHaveLength(0);
    act(() => move(100, 100));
    expect(frames).toHaveLength(0);
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frames).toHaveLength(1);
  });

  it('does nothing on pointer move when parallax is off or motion is not allowed', () => {
    const { unmount } = render(<Starfield animate />);
    act(() => move(0, 0));
    expect(frames).toHaveLength(0);
    expect(layers().every((l) => l.style.transform === '')).toBe(true);
    unmount();
    render(<Starfield animate={false} parallax />);
    act(() => move(0, 0));
    expect(frames).toHaveLength(0);
    // Reduced motion also means no twinkling stars.
    expect(document.querySelectorAll('.ts-twinkle')).toHaveLength(0);
  });

  it('adds a few twinkling stars only when motion is allowed, and cleans up on unmount', () => {
    const { unmount } = render(<Starfield animate />);
    const count = document.querySelectorAll('.ts-twinkle').length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(12);
    unmount();
    expect(document.querySelectorAll('.ts-twinkle')).toHaveLength(0);
  });

  it('ignores touch pointers', () => {
    render(<Starfield animate parallax />);
    const touch = new MouseEvent('pointermove', { clientX: 0, clientY: 0 });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    act(() => {
      window.dispatchEvent(touch);
    });
    expect(frames).toHaveLength(0);
  });
});
