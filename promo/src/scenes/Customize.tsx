import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BrowserFrame, Cursor, Eyebrow, Headline } from '../components/UI';
import { C, ease, fontFamily, INOUT } from '../theme';

export const CUSTOMIZE_BEATS = { grab: 44, drop: 92 };

/** 08 — Customize mode: a section is picked up and dropped into the other column. */
export const Customize: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = ease(frame, [4, 34], [0, 1]);
  const drag = interpolate(frame, [CUSTOMIZE_BEATS.grab, CUSTOMIZE_BEATS.drop], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: INOUT });
  const held = frame >= CUSTOMIZE_BEATS.grab && frame < CUSTOMIZE_BEATS.drop + 4;
  const settled = ease(frame, [CUSTOMIZE_BEATS.drop, CUSTOMIZE_BEATS.drop + 14], [0, 1]);
  // Ghost card path (screen coordinates)
  const gx = interpolate(drag, [0, 1], [560, 1330]);
  const gy = interpolate(drag, [0, 1], [650, 470]) - Math.sin(drag * Math.PI) * 60;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 70 }}>
        <Eyebrow text="Customize" delay={2} />
        <Headline text="Make the New Tab yours." delay={6} size={64} style={{ marginTop: 14 }} />
        <div style={{ marginTop: 10, fontFamily, fontSize: 30, color: C.muted, opacity: ease(frame, [20, 40], [0, 1]) }}>Show, hide and rearrange every section.</div>
      </div>
      <div style={{ position: 'absolute', left: (1920 - 1240) / 2, top: 300, opacity: enter, translate: `0 ${interpolate(enter, [0, 1], [80, 0])}px`, scale: String(interpolate(frame, [0, 150], [0.98, 1.02])) }}>
        <BrowserFrame src="shots/newtab-customize.png" width={1240} />
      </div>
      {/* drop target indicator */}
      <div style={{ position: 'absolute', left: 1305, top: 452, width: 250, height: 6, borderRadius: 3, background: '#fff', boxShadow: '0 0 18px rgba(255,255,255,0.8)', opacity: held ? ease(frame, [CUSTOMIZE_BEATS.grab + 20, CUSTOMIZE_BEATS.grab + 30], [0, 1]) : 0 }} />
      {/* ghost card */}
      <div
        style={{
          position: 'absolute',
          left: gx - 150,
          top: gy - 50,
          width: 300,
          height: 100,
          borderRadius: 16,
          background: 'rgba(20,20,23,0.95)',
          border: `2px solid ${held ? '#fff' : C.lineStrong}`,
          boxShadow: held ? '0 30px 80px rgba(0,0,0,0.8), 0 0 30px rgba(255,255,255,0.15)' : '0 12px 40px rgba(0,0,0,0.6)',
          rotate: `${held ? Math.sin(drag * Math.PI) * 4 : 0}deg`,
          scale: String(held ? 1.04 : 1),
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 22px',
          fontFamily,
          opacity: ease(frame, [30, 40], [0, 1]) * (1 - settled * 0.15),
        }}
      >
        <div style={{ color: C.muted, fontSize: 26 }}>⠿</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.fg }}>Focus Mode</div>
          <div style={{ fontSize: 17, color: C.muted }}>{settled > 0.5 ? 'Moved to side column' : 'Drag to rearrange'}</div>
        </div>
      </div>
      <Cursor x={gx + 110} y={gy + 10} clicks={[CUSTOMIZE_BEATS.grab, CUSTOMIZE_BEATS.drop]} opacity={ease(frame, [30, 40], [0, 1]) * ease(frame, [120, 132], [1, 0])} />
    </AbsoluteFill>
  );
};
