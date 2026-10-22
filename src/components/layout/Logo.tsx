import { useId } from 'react';
import { cn } from '@/utils/cn';

/** Tabspace mark: two offset rounded "tabs" and a four-point sparkle (Option F). */
export function LogoMark({ size = 32, className, simple }: { size?: number; className?: string; simple?: boolean }) {
  const id = useId().replace(/:/g, '');
  if (simple || size < 24) {
    return (
      <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
        <rect x="2" y="5" width="18" height="11" rx="3" fill="#e9e9ea" />
        <rect x="9" y="16" width="18" height="11" rx="3" fill="#8a8c90" />
        <path d="M26 2 Q26 7.5 31 7.5 Q26 7.5 26 13 Q26 7.5 21 7.5 Q26 7.5 26 2 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={`b${id}`} x1="6" y1="10" x2="40" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#c9cacc" />
          <stop offset="1" stopColor="#8d8f93" />
        </linearGradient>
        <linearGradient id={`f${id}`} x1="16" y1="28" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9a9ca0" />
          <stop offset="0.5" stopColor="#5d5f63" />
          <stop offset="1" stopColor="#2f3033" />
        </linearGradient>
        <linearGradient id={`e${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <rect x="6" y="11" width="33" height="21" rx="6" fill={`url(#b${id})`} />
      <rect x="6.5" y="11.5" width="32" height="20" rx="5.5" fill="none" stroke={`url(#e${id})`} />
      <rect x="17" y="30" width="33" height="21" rx="6" fill={`url(#f${id})`} />
      <rect x="17.5" y="30.5" width="32" height="20" rx="5.5" fill="none" stroke={`url(#e${id})`} />
      <path d="M51 8 Q51 17 60 17 Q51 17 51 26 Q51 17 42 17 Q51 17 51 8 Z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className, size = 34 }: { className?: string; size?: number }) {
  return (
    <div className={cn('flex items-center gap-3 text-fg', className)}>
      <LogoMark size={size} />
      <span className="text-[1.35rem] font-semibold tracking-[-0.02em]">Tabspace</span>
    </div>
  );
}
