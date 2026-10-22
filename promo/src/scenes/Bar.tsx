import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { LogoMark } from '../components/Logo';
import { Cursor, Eyebrow, Headline } from '../components/UI';
import { C, ease, fontFamily, OUT, pop } from '../theme';

const CHIPS: { label: string; kind: 'fav' | 'folder' }[] = [
  { label: 'Claude', kind: 'fav' },
  { label: 'ChatGPT', kind: 'fav' },
  { label: 'GitHub', kind: 'fav' },
  { label: 'Notion', kind: 'fav' },
  { label: 'AI Tools', kind: 'folder' },
  { label: 'Development', kind: 'folder' },
  { label: 'Job Search', kind: 'folder' },
];
export const BAR_BEATS = { chips: 20, chipStep: 5, star: 82, picker: 86, save: 118, toast: 122 };

/** 07 — The Tabspace Bar slides onto a website; ☆ bookmarks the page into a chosen folder. */
export const Bar: React.FC = () => {
  const frame = useCurrentFrame();
  const page = ease(frame, [4, 30], [0, 1]);
  const starP = pop(frame, BAR_BEATS.star, 10, 220);
  const picker = pop(frame, BAR_BEATS.picker, 15, 170) * ease(frame, [BAR_BEATS.save + 2, BAR_BEATS.save + 12], [1, 0]);
  const toast = pop(frame, BAR_BEATS.toast, 14, 170) * ease(frame, [156, 165], [1, 0]);
  const filled = frame >= BAR_BEATS.save;
  const X0 = 310;
  const Y0 = 330;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 70 }}>
        <Eyebrow text="Tabspace Bar" delay={2} />
        <Headline text="Your bookmarks bar, rebuilt." delay={6} size={64} style={{ marginTop: 14 }} />
        <div style={{ marginTop: 10, fontFamily, fontSize: 30, color: C.muted, opacity: ease(frame, [20, 40], [0, 1]) }}>On your New Tab — and on any site you choose.</div>
      </div>

      {/* A generic website with the bar on top */}
      <div style={{ position: 'absolute', left: X0, top: Y0, width: 1300, height: 640, borderRadius: 20, overflow: 'hidden', background: '#0d0d0f', border: `1px solid ${C.lineStrong}`, boxShadow: '0 40px 120px rgba(0,0,0,0.7)', opacity: page, translate: `0 ${interpolate(page, [0, 1], [70, 0])}px` }}>
        <div style={{ height: 58, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: '#050506', borderBottom: `1px solid ${C.line}`, translate: `0 ${ease(frame, [10, 26], [-60, 0])}px` }}>
          <LogoMark size={30} />
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: frame >= BAR_BEATS.star ? '#1d1d20' : 'transparent', scale: String(frame >= BAR_BEATS.star ? interpolate(starP, [0, 1], [0.8, 1]) : 1) }}>
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path d="M12 3 L14.6 9 L21 9.6 L16.1 13.8 L17.6 20.2 L12 16.8 L6.4 20.2 L7.9 13.8 L3 9.6 L9.4 9 Z" fill={filled ? '#fff' : 'none'} stroke="#e5e5e7" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ width: 1, height: 26, background: C.line, margin: '0 6px' }} />
          {CHIPS.map((c, i) => {
            const p = pop(frame, BAR_BEATS.chips + i * BAR_BEATS.chipStep, 14, 200);
            return (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 13px', borderRadius: 10, fontFamily, fontSize: 19, color: C.fg, opacity: Math.min(1, p), translate: `${interpolate(p, [0, 1], [-24, 0])}px 0` }}>
                {c.kind === 'fav' ? (
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: '#26262a', color: '#cfcfd2', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.label[0]}</div>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 6 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2-2 Z" fill="none" stroke="#cfcfd2" strokeWidth="1.6" /></svg>
                )}
                {c.label}
              </div>
            );
          })}
          <div style={{ marginLeft: 'auto', fontFamily, fontSize: 19, color: C.muted, opacity: ease(frame, [56, 66], [0, 1]) }}>▦ Workspaces</div>
        </div>
        {/* page skeleton */}
        <div style={{ padding: '56px 70px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ width: 520, height: 34, borderRadius: 8, background: '#1b1b1e' }} />
          {[1, 0.92, 0.97, 0.6].map((w, i) => (
            <div key={i} style={{ width: `${w * 100}%`, height: 16, borderRadius: 6, background: '#151517' }} />
          ))}
          <div style={{ display: 'flex', gap: 22, marginTop: 20 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ flex: 1, height: 220, borderRadius: 14, background: '#121214' }} />
            ))}
          </div>
        </div>
        {/* folder picker popover */}
        <div style={{ position: 'absolute', left: 50, top: 70, width: 380, borderRadius: 18, background: '#060607', border: `1px solid ${C.lineStrong}`, boxShadow: '0 24px 70px rgba(0,0,0,0.8)', padding: 22, fontFamily, opacity: Math.min(1, picker), scale: String(interpolate(picker, [0, 1], [0.92, 1])), transformOrigin: '10% 0%' }}>
          <div style={{ fontSize: 15, color: C.muted, marginBottom: 6 }}>Title</div>
          <div style={{ height: 44, borderRadius: 10, background: '#18181b', border: `1px solid ${C.line}`, color: C.fg, fontSize: 18, display: 'flex', alignItems: 'center', padding: '0 14px' }}>Design inspiration</div>
          <div style={{ fontSize: 15, color: C.muted, margin: '14px 0 6px' }}>Folder</div>
          <div style={{ height: 44, borderRadius: 10, background: '#18181b', border: `1px solid ${C.lineStrong}`, color: C.fg, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
            Read later <span style={{ color: C.muted }}>▾</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 18 }}>
            <div style={{ padding: '10px 16px', color: C.muted, fontSize: 17 }}>Cancel</div>
            <div style={{ padding: '10px 22px', borderRadius: 999, background: '#fff', color: '#0a0a0a', fontWeight: 700, fontSize: 17, scale: String(frame >= BAR_BEATS.save && frame < BAR_BEATS.save + 5 ? 0.94 : 1) }}>Save</div>
          </div>
        </div>
        {/* toast */}
        <div style={{ position: 'absolute', left: '50%', bottom: 40, translate: `-50% ${interpolate(toast, [0, 1], [20, 0])}px`, opacity: Math.min(1, toast), padding: '14px 24px', borderRadius: 14, background: '#060607', border: `1px solid ${C.lineStrong}`, fontFamily, fontSize: 20, color: C.fg, whiteSpace: 'nowrap' }}>★ Saved to Read later</div>
      </div>

      <Cursor
        x={interpolate(frame, [58, 80, 100, 116], [1100, X0 + 98, X0 + 98, X0 + 400], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT })}
        y={interpolate(frame, [58, 80, 100, 116], [800, Y0 + 30, Y0 + 30, Y0 + 336], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT })}
        clicks={[BAR_BEATS.star, BAR_BEATS.save]}
        opacity={ease(frame, [56, 64], [0, 1]) * ease(frame, [138, 148], [1, 0])}
      />
    </AbsoluteFill>
  );
};
