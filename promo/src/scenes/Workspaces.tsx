import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Eyebrow, Headline, ShotCard } from '../components/UI';
import { C, ease, fontFamily, pop } from '../theme';

export const WS_BEATS = { tabsIn: 18, dev: 48, content: 82, collapse: 118, jobs: 148 };

type Tab = { letter: string; title: string };
type Group = { name: string; color: string; tabs: Tab[]; at: number; collapseAt?: number };

const GROUPS: Group[] = [
  { name: 'Development', color: '#8ab4f8', at: WS_BEATS.dev, collapseAt: WS_BEATS.collapse, tabs: [{ letter: 'G', title: 'GitHub' }, { letter: 'D', title: 'Extensions docs' }, { letter: 'M', title: 'MDN Web Docs' }] },
  { name: 'Content Creation', color: '#ff8bcb', at: WS_BEATS.content, tabs: [{ letter: 'S', title: 'YouTube Studio' }, { letter: 'N', title: 'Notion' }] },
  { name: 'Job Search', color: '#81c995', at: WS_BEATS.jobs, tabs: [{ letter: 'L', title: 'LinkedIn Jobs' }] },
];

const TAB_W = 168;

/** 04 — Loose tabs snap into native, named Chrome tab groups; one collapses; another workspace opens. */
export const Workspaces: React.FC = () => {
  const frame = useCurrentFrame();
  const win = ease(frame, [4, 30], [0, 1]);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 250, width: 720 }}>
        <Eyebrow text="Workspaces" delay={2} />
        <Headline text="Every workspace opens as its own Chrome tab group." delay={6} size={70} style={{ marginTop: 18 }} />
        <div style={{ marginTop: 30, fontFamily, fontSize: 32, lineHeight: 1.45, color: C.muted, opacity: ease(frame, [30, 50], [0, 1]) }}>
          Several side by side. No duplicate tabs.
          <br />
          Remembered after Chrome restarts.
        </div>
      </div>

      {/* Chrome window mock with a live tab strip */}
      <div
        style={{
          position: 'absolute',
          left: 900,
          top: 220,
          width: 900,
          borderRadius: 18,
          overflow: 'hidden',
          border: `1px solid ${C.lineStrong}`,
          background: '#070708',
          boxShadow: '0 40px 120px rgba(0,0,0,0.7)',
          opacity: win,
          translate: `${interpolate(win, [0, 1], [80, 0])}px 0`,
        }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'flex-end', gap: 6, padding: '0 14px', background: '#020203', overflow: 'hidden' }}>
          {GROUPS.map((g) => {
            const appear = pop(frame, g.at, 14, 160);
            const collapse = g.collapseAt ? ease(frame, [g.collapseAt, g.collapseAt + 18], [0, 1]) : 0;
            return (
              <div key={g.name} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, opacity: Math.min(1, appear * 1.5), maxWidth: interpolate(Math.min(1, appear), [0, 1], [0, 900]) }}>
                <div
                  style={{
                    height: 30,
                    marginBottom: 12,
                    padding: '0 14px',
                    borderRadius: 9,
                    background: g.color,
                    color: '#111',
                    fontFamily,
                    fontWeight: 700,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    whiteSpace: 'nowrap',
                    scale: String(interpolate(appear, [0, 1], [0.6, 1])),
                    boxShadow: collapse > 0.5 ? `0 0 24px ${g.color}66` : 'none',
                  }}
                >
                  {g.name}
                </div>
                {g.tabs.map((t, i) => {
                  const slot = pop(frame, g.at + 4 + i * 4, 15, 170);
                  return (
                    <div
                      key={t.title}
                      style={{
                        width: interpolate(collapse, [0, 1], [TAB_W, 0]),
                        overflow: 'hidden',
                        height: 44,
                        borderRadius: '10px 10px 0 0',
                        background: i === 0 && g.name === 'Development' && collapse < 0.5 ? '#141416' : '#0b0b0d',
                        borderBottom: `3px solid ${g.color}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: collapse > 0.95 ? 0 : '0 12px',
                        translate: `0 ${interpolate(slot, [0, 1], [40, 0])}px`,
                        opacity: Math.min(1, slot) * (1 - collapse * 0.6),
                      }}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: 5, background: '#26262a', color: '#cfcfd2', fontFamily, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{t.letter}</div>
                      <div style={{ fontFamily, fontSize: 15, color: C.fg, whiteSpace: 'nowrap' }}>{t.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ height: 50, background: '#0b0b0d', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 18px' }}>
          <div style={{ flex: 1, height: 32, borderRadius: 16, background: '#141416', fontFamily, fontSize: 15, color: C.faint, display: 'flex', alignItems: 'center', padding: '0 16px' }}>github.com</div>
        </div>
        <div style={{ height: 70, background: 'linear-gradient(180deg,#0a0a0b,#060607)' }} />
      </div>

      <ShotCard
        src="shots/workspaces.png"
        width={900}
        height={300}
        cropX={262}
        cropY={180}
        cropScale={0.69}
        style={{ position: 'absolute', left: 900, top: 490, opacity: ease(frame, [26, 52], [0, 1]), translate: `0 ${ease(frame, [26, 52], [60, 0])}px` }}
      />
    </AbsoluteFill>
  );
};
