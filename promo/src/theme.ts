import { Easing, interpolate, spring } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';

export const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] });

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const C = {
  bg: '#030304',
  surface: 'rgba(16,16,18,0.92)',
  surface2: '#18181b',
  line: 'rgba(255,255,255,0.10)',
  lineStrong: 'rgba(255,255,255,0.24)',
  fg: '#f5f5f5',
  muted: '#a1a1a6',
  faint: '#8e8e93',
  silver: 'linear-gradient(180deg,#ffffff 0%,#c9cacc 55%,#8d8f93 100%)',
};

/** Expo-out: the house easing for entrances. */
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const INOUT = Easing.bezier(0.65, 0, 0.35, 1);

/** Clamped interpolate with house easing. */
export function ease(frame: number, range: [number, number], out: [number, number], easing = OUT): number {
  return interpolate(frame, range, out, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
}

/** Spring 0→1 starting at `delay`. */
export function pop(frame: number, delay = 0, damping = 14, stiffness = 140): number {
  return spring({ frame: frame - delay, fps: FPS, config: { damping, stiffness, mass: 0.8 } });
}

/** Seeded RNG so every render is identical. */
export function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* Scene schedule (frames). Transitions overlap neighbouring scenes by TRANSITION frames. */
export const TRANSITION = 15;
export const SCENES = [
  { id: 'intro', label: 'Tabspace', dur: 150 },
  { id: 'tagline', label: 'Tabspace', dur: 105 },
  { id: 'newtab', label: 'New Tab', dur: 195 },
  { id: 'workspaces', label: 'Workspaces', dur: 195 },
  { id: 'tasks', label: 'Tasks & Notes', dur: 165 },
  { id: 'focus', label: 'Focus Mode', dur: 195 },
  { id: 'bar', label: 'Tabspace Bar', dur: 165 },
  { id: 'customize', label: 'Customize', dur: 150 },
  { id: 'grid', label: 'Everything else', dur: 150 },
  { id: 'outro', label: 'Tabspace', dur: 165 },
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

/** Global start frame of each scene, accounting for transition overlaps. */
export const SCENE_START: Record<SceneId, number> = (() => {
  const out = {} as Record<SceneId, number>;
  let t = 0;
  SCENES.forEach((s, i) => {
    out[s.id] = t;
    t += s.dur - (i < SCENES.length - 1 ? TRANSITION : 0);
  });
  return out;
})();

export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0) - TRANSITION * (SCENES.length - 1);
