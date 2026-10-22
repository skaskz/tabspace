import { useEffect, useRef } from 'react';
import { normalisePointer, parallaxOffsets, PARALLAX_DEPTHS, PARALLAX_PAD, stepParallax, type Vec } from './parallax';

export interface StarfieldProps {
  /** Allow motion (twinkle + parallax). Pass false under reduced motion. */
  animate?: boolean;
  /** Star density multiplier (1 = dashboard, ~0.55 = side panel). */
  density?: number;
  /** Mouse-driven 3D parallax across three depth layers. Ignored when `animate` is false or the OS asks for reduced motion. */
  parallax?: boolean;
}

const LAYERS = ['far', 'mid', 'near'] as const;
/** Device-pixel-ratio cap per layer: distant, dim stars don't need retina backing stores. */
const DPR_CAP = [1, 1, 2];
const TWINKLES = 5;

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

/**
 * Deep-space starfield: pure black, small white stars on three depth layers (far/mid/near),
 * a few soft sparkles in the outer margins and faint diagonal streaks.
 *
 * Performance model:
 *  - each layer is drawn ONCE to its own canvas (on mount, resize and theme change);
 *  - parallax moves the layers with CSS `translate3d` (GPU compositing, no redraw) from a single
 *    requestAnimationFrame loop that eases toward the pointer and STOPS as soon as it settles,
 *    so a still mouse costs zero frames; the loop is also cancelled while the page is hidden;
 *  - twinkle is a handful of tiny DOM stars animated by CSS opacity (compositor, no JS);
 *  - no React state is touched on pointer move — everything lives inside the effect.
 */
