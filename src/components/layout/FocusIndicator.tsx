import { Pause, Play, Square, Timer } from 'lucide-react';
import { useStore } from '@/hooks/useStore';
import { useNow } from '@/hooks/useNow';
import { remainingMs } from '@/features/focus/timer';
import { formatClock } from '@/utils/date';
import { pauseFocus, resumeFocus, stopFocus } from '@/services/focus';
import { navigate } from '@/app/router';
import { IconButton } from '@/components/ui';
import { cn } from '@/utils/cn';

export function focusLabel(kind: string): string {
  return kind === 'short' ? 'Short Break' : kind === 'long' ? 'Long Break' : 'Focus Mode';
}

/** Compact always-visible timer shown in the top bar while a session is active. */
export function FocusIndicator({ className }: { className?: string }) {
  const [focus] = useStore('ts.focus');
  const active = focus.status !== 'idle';
  const now = useNow(1000, focus.status === 'running');
  if (!active) return null;
  const label = focusLabel(focus.kind);
  const clock = formatClock(remainingMs(focus, now));
  return (
    <div className={cn('ts-card flex h-11 items-center gap-2 pr-1 pl-3', className)} role="timer" aria-label={`${label}: ${clock} remaining`}>
      <button type="button" onClick={() => navigate('focus')} className="flex items-center gap-2 text-left" aria-label={`Open Focus Mode (${label}, ${clock} remaining)`}>
        <Timer size={17} className="text-muted" aria-hidden />
        <span className="text-[12px] text-muted max-xl:hidden">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums">{clock}</span>
      </button>
      {focus.status === 'running' ? (
        <IconButton label="Pause focus session" onClick={() => void pauseFocus()} size="sm" className="rounded-full border border-line-strong">
          <Pause size={16} />
        </IconButton>
      ) : (
        <IconButton label="Resume focus session" onClick={() => void resumeFocus()} size="sm" className="rounded-full border border-line-strong">
          <Play size={16} />
        </IconButton>
      )}
      <IconButton label="Stop focus session" onClick={() => void stopFocus()} size="sm" className="rounded-full border border-line">
        <Square size={14} />
      </IconButton>
    </div>
  );
}
