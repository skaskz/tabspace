import { Audio } from '@remotion/media';
import { linearTiming, springTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Sparkle, Starfield } from './components/Space';
import { Bar, BAR_BEATS } from './scenes/Bar';
import { Customize, CUSTOMIZE_BEATS } from './scenes/Customize';
import { Focus, FOCUS_BEATS } from './scenes/Focus';
import { Grid, GRID_FIRST, GRID_STEP } from './scenes/Grid';
import { Intro } from './scenes/Intro';
import { NewTab, NEWTAB_CALLOUTS } from './scenes/NewTab';
import { Outro } from './scenes/Outro';
import { Tagline, TAGLINE_BEATS } from './scenes/Tagline';
import { TASK_CHECK, TasksNotes } from './scenes/TasksNotes';
import { Workspaces, WS_BEATS } from './scenes/Workspaces';
import { C, ease, fontFamily, SCENE_START, SCENES, TOTAL, TRANSITION } from './theme';

const COMPONENTS = {
  intro: Intro,
  tagline: Tagline,
  newtab: NewTab,
  workspaces: Workspaces,
  tasks: TasksNotes,
  focus: Focus,
  bar: Bar,
  customize: Customize,
  grid: Grid,
  outro: Outro,
} as const;

/** Transition used into each scene (index = incoming scene). */
const transitionInto = (i: number) =>
  i === 2 || i === 6
    ? { presentation: slide({ direction: 'from-bottom' }), timing: springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION }) }
    : i === 4 || i === 8
      ? { presentation: slide({ direction: 'from-right' }), timing: springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION }) }
      : { presentation: fade(), timing: linearTiming({ durationInFrames: TRANSITION }) };

/** Persistent overlay: chapter counter + corner brackets + slowly turning sparkle (ties the scenes together). */
const Overlay: React.FC = () => {
  const frame = useCurrentFrame();
  const chapterScenes = SCENES.slice(2, 9);
  const idx = chapterScenes.findIndex((s, i) => {
    const start = SCENE_START[s.id] + TRANSITION / 2;
    const next = i < chapterScenes.length - 1 ? SCENE_START[chapterScenes[i + 1].id] + TRANSITION / 2 : SCENE_START.outro;
    return frame >= start && frame < next;
  });
  const showFrame = ease(frame, [SCENE_START.tagline, SCENE_START.tagline + 20], [0, 1]) * ease(frame, [SCENE_START.outro, SCENE_START.outro + 15], [1, 0]);
  const b = 26;
  const bracket = (pos: React.CSSProperties, rot: number) => (
    <div style={{ position: 'absolute', width: b, height: b, borderTop: `2px solid ${C.lineStrong}`, borderLeft: `2px solid ${C.lineStrong}`, rotate: `${rot}deg`, ...pos }} />
  );
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ opacity: showFrame }}>
        {bracket({ left: 40, top: 40 }, 0)}
        {bracket({ right: 40, top: 40 }, 90)}
        {bracket({ right: 40, bottom: 40 }, 180)}
        {bracket({ left: 40, bottom: 40 }, 270)}
      </AbsoluteFill>
      {idx >= 0 && (
        <div style={{ position: 'absolute', right: 86, top: 56, display: 'flex', alignItems: 'center', gap: 14, fontFamily, fontSize: 20, letterSpacing: '0.22em', color: C.faint, textTransform: 'uppercase' }}>
          <span style={{ color: C.fg, fontVariantNumeric: 'tabular-nums' }}>{String(idx + 1).padStart(2, '0')}</span>
          <span style={{ width: 30, height: 1, background: C.lineStrong }} />
          <span>{String(chapterScenes.length).padStart(2, '0')}</span>
        </div>
      )}
      <div style={{ position: 'absolute', right: 66, bottom: 62, opacity: showFrame * 0.8, rotate: `${frame * 0.8}deg` }}>
        <Sparkle size={22} />
      </div>
    </AbsoluteFill>
  );
};

type Cue = { at: number; src: string; volume?: number };

