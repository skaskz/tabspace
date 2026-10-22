/**
 * Pure parallax math for the starfield (kept separate so it is unit-testable).
 * The pointer position is normalised to [-1, 1] on each axis (0 = viewport centre);
 * each depth layer moves opposite to the pointer by up to its `max` pixels, so nearer
 * layers shift more and the sky reads as 3D.
 */

export interface Vec {
  x: number;
  y: number;
}

/** Max offset in px per layer: far, mid, near. */
export const PARALLAX_DEPTHS = [2, 6, 14] as const;
/** Extra canvas margin so a fully shifted layer never reveals its edge. */
export const PARALLAX_PAD = 16;
/** Fraction of the remaining distance covered per 60 Hz frame. */
export const PARALLAX_EASE = 0.12;
/** Stop the animation loop once every layer is within this many px of its target. */
export const PARALLAX_EPSILON_PX = 0.05;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** Pointer position (client px) → normalised [-1, 1] coordinates, clamped. */
export function normalisePointer(clientX: number, clientY: number, width: number, height: number): Vec {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  return { x: clamp((clientX / width) * 2 - 1, -1, 1), y: clamp((clientY / height) * 2 - 1, -1, 1) };
}

/** Normalised pointer → per-layer pixel offsets (opposite direction, clamped to each layer's max). */
export function parallaxOffsets(pointer: Vec, depths: readonly number[] = PARALLAX_DEPTHS): Vec[] {
  const nx = clamp(pointer.x, -1, 1);
  const ny = clamp(pointer.y, -1, 1);
  // `+ 0` normalises -0 to 0 so a centred pointer yields exactly zero offsets.
  return depths.map((max) => ({ x: -nx * max + 0, y: -ny * max + 0 }));
}

/** Frame-rate independent smoothing factor for a frame that took `dtMs`. */
export function easeFactor(dtMs: number, ease = PARALLAX_EASE): number {
  const dt = clamp(dtMs, 0, 100);
  return 1 - Math.pow(1 - ease, dt / (1000 / 60));
}

/**
 * One smoothing step from `current` toward `target`. Returns the next position and whether it has
 * settled (all layers within `epsilonPx` of their target), in which case it snaps exactly onto the target.
 */
export function stepParallax(current: Vec, target: Vec, dtMs: number, maxDepth = PARALLAX_DEPTHS[PARALLAX_DEPTHS.length - 1], epsilonPx = PARALLAX_EPSILON_PX): { next: Vec; settled: boolean } {
  const k = easeFactor(dtMs);
  const next = { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
  const remaining = Math.max(Math.abs(target.x - next.x), Math.abs(target.y - next.y)) * maxDepth;
  if (remaining < epsilonPx) return { next: { ...target }, settled: true };
  return { next, settled: false };
}
