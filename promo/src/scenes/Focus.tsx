import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { LogoMark } from '../components/Logo';
import { Cursor, Eyebrow, Headline } from '../components/UI';
import { C, ease, fontFamily, INOUT, OUT, pop } from '../theme';

export const FOCUS_BEATS = { badge: 52, click: 92, popup: 96, lapse: 120, done: 158 };

function clock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 06 — The focus ring counts down, the pinned toolbar icon shows "24m", the popup drops in, time-lapse to complete. */
export const Focus: React.FC = () => {
  const frame = useCurrentFrame();
  // 25:00 counting in real time, then a time-lapse to 00:00.
  const realSec = 25 * 60 - Math.floor(Math.max(0, frame - 20) / 30);
  const lapse = interpolate(frame, [FOCUS_BEATS.lapse, FOCUS_BEATS.done], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: INOUT });
  const remaining = interpolate(lapse, [0, 1], [realSec, 0]);
  const progress = 1 - remaining / (25 * 60);
  const done = frame >= FOCUS_BEATS.done;
  const doneP = pop(frame, FOCUS_BEATS.done, 12, 180);
  const R = 230;
  const circ = 2 * Math.PI * R;
  const ringIn = ease(frame, [4, 34], [0, 1]);
  const popupP = pop(frame, FOCUS_BEATS.popup, 16, 170);
  const minutesLeft = Math.ceil(remaining / 60);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 70 }}>
        <Eyebrow text="Focus Mode" delay={2} />
        <Headline text="A focus timer that follows you everywhere." delay={6} size={64} style={{ marginTop: 14, maxWidth: 1100 }} />
      </div>

      {/* Ring */}
      <div style={{ position: 'absolute', left: 190, top: 300, width: 560, height: 560, opacity: ringIn, scale: String(interpolate(ringIn, [0, 1], [0.85, 1])) }}>
        <svg width="560" height="560" viewBox="0 0 560 560">
          <circle cx="280" cy="280" r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
          <circle cx="280" cy="280" r={R} fill="none" stroke="#f2f2f3" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${circ * progress} ${circ}`} transform="rotate(-90 280 280)" style={{ filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.5))' }} />
          <circle cx={280 + R * Math.sin(2 * Math.PI * progress)} cy={280 - R * Math.cos(2 * Math.PI * progress)} r="9" fill="#fff" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily }}>
          <div style={{ fontSize: 26, color: C.muted, opacity: done ? 0 : 1 }}>Focus Session</div>
          {!done ? (
            <div style={{ fontSize: 128, fontWeight: 300, letterSpacing: '-0.02em', color: C.fg, fontVariantNumeric: 'tabular-nums', filter: `blur(${lapse > 0 && lapse < 1 ? 1.2 : 0}px)` }}>{clock(remaining)}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, scale: String(doneP) }}>
              <svg width="80" height="80" viewBox="0 0 24 24"><path d="M5 12.5 L10 17 L19 7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.fg }}>Session complete</div>
            </div>
          )}
          <div style={{ fontSize: 24, color: C.faint, marginTop: 8, opacity: done ? 0 : 1 }}>Stay in the zone</div>
        </div>
      </div>

      {/* Chrome toolbar mock with the pinned Tabspace icon + badge */}
      <div style={{ position: 'absolute', left: 900, top: 330, width: 880, opacity: ease(frame, [20, 44], [0, 1]), translate: `0 ${ease(frame, [20, 44], [40, 0])}px` }}>
        <div style={{ height: 76, borderRadius: 18, background: '#0b0b0d', border: `1px solid ${C.lineStrong}`, display: 'flex', alignItems: 'center', gap: 18, padding: '0 22px', boxShadow: '0 30px 90px rgba(0,0,0,0.7)' }}>
          <div style={{ flex: 1, height: 44, borderRadius: 22, background: '#141416', fontFamily, fontSize: 20, color: C.faint, display: 'flex', alignItems: 'center', padding: '0 20px' }}>Ask Google or type a URL</div>
          {[0, 1].map((i) => (
            <div key={i} style={{ width: 30, height: 30, borderRadius: 8, background: '#1d1d20' }} />
          ))}
          <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 12, background: '#141416', display: 'flex', alignItems: 'center', justifyContent: 'center', border: frame > FOCUS_BEATS.click ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent' }}>
            <LogoMark size={32} />
            <div
              style={{
                position: 'absolute',
                right: -12,
                bottom: -10,
                minWidth: 40,
                height: 24,
                padding: '0 6px',
                borderRadius: 7,
                background: '#3a3a3c',
                color: '#fff',
                fontFamily,
                fontSize: 15,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                scale: String(done ? 0 : pop(frame, FOCUS_BEATS.badge, 10, 220)),
              }}
            >
              {minutesLeft}m
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18, marginLeft: 470, fontFamily, fontSize: 22, color: C.muted, opacity: ease(frame, [FOCUS_BEATS.badge + 6, FOCUS_BEATS.badge + 20], [0, 1]) * ease(frame, [FOCUS_BEATS.popup - 6, FOCUS_BEATS.popup], [1, 0]) }}>Minutes left, right on the toolbar ↑</div>
        {/* Popup drops from the icon */}
        <div
          style={{
            position: 'absolute',
            left: 520,
            top: 96,
            width: 300,
            borderRadius: 18,
            overflow: 'hidden',
            border: `1px solid ${C.lineStrong}`,
            boxShadow: '0 30px 90px rgba(0,0,0,0.8)',
            opacity: Math.min(1, popupP) * ease(frame, [FOCUS_BEATS.lapse - 4, FOCUS_BEATS.lapse + 8], [1, 0]),
            scale: String(interpolate(popupP, [0, 1], [0.9, 1])),
            transformOrigin: '80% 0%',
            translate: `0 ${interpolate(popupP, [0, 1], [-20, 0])}px`,
          }}
        >
          <Img src={staticFile('shots/popup.png')} style={{ width: 300, display: 'block' }} />
        </div>
      </div>
      <Cursor
        x={interpolate(frame, [60, FOCUS_BEATS.click], [1500, 1728], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT })}
        y={interpolate(frame, [60, FOCUS_BEATS.click], [700, 360], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT })}
        clicks={[FOCUS_BEATS.click]}
        opacity={ease(frame, [58, 66], [0, 1]) * ease(frame, [112, 124], [1, 0])}
      />
    </AbsoluteFill>
  );
};

