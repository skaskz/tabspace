import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, ease, fontFamily, OUT } from '../theme';

/** Rounded browser window with a minimal Chrome-like top bar, holding a screenshot. */
export const BrowserFrame: React.FC<{
  src: string;
  width: number;
  url?: string;
  tab?: string;
  /** Inner camera: zoom + focal point (0–1) on the screenshot. */
  zoom?: number;
  focusX?: number;
  focusY?: number;
  style?: React.CSSProperties;
}> = ({ src, width, url = 'Tabspace', tab = 'New Tab', zoom = 1, focusX = 0.5, focusY = 0.5, style }) => {
  const contentH = (width * 1920) / 3200;
  const bar = 46;
  return (
    <div
      style={{
        width,
        height: contentH + bar,
        borderRadius: 18,
        overflow: 'hidden',
        background: '#08080a',
        border: `1px solid ${C.lineStrong}`,
        boxShadow: '0 40px 120px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04), 0 0 80px rgba(255,255,255,0.05)',
        ...style,
      }}
    >
      <div style={{ height: bar, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', background: '#0b0b0d', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 6, background: '#2a2a2e' }} />
          ))}
        </div>
        <div style={{ height: 30, padding: '0 16px', display: 'flex', alignItems: 'center', borderRadius: '9px 9px 0 0', background: '#141416', color: C.fg, fontFamily, fontSize: 14, marginTop: 16 }}>{tab}</div>
        <div style={{ flex: 1, height: 28, borderRadius: 14, background: '#141416', display: 'flex', alignItems: 'center', padding: '0 14px', color: C.faint, fontFamily, fontSize: 13 }}>{url}</div>
      </div>
      <div style={{ position: 'relative', width, height: contentH, overflow: 'hidden' }}>
        <Img
          src={staticFile(src)}
          style={{
            position: 'absolute',
            width,
            height: contentH,
            scale: String(zoom),
            transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
          }}
        />
      </div>
    </div>
  );
};

/** Floating screenshot card (no browser chrome). */
export const ShotCard: React.FC<{ src: string; width: number; height: number; cropX?: number; cropY?: number; cropScale?: number; style?: React.CSSProperties }> = ({ src, width, height, cropX = 0, cropY = 0, cropScale = 1, style }) => (
  <div style={{ width, height, borderRadius: 20, overflow: 'hidden', border: `1px solid ${C.lineStrong}`, background: '#08080a', boxShadow: '0 30px 90px rgba(0,0,0,0.7)', position: 'relative', ...style }}>
    <Img src={staticFile(src)} style={{ position: 'absolute', left: -cropX * cropScale, top: -cropY * cropScale, width: 3200 * (cropScale / 2), height: 1920 * (cropScale / 2) }} />
  </div>
);

/** Kinetic headline: words rise out of a mask, staggered. */
export const Headline: React.FC<{ text: string; delay?: number; size?: number; weight?: number; color?: string; stagger?: number; align?: 'left' | 'center'; style?: React.CSSProperties }> = ({
  text,
  delay = 0,
  size = 84,
  weight = 800,
  color = C.fg,
  stagger = 4,
  align = 'left',
  style,
}) => {
  const frame = useCurrentFrame();
  const words = text.split(' ');
  return (
    <div style={{ fontFamily, fontSize: size, fontWeight: weight, letterSpacing: '-0.035em', lineHeight: 1.05, color, display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: `0 ${size * 0.26}px`, ...style }}>
      {words.map((w, i) => {
        const p = ease(frame, [delay + i * stagger, delay + i * stagger + 18], [0, 1]);
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: size * 0.12 }}>
            <span style={{ display: 'inline-block', translate: `0 ${interpolate(p, [0, 1], [size * 1.1, 0])}px`, opacity: p }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

/** Small uppercase label with a silver rule. */
export const Eyebrow: React.FC<{ text: string; delay?: number; style?: React.CSSProperties }> = ({ text, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, [delay, delay + 20], [0, 1]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily, fontSize: 22, fontWeight: 600, letterSpacing: '0.28em', color: C.muted, textTransform: 'uppercase', opacity: p, ...style }}>
      <div style={{ width: interpolate(p, [0, 1], [0, 46]), height: 2, background: 'linear-gradient(90deg,#fff,#8d8f93)' }} />
      {text}
    </div>
  );
};

/** Callout pill that pops in. */
export const Callout: React.FC<{ text: string; x: number; y: number; delay: number; out?: number; icon?: string }> = ({ text, x, y, delay, out, icon = '✦' }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, [delay, delay + 14], [0, 1]) * (out === undefined ? 1 : ease(frame, [out, out + 10], [1, 0]));
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 22px',
        borderRadius: 999,
        background: 'rgba(10,10,12,0.88)',
        border: `1px solid ${C.lineStrong}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 30px rgba(255,255,255,0.06)',
        fontFamily,
        fontSize: 26,
        fontWeight: 600,
        color: C.fg,
        opacity: p,
        scale: String(interpolate(p, [0, 1], [0.85, 1])),
        translate: `0 ${interpolate(p, [0, 1], [14, 0])}px`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 20, color: '#d4d4d8' }}>{icon}</span>
      {text}
    </div>
  );
};

/** Pointer cursor with a click ripple at `clickAt` frames. */
export const Cursor: React.FC<{ x: number; y: number; clicks?: number[]; opacity?: number }> = ({ x, y, clicks = [], opacity = 1 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity, pointerEvents: 'none' }}>
      {clicks.map((c) => {
        const p = interpolate(frame, [c, c + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT });
        if (frame < c || p >= 1) return null;
        return <div key={c} style={{ position: 'absolute', left: -28, top: -28, width: 56, height: 56, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', opacity: 1 - p, scale: String(0.3 + p) }} />;
      })}
      <svg width="34" height="34" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.6))', scale: String(clicks.some((c) => frame >= c && frame < c + 5) ? 0.86 : 1) }}>
        <path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.5 13.7 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
};