export function Starfield({ animate = true, density = 1, parallax = false }: StarfieldProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const layers = Array.from(root.querySelectorAll<HTMLDivElement>('[data-layer]'));
    const canvases = layers.map((l) => l.querySelector('canvas')).filter((c): c is HTMLCanvasElement => !!c);
    const osReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = animate && !osReduced;
    const useParallax = motion && parallax;
    let twinkles: HTMLSpanElement[] = [];

    // Seeded RNG so the sky doesn't reshuffle on every resize.
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    const build = () => {
      const w = window.innerWidth || root.clientWidth;
      const h = window.innerHeight || root.clientHeight;
      if (!w || !h) return;
      const W = w + PARALLAX_PAD * 2;
      const H = h + PARALLAX_PAD * 2;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--ts-star').trim() || '#fff';
      seed = 1337;

      const count = Math.round(((w * h) / 2600) * density);
      const byLayer: Star[][] = [[], [], []];
      for (let i = 0; i < count; i++) {
        const depth = rnd();
        const layer = depth < 0.62 ? 0 : depth < 0.9 ? 1 : 2;
        const x = rnd() * W;
        const y = rnd() * H;
        const r = layer === 0 ? rnd() * 0.45 + 0.2 : layer === 1 ? rnd() * 0.55 + 0.4 : rnd() * 0.9 + 0.7;
        const a = layer === 0 ? rnd() * 0.3 + 0.15 : layer === 1 ? rnd() * 0.35 + 0.3 : rnd() * 0.35 + 0.45;
        byLayer[layer].push({ x, y, r, a });
      }
      const streaks = Array.from({ length: 3 }, () => ({ x: rnd() * W, y: rnd() * H * 0.9, len: rnd() * 260 + 160, a: rnd() * 0.08 + 0.04 }));
      // Bright sparkles stay in the outer margins / header band so they never sit behind content cards.
      const flareCount = Math.max(3, Math.round((w * h) / 400000));
      const zonePoint = (i: number) => {
        const zone = i % 3;
        const x = zone === 0 ? rnd() * Math.min(200, w * 0.14) : zone === 1 ? w - rnd() * Math.min(160, w * 0.1) : w * 0.25 + rnd() * w * 0.5;
        const y = zone === 2 ? rnd() * Math.min(110, h * 0.12) : rnd() * h;
        return { x: x + PARALLAX_PAD, y: y + PARALLAX_PAD };
      };
      const flares = Array.from({ length: flareCount }, (_, i) => ({ ...zonePoint(i), r: rnd() * 8 + 7 }));

      canvases.forEach((canvas, li) => {
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[li]);
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = color;
        if (li === 0) {
          for (const s of streaks) {
            const g = ctx.createLinearGradient(s.x, s.y, s.x + s.len, s.y - s.len * 0.62);
            g.addColorStop(0, 'transparent');
            g.addColorStop(0.5, color);
            g.addColorStop(1, 'transparent');
            ctx.globalAlpha = s.a;
            ctx.strokeStyle = g;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x + s.len, s.y - s.len * 0.62);
            ctx.stroke();
          }
        }
        for (const s of byLayer[li]) {
          ctx.globalAlpha = s.a;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (li === 2) {
          for (const f of flares) {
            const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
            g.addColorStop(0, color);
            g.addColorStop(0.15, color);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = color;
            ctx.fillRect(f.x - f.r * 1.4, f.y - 0.4, f.r * 2.8, 0.8);
            ctx.fillRect(f.x - 0.4, f.y - f.r * 1.4, 0.8, f.r * 2.8);
          }
        }
        ctx.globalAlpha = 1;
      });

      // A few twinkling stars (CSS opacity animation), also kept to the margins.
      twinkles.forEach((t) => t.remove());
      twinkles = [];
      if (motion) {
        for (let i = 0; i < TWINKLES; i++) {
          const p = zonePoint(i + 1);
          const t = document.createElement('span');
          t.className = 'ts-twinkle';
          t.style.left = `${p.x}px`;
          t.style.top = `${p.y}px`;
          t.style.setProperty('--ts-tw-dur', `${(3.5 + rnd() * 3).toFixed(2)}s`);
          t.style.setProperty('--ts-tw-delay', `${(-rnd() * 6).toFixed(2)}s`);
          (layers[1 + (i % 2)] ?? root).appendChild(t);
          twinkles.push(t);
        }
      }
    };

    build();

    // Rebuild (debounced) on resize and when the theme flips the star colour.
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 120);
    };
    window.addEventListener('resize', onResize);
    const themeObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(build) : null;
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ---- Parallax loop -------------------------------------------------------------------------
    let raf = 0;
    let lastT = 0;
    let current: Vec = { x: 0, y: 0 };
    let target: Vec = { x: 0, y: 0 };
    const apply = () => {
      const offsets = parallaxOffsets(current, PARALLAX_DEPTHS);
      layers.forEach((layer, i) => {
        const o = offsets[i];
        layer.style.transform = `translate3d(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px, 0)`;
      });
    };
    const tick = (t: number) => {
      raf = 0;
      const dt = lastT ? t - lastT : 1000 / 60;
      lastT = t;
      const { next, settled } = stepParallax(current, target, dt);
      current = next;
      apply();
      if (settled) {
        lastT = 0; // idle: loop stops until the pointer moves again
        return;
      }
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (raf || document.hidden) return;
      lastT = 0;
      raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      target = normalisePointer(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
      kick();
    };
    const onLeave = () => {
      target = { x: 0, y: 0 };
      kick();
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        kick();
      }
    };
    if (useParallax) {
      layers.forEach((l) => (l.style.willChange = 'transform'));
      window.addEventListener('pointermove', onMove, { passive: true });
      document.documentElement.addEventListener('mouseleave', onLeave);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      themeObserver?.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      twinkles.forEach((t) => t.remove());
      layers.forEach((l) => {
        l.style.transform = '';
        l.style.willChange = '';
      });
    };
  }, [animate, density, parallax]);

  return (
    <div ref={rootRef} aria-hidden className="ts-starfield pointer-events-none fixed inset-0 -z-10 overflow-hidden" data-parallax={parallax && animate ? 'on' : 'off'}>
      {LAYERS.map((name) => (
        <div key={name} data-layer={name} className="absolute" style={{ inset: -PARALLAX_PAD }}>
          <canvas className="absolute inset-0 h-full w-full" />
        </div>
      ))}
    </div>
  );
}
