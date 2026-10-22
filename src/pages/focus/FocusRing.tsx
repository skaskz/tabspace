import { useId, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/**
 * Thin silver circular progress ring with a small knob at the progress point.
 * `progress` is 0..1 (elapsed fraction). Content is centred inside the ring.
 */
export function FocusRing({ progress, size = 300, stroke = 2.5, knob = true, children, className, label }: { progress: number; size?: number; stroke?: number; knob?: boolean; children?: ReactNode; className?: string; label?: string }) {
  const gid = useId().replace(/:/g, '');
  const p = Math.min(1, Math.max(0, progress));
  const c = size / 2;
  const r = c - Math.max(stroke, knob ? size * 0.022 : 0) - 2;
  const circ = 2 * Math.PI * r;
  const angle = p * 2 * Math.PI - Math.PI / 2;
  const kx = c + r * Math.cos(angle);
  const ky = c + r * Math.sin(angle);
  const knobR = Math.max(3, size * 0.018);
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
        <defs>
          <linearGradient id={`ring${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--ts-fg)" stopOpacity="0.95" />
            <stop offset="1" stopColor="var(--ts-muted)" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ts-line-strong)" strokeOpacity="0.55" strokeWidth={Math.max(1, stroke * 0.6)} />
        {p > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={`url(#ring${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ * p} ${circ}`}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: 'stroke-dasharray 400ms linear' }}
          />
        )}
        {knob && (
          <>
            <circle cx={kx} cy={ky} r={knobR * 2.2} fill="var(--ts-fg)" opacity="0.08" />
            <circle cx={kx} cy={ky} r={knobR} fill="var(--ts-fg)" />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
