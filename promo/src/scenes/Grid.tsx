import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Headline } from '../components/UI';
import { C, ease, fontFamily, pop } from '../theme';

const TILES = [
  { icon: '⌂', title: 'Local-first', sub: 'Your data stays on your device.' },
  { icon: '◷', title: 'Calendar', sub: 'Google, ICS and local events.' },
  { icon: '♫', title: 'Spotify', sub: 'Focus music, one tap away.' },
  { icon: '✎', title: 'Quick Notes', sub: 'Capture from any website.' },
  { icon: '▥', title: 'Analytics', sub: 'Real data. Never invented.' },
  { icon: '✓', title: '1,200 tests', sub: 'Unit, security and real-browser.' },
];
export const GRID_FIRST = 26;
export const GRID_STEP = 7;

/** 09 — Feature grid: six tiles snap in on a fast stagger. */
export const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 110, width: '100%' }}>
        <Headline text="And everything in between." delay={4} size={72} align="center" />
      </div>
      <div style={{ position: 'absolute', left: 210, top: 320, width: 1500, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 30 }}>
        {TILES.map((t, i) => {
          const p = pop(frame, GRID_FIRST + i * GRID_STEP, 13, 190);
          return (
            <div
              key={t.title}
              style={{
                height: 240,
                borderRadius: 24,
                background: C.surface,
                border: `1px solid ${C.lineStrong}`,
                boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
                padding: '34px 36px',
                fontFamily,
                opacity: Math.min(1, p),
                scale: String(interpolate(p, [0, 1], [0.86, 1])),
                translate: `0 ${interpolate(p, [0, 1], [40, 0])}px`,
              }}
            >
              <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(180deg,#26262a,#141416)', border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#e5e5e7' }}>{t.icon}</div>
              <div style={{ marginTop: 26, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', color: C.fg }}>{t.title}</div>
              <div style={{ marginTop: 6, fontSize: 26, color: C.muted }}>{t.sub}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', bottom: 70, width: '100%', textAlign: 'center', fontFamily, fontSize: 24, color: C.faint, opacity: ease(frame, [80, 100], [0, 1]) }}>
        No account. No tracking. No server.
      </div>
    </AbsoluteFill>
  );
};
