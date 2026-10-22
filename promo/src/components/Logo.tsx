import { interpolate } from 'remotion';
import { Sparkle } from './Space';

/**
 * Animated Tabspace mark: two offset rounded "tabs" + sparkle.
 * `back`, `front` and `star` are 0→1 progress values controlled by the caller.
 */
export const LogoMark: React.FC<{ size: number; back?: number; front?: number; star?: number; starRotate?: number }> = ({ size, back = 1, front = 1, star = 1, starRotate = 0 }) => {
  const u = size / 64;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div
        style={{
          position: 'absolute',
          left: 6 * u,
          top: 11 * u,
          width: 33 * u,
          height: 21 * u,
          borderRadius: 6 * u,
          background: 'linear-gradient(135deg,#ffffff 0%,#c9cacc 55%,#8d8f93 100%)',
          boxShadow: `inset 0 ${1 * u}px 0 rgba(255,255,255,0.9)`,
          opacity: back,
          translate: `${interpolate(back, [0, 1], [-40 * u, 0])}px ${interpolate(back, [0, 1], [-10 * u, 0])}px`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 17 * u,
          top: 30 * u,
          width: 33 * u,
          height: 21 * u,
          borderRadius: 6 * u,
          background: 'linear-gradient(135deg,#9a9ca0 0%,#5d5f63 50%,#2f3033 100%)',
          boxShadow: `inset 0 ${1 * u}px 0 rgba(255,255,255,0.55)`,
          opacity: front,
          translate: `${interpolate(front, [0, 1], [40 * u, 0])}px ${interpolate(front, [0, 1], [10 * u, 0])}px`,
        }}
      />
      <div style={{ position: 'absolute', left: 42 * u, top: 8 * u, width: 18 * u, height: 18 * u, scale: String(star), rotate: `${starRotate}deg`, opacity: Math.min(1, star) }}>
        <Sparkle size={18 * u} />
      </div>
    </div>
  );
};
