import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { LogoMark } from '../components/Logo';
import { Flare } from '../components/Space';
import { C, ease, fontFamily, pop } from '../theme';

const WORD = 'Tabspace';

/** 01 — The mark assembles (two tabs + sparkle), the wordmark types on, tagline settles. */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const back = pop(frame, 18, 13, 120);
  const front = pop(frame, 28, 13, 120);
  const star = pop(frame, 44, 9, 170);
  const lift = ease(frame, [70, 100], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {/* halo */}
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.10), transparent 62%)',
          opacity: ease(frame, [30, 70], [0, 1]),
          scale: String(interpolate(frame, [30, 150], [0.8, 1.08])),
        }}
      />
      <div style={{ translate: `0 ${interpolate(lift, [0, 1], [60, -40])}px`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ scale: String(interpolate(lift, [0, 1], [1.25, 1])) }}>
          <LogoMark size={230} back={back} front={front} star={star} starRotate={interpolate(frame, [44, 80], [-90, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
        </div>
        <div style={{ display: 'flex', marginTop: 26, height: 150, fontFamily, fontSize: 132, fontWeight: 700, letterSpacing: '-0.04em', color: C.fg }}>
          {WORD.split('').map((ch, i) => {
            const p = ease(frame, [62 + i * 3, 74 + i * 3], [0, 1]);
            return (
              <span key={i} style={{ display: 'inline-block', opacity: p, translate: `0 ${interpolate(p, [0, 1], [40, 0])}px`, filter: `blur(${interpolate(p, [0, 1], [8, 0])}px)` }}>
                {ch}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontFamily, fontSize: 40, fontWeight: 500, color: C.muted, letterSpacing: '-0.01em', opacity: ease(frame, [100, 120], [0, 1]), translate: `0 ${ease(frame, [100, 120], [16, 0])}px` }}>
          Your browser, organized.
        </div>
      </div>
      <Flare x={1260} y={300} size={70} opacity={ease(frame, [44, 60], [0, 0.9]) * (0.6 + 0.4 * Math.sin(frame / 10))} rotate={frame * 0.6} />
      <Flare x={640} y={820} size={46} opacity={ease(frame, [60, 80], [0, 0.6])} rotate={-frame * 0.4} />
    </AbsoluteFill>
  );
};
