import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Headline, ShotCard } from '../components/UI';
import { C, ease, fontFamily, pop } from '../theme';

export const TASK_CHECK = 96;

/** 05 — Tasks and Notes float in; a task gets checked off. */
export const TasksNotes: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease(frame, [6, 40], [0, 1]);
  const b = ease(frame, [16, 50], [0, 1]);
  const check = pop(frame, TASK_CHECK, 12, 200);
  const strike = ease(frame, [TASK_CHECK + 4, TASK_CHECK + 18], [0, 1]);
  const drift = interpolate(frame, [0, 165], [0, -20]);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 92, width: '100%' }}>
        <Headline text="Tasks and notes, without the clutter." delay={4} size={70} align="center" />
      </div>
      <ShotCard
        src="shots/tasks.png"
        width={820}
        height={492}
        cropScale={0.5125}
        style={{ position: 'absolute', left: 150, top: 300, rotate: `${interpolate(a, [0, 1], [-10, -3])}deg`, opacity: a, translate: `0 ${interpolate(a, [0, 1], [180, drift])}px` }}
      />
      <ShotCard
        src="shots/notes.png"
        width={820}
        height={492}
        cropScale={0.5125}
        style={{ position: 'absolute', left: 950, top: 330, rotate: `${interpolate(b, [0, 1], [10, 3])}deg`, opacity: b, translate: `0 ${interpolate(b, [0, 1], [200, -drift])}px` }}
      />
      {/* Recreated task row: the readable "hero" element of the scene */}
      <div
        style={{
          position: 'absolute',
          left: 410,
          top: 820,
          width: 1100,
          height: 104,
          borderRadius: 22,
          background: 'rgba(12,12,14,0.94)',
          border: `1px solid ${C.lineStrong}`,
          boxShadow: '0 24px 70px rgba(0,0,0,0.7), 0 0 40px rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: 26,
          padding: '0 34px',
          opacity: ease(frame, [56, 72], [0, 1]),
          translate: `0 ${ease(frame, [56, 72], [30, 0])}px`,
        }}
      >
        <div style={{ width: 46, height: 46, borderRadius: 23, border: `2px solid ${check > 0.1 ? '#fff' : C.lineStrong}`, background: check > 0.1 ? '#fff' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" style={{ scale: String(check), opacity: Math.min(1, check) }}>
            <path d="M5 12.5 L10 17 L19 7" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ position: 'relative', whiteSpace: 'nowrap', fontFamily, fontSize: 36, fontWeight: 600, color: interpolate(strike, [0, 1], [1, 0.5]) > 0.75 ? C.fg : C.muted }}>
          Finish AI automation script
          <div style={{ position: 'absolute', left: 0, top: '54%', height: 3, width: `${strike * 100}%`, background: C.muted }} />
        </div>
        <div style={{ marginLeft: 'auto', whiteSpace: 'nowrap', fontFamily, fontSize: 22, color: C.faint }}>Today · 5:00 PM</div>
      </div>
    </AbsoluteFill>
  );
};
