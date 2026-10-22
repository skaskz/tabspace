import type { ReactNode } from 'react';

/** Page title block: optional eyebrow, title, subtitle and right-aligned actions. */
export function PageHero({ title, subtitle, eyebrow, actions }: { title: ReactNode; subtitle?: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="relative mb-6 flex flex-wrap items-end gap-4 pt-2">
      <div className="relative min-w-0 flex-1">
        {eyebrow && <div className="mb-1 text-[15px] text-muted">{eyebrow}</div>}
        <h1 className="text-[2.6rem] leading-tight font-bold tracking-[-0.035em]">{title}</h1>
        {subtitle && <p className="mt-2 text-[15.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="relative flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
