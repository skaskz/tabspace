import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { LogoMark } from '../components/Logo';
import { Flare } from '../components/Space';
import { C, ease, fontFamily, pop } from '../theme';

/** 10 — End card: mark + wordmark + promise, then a slow fade to black. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const mark = pop(frame, 4, 12, 140);
  const word = ease(frame, [14, 36], [0, 1]);
  const line = ease(frame, [32, 54], [0, 1]);
  const small = ease(frame, [52, 72], [0, 1]);
  const fadeOut = ease(frame, [128, 165], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: 1000, height: 1000, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.09), transparent 60%)', scale: String(interpolate(frame, [0, 165], [0.85, 1.1])) }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, scale: String(interpolate(frame, [0, 165], [1, 1.04])) }}>
        <div style={{ scale: String(mark), opacity: Math.min(1, mark) }}>
          <LogoMark size={190} starRotate={interpolate(frame, [4, 40], [-60, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
        </div>
        <div style={{ fontFamily, fontSize: 150, fontWeight: 700, letterSpacing: '-0.045em', color: C.fg, opacity: word, translate: `${interpolate(word, [0, 1], [-30, 0])}px 0`, filter: `blur(${interpolate(word, [0, 1], [10, 0])}px)` }}>
          Tabspace
        </div>
      </div>
      <div style={{ marginTop: 50, fontFamily, fontSize: 50, fontWeight: 600, letterSpacing: '-0.02em', color: 'transparent', backgroundImage: 'linear-gradient(180deg,#ffffff,#b8b9bc)', backgroundClip: 'text', WebkitBackgroundClip: 'text', opacity: line, translate: `0 ${interpolate(line, [0, 1], [18, 0])}px` }}>
        Your browser. Organized.
      </div>
      <div style={{ marginTop: 22, fontFamily, fontSize: 26, letterSpacing: '0.3em', textTransform: 'uppercase', color: C.faint, opacity: small }}>
        A Chrome extension
      </div>
      <Flare x={1530} y={330} size={64} opacity={ease(frame, [16, 30], [0, 0.85]) * (0.65 + 0.35 * Math.sin(frame / 9))} rotate={frame * 0.5} />
      <AbsoluteFill style={{ background: '#000', opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