function cues(): Cue[] {
  const s = SCENE_START;
  const list: Cue[] = [
    // Intro
    { at: 0, src: 'riser.wav', volume: 0.55 },
    { at: s.intro + 40, src: 'impact.wav', volume: 0.85 },
    { at: s.intro + 44, src: 'shimmer.wav', volume: 0.55 },
    ...Array.from({ length: 8 }, (_, i) => ({ at: s.intro + 62 + i * 3, src: 'tick.wav', volume: 0.22 })),
    // Tagline
    ...TAGLINE_BEATS.map((b) => ({ at: s.tagline + b, src: 'pop.wav', volume: 0.55 })),
    // New Tab
    ...NEWTAB_CALLOUTS.map((b) => ({ at: s.newtab + b, src: 'click.wav', volume: 0.5 })),
    // Workspaces
    { at: s.workspaces + WS_BEATS.dev, src: 'pop.wav', volume: 0.6 },
    { at: s.workspaces + WS_BEATS.content, src: 'pop.wav', volume: 0.6 },
    { at: s.workspaces + WS_BEATS.collapse, src: 'whoosh-soft.wav', volume: 0.45 },
    { at: s.workspaces + WS_BEATS.jobs, src: 'pop.wav', volume: 0.6 },
    // Tasks
    { at: s.tasks + TASK_CHECK, src: 'click.wav', volume: 0.6 },
    { at: s.tasks + TASK_CHECK + 2, src: 'pop.wav', volume: 0.45 },
    // Focus
    { at: s.focus + FOCUS_BEATS.badge, src: 'pop.wav', volume: 0.55 },
    { at: s.focus + FOCUS_BEATS.click, src: 'click.wav', volume: 0.6 },
    { at: s.focus + FOCUS_BEATS.popup, src: 'whoosh-soft.wav', volume: 0.4 },
    { at: s.focus + FOCUS_BEATS.lapse - 6, src: 'riser.wav', volume: 0.35 },
    { at: s.focus + FOCUS_BEATS.done, src: 'chime.wav', volume: 0.7 },
    // Bar
    ...Array.from({ length: 7 }, (_, i) => ({ at: s.bar + BAR_BEATS.chips + i * BAR_BEATS.chipStep, src: 'tick.wav', volume: 0.25 })),
    { at: s.bar + BAR_BEATS.star, src: 'click.wav', volume: 0.6 },
    { at: s.bar + BAR_BEATS.picker, src: 'whoosh-soft.wav', volume: 0.3 },
    { at: s.bar + BAR_BEATS.save, src: 'click.wav', volume: 0.6 },
    { at: s.bar + BAR_BEATS.toast, src: 'pop.wav', volume: 0.5 },
    // Customize
    { at: s.customize + CUSTOMIZE_BEATS.grab, src: 'click.wav', volume: 0.55 },
    { at: s.customize + CUSTOMIZE_BEATS.grab + 6, src: 'whoosh-soft.wav', volume: 0.4 },
    { at: s.customize + CUSTOMIZE_BEATS.drop, src: 'pop.wav', volume: 0.55 },
    // Grid
    ...Array.from({ length: 6 }, (_, i) => ({ at: s.grid + GRID_FIRST + i * GRID_STEP, src: 'tick.wav', volume: 0.3 })),
    // Outro
    { at: s.outro + 2, src: 'impact.wav', volume: 0.8 },
    { at: s.outro + 16, src: 'shimmer.wav', volume: 0.5 },
  ];
  // A whoosh on every scene change after the intro.
  SCENES.slice(1).forEach((sc) => list.push({ at: Math.max(0, SCENE_START[sc.id] - 4), src: sc.id === 'outro' ? 'whoosh-soft.wav' : 'whoosh.wav', volume: 0.42 }));
  return list.sort((a, b) => a.at - b.at);
}

export const TabspacePromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Starfield />
      <TransitionSeries>
        {SCENES.flatMap((sc, i) => {
          const Comp = COMPONENTS[sc.id];
          const seq = (
            <TransitionSeries.Sequence key={sc.id} name={sc.label} durationInFrames={sc.dur}>
              <Comp />
            </TransitionSeries.Sequence>
          );
          if (i === 0) return [seq];
          const t = transitionInto(i);
          return [<TransitionSeries.Transition key={`t-${sc.id}`} presentation={t.presentation} timing={t.timing} />, seq];
        })}
      </TransitionSeries>
      <Overlay />
      {/* Music bed: fade in, duck slightly under the outro hit, fade out at the end */}
      <Audio
        src={staticFile('audio/music.wav')}
        volume={(f) => interpolate(f, [0, 30, TOTAL - 60, TOTAL], [0, 0.55, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
      />
      {cues().map((c, i) => (
        <Sequence key={i} from={c.at} durationInFrames={90} name={`sfx ${c.src}`} layout="none">
          <Audio src={staticFile(`audio/${c.src}`)} volume={c.volume ?? 0.6} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
