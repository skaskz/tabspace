import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, ease, fontFamily, pop } from '../theme';

const WORDS = ['Tabs.', 'Tasks.', 'Notes.', 'Focus.'];
export const TAGLINE_BEATS = [6, 18, 30, 42];

/** 02 — Four words snap in on the beat, then the promise. */
export const Tagline: React.FC = () => {
  const frame = useCurrentFrame();
  const settle = ease(frame, [58, 80], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 34, fontFamily, fontSize: 126, fontWeight: 800, letterSpacing: '-0.045em', translate: `0 ${interpolate(settle, [0, 1], [0, -70])}px` }}>
        {WORDS.map((w, i) => {
          const p = pop(frame, TAGLINE_BEATS[i], 12, 220);
          const isLast = i === WORDS.length - 1;
          return (
            <span
              key={w}
              style={{
                display: 'inline-block',
                opacity: Math.min(1, p) * (isLast ? 1 : interpolate(settle, [0, 1], [1, 0.42])),
                scale: String(interpolate(p, [0, 1], [1.5, 1])),
                color: isLast ? 'transparent' : C.fg,
                backgroundImage: isLast ? 'linear-gradient(180deg,#ffffff 10%,#b8b9bc 90%)' : undefined,
                backgroundClip: isLast ? 'text' : undefined,
                WebkitBackgroundClip: isLast ? 'text' : undefined,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: 640, fontFamily, fontSize: 52, fontWeight: 500, color: C.muted, opacity: settle, translate: `0 ${interpolate(settle, [0, 1], [24, 0])}px` }}>
        One calm space for all of it — right inside Chrome.
      </div>
    </AbsoluteFill>
  );
};
