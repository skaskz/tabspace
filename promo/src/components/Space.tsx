import { useMemo } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, H, W, rng } from '../theme';

/**
 * The film's recurring element: a deep-space starfield with three depth layers that drift
 * continuously across every scene (scenes are transparent on top of it).
 */
export const Starfield: React.FC = () => {
  const frame = useCurrentFrame();
  const layers = useMemo(() => {
    const r = rng(1337);
    return [
      { speed: 0.05, stars: Array.from({ length: 260 }, () => ({ x: r() * W, y: r() * H, s: r() * 1.1 + 0.4, a: r() * 0.45 + 0.15, tw: r() * 6 })) },
      { speed: 0.14, stars: Array.from({ length: 130 }, () => ({ x: r() * W, y: r() * H, s: r() * 1.4 + 0.8, a: r() * 0.5 + 0.25, tw: r() * 6 })) },
      { speed: 0.32, stars: Array.from({ length: 40 }, () => ({ x: r() * W, y: r() * H, s: r() * 1.8 + 1.2, a: r() * 0.5 + 0.4, tw: r() * 6 })) },
    ];
  }, []);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.05), transparent 60%)' }} />
      {layers.map((layer, li) => (
        <AbsoluteFill key={li}>
          {layer.stars.map((st, i) => {
            const x = (((st.x - frame * layer.speed * 6) % W) + W) % W;
            const y = (((st.y + frame * layer.speed * 2.2) % H) + H) % H;
            const twinkle = 0.65 + 0.35 * Math.sin(frame / 22 + st.tw);
            return <div key={i} style={{ position: 'absolute', left: x, top: y, width: st.s, height: st.s, borderRadius: '50%', background: '#fff', opacity: st.a * twinkle }} />;
          })}
        </AbsoluteFill>
      ))}
      {/* Faint diagonal light streak */}
      <div
        style={{
          position: 'absolute',
          left: interpolate(frame, [0, 1500], [-400, 300]),
          top: 140,
          width: 900,
          height: 1,
          rotate: '-28deg',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
        }}
      />
    </AbsoluteFill>
  );
};

/** Tabspace's four-point sparkle. */
export const Sparkle: React.FC<{ size: number; color?: string; style?: React.CSSProperties }> = ({ size, color = '#f4f4f5', style }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" style={style}>
    <path d="M10 0 Q10 10 20 10 Q10 10 10 20 Q10 10 0 10 Q10 10 10 0 Z" fill={color} />
  </svg>
);

/** Soft glowing sparkle flare. */
export const Flare: React.FC<{ x: number; y: number; size: number; opacity: number; rotate?: number }> = ({ x, y, size, opacity, rotate = 0 }) => (
  <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, opacity, rotate: `${rotate}deg` }}>
    <div style={{ position: 'absolute', inset: size * 0.3, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.55), transparent 70%)' }} />
    <Sparkle size={size} />
  </div>
);
