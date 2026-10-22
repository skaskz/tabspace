import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BrowserFrame, Callout, Eyebrow, Headline } from '../components/UI';
import { ease, INOUT } from '../theme';

export const NEWTAB_CALLOUTS = [78, 92, 132, 146];

/** 03 — The New Tab hub: the frame tilts up into view, the camera visits workspaces, then calendar + focus. */
export const NewTab: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = ease(frame, [8, 48], [0, 1]);
  // Camera keyframes: overview → workspaces/tasks → calendar/focus → overview
  const zoom = interpolate(frame, [60, 82, 112, 128, 160, 182], [1, 1.55, 1.55, 1.55, 1.55, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: INOUT });
  const fx = interpolate(frame, [60, 82, 112, 128], [0.5, 0.06, 0.06, 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: INOUT });
  const fy = interpolate(frame, [60, 82, 112, 128], [0.5, 0.42, 0.42, 0.42], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: INOUT });
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 64 }}>
        <Eyebrow text="The New Tab, reimagined" delay={2} />
        <Headline text="Your whole day, one new tab away." delay={6} size={64} style={{ marginTop: 14 }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: (1920 - 1320) / 2,
          top: 236,
          perspective: 1800,
        }}
      >
        <div
          style={{
            rotate: `x ${interpolate(enter, [0, 1], [22, 0])}deg`,
            translate: `0 ${interpolate(enter, [0, 1], [220, 0])}px`,
            opacity: enter,
            transformOrigin: '50% 100%',
          }}
        >
          <BrowserFrame src="shots/newtab.png" width={1320} zoom={zoom} focusX={fx} focusY={fy} />
        </div>
      </div>
      <Callout text="Open any workspace in one click" x={190} y={924} delay={NEWTAB_CALLOUTS[0]} out={118} icon="▦" />
      <Callout text="Today's tasks, checked off in place" x={760} y={924} delay={NEWTAB_CALLOUTS[1]} out={120} icon="✓" />
      <Callout text="Calendar & upcoming events" x={520} y={924} delay={NEWTAB_CALLOUTS[2]} out={176} icon="◷" />
      <Callout text="Focus timer, always in sync" x={1010} y={924} delay={NEWTAB_CALLOUTS[3]} out={178} icon="◎" />
    </AbsoluteFill>
  );
};
