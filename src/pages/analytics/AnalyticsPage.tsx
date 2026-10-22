import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Globe, Lock } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHero } from '@/components/layout/PageHero';
import { Card, CardHeader, EmptyState, IconButton, Input, Segmented, Toggle } from '@/components/ui';
import { useSettings, useStore } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { addDays, formatDuration, toDateKey } from '@/utils/date';
import { cn } from '@/utils/cn';
import {
  change,
  completionsByDay,
  focusByDay,
  focusByHour,
  periodFor,
  periodLabel,
  shiftPeriod,
  topDomains,
  totals,
  plural,
  weeklyTrend,
  workspaceActivity,
  type Period,
  type RangeKind,
} from '@/features/analytics/aggregate';

const RANGES: { value: RangeKind; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
];

const AXIS = { stroke: 'var(--ts-faint)', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: 'var(--ts-bg)', border: '1px solid var(--ts-line-strong)', borderRadius: 10, fontSize: 12, color: 'var(--ts-fg)' };
const cursorFill = { fill: 'var(--ts-glow)' };
const minutes = (ms: number) => Math.round(ms / 60_000);

function Stat({ label, value, delta, hint }: { label: string; value: string; delta: number | null; hint: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-[1.9rem] leading-tight font-semibold tracking-[-0.02em]">{value}</p>
      <p className="mt-1 text-[12px] text-faint">{delta === null ? hint : <span className={cn(delta >= 0 ? 'text-fg' : 'text-muted')}>{`${delta >= 0 ? '+' : ''}${delta}% vs previous period`}</span>}</p>
    </Card>
  );
}

/** A chart with a titled metric and a one-line explanation of exactly what is counted. */
function ChartCard({ title, caption, empty, emptyText, children, className }: { title: string; caption: string; empty: boolean; emptyText: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} className="pb-0" />
      <p className="px-5 pb-3 text-[12.5px] text-muted">{caption}</p>
      <div className="px-3 pb-4">{empty ? <EmptyState icon={<BarChart3 size={22} />} title="No data yet" description={emptyText} className="py-8" /> : <div className="h-56">{children}</div>}</div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [sessions] = useStore('ts.focusSessions');
  const [tasks] = useStore('ts.tasks');
  const [notes] = useStore('ts.notes');
  const [workspaces] = useStore('ts.workspaces');
  const [activity] = useStore('ts.workspaceActivity');
  const [usage] = useStore('ts.usage');
  const [settings] = useSettings();
  const tracking = settings.analytics.trackWebsites;

  const [kind, setKind] = useState<RangeKind>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [custom, setCustom] = useState(() => ({ from: toDateKey(addDays(new Date(), -6)), to: toDateKey(new Date()) }));

  const period: Period = useMemo(() => periodFor(kind, anchor, custom), [kind, anchor, custom]);
  const prev = useMemo(() => shiftPeriod(period, -1), [period]);

  const data = { sessions, tasks, usage: tracking ? usage : {} };
  const cur = totals(period, data);
  const before = totals(prev, data);

  const focusSeries = (kind === 'today' ? focusByHour(sessions, period) : focusByDay(sessions, period)).map((d) => ({ ...d, minutes: minutes(d.value) }));
  const doneSeries = completionsByDay(tasks, period);
  const trend = weeklyTrend(sessions, tasks, addDays(period.end, -1), 8).map((w) => ({ ...w, hours: Math.round((w.focusMs / 3600_000) * 10) / 10 }));
  const wsRows = workspaceActivity(period, { activity, workspaces, tasks, notes });
  const domains = tracking ? topDomains(usage, period, 8).map((d) => ({ ...d, minutes: minutes(d.ms) })) : [];

  const move = (dir: 1 | -1) => {
    const next = shiftPeriod(period, dir);
    if (kind === 'custom') setCustom({ from: toDateKey(next.start), to: toDateKey(addDays(next.end, -1)) });
    else setAnchor(next.start);
  };

  return (
    <div>
      <PageHero title="Analytics" subtitle="See how you spend your time. Find patterns. Build better habits." />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Date range"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setAnchor(new Date());
          }}
          options={RANGES}
        />
        <div className="flex items-center gap-1">
          <IconButton label="Previous period" onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Next period" onClick={() => move(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <span className="text-sm text-muted" aria-live="polite">
          {periodLabel(period)}
        </span>
        {kind === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={custom.from} max={custom.to} onChange={(e) => {
                const v = e.target.value;
                if (v) setCustom((c) => ({ ...c, from: v }));
              }} />
            <span className="text-faint">–</span>
            <Input type="date" aria-label="To date" value={custom.to} min={custom.from} onChange={(e) => {
                const v = e.target.value;
                if (v) setCustom((c) => ({ ...c, to: v }));
              }} />
          </div>
        )}
      </div>

      <div className={cn('mb-5 grid gap-4', tracking ? 'grid-cols-4 max-xl:grid-cols-2' : 'grid-cols-3 max-xl:grid-cols-2')}>
        <Stat label="Total Focus Time" value={formatDuration(cur.focusMs)} delta={change(cur.focusMs, before.focusMs)} hint="Focus and custom sessions" />
        <Stat label="Completed Tasks" value={String(cur.completedTasks)} delta={change(cur.completedTasks, before.completedTasks)} hint="Tasks marked done" />
        <Stat label="Focus Sessions" value={String(cur.focusSessions)} delta={change(cur.focusSessions, before.focusSessions)} hint="Breaks not counted" />
        {tracking && <Stat label="Website Time" value={formatDuration(cur.websiteMs)} delta={change(cur.websiteMs, before.websiteMs)} hint="Active tab time" />}
      </div>

      <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
        <ChartCard title={kind === 'today' ? 'Focus minutes by hour' : 'Focus minutes by day'} caption="Minutes spent in focus and custom sessions (breaks excluded)." empty={cur.focusMs === 0} emptyText="Finish a focus session to see your focus time here.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={focusSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--ts-line)" />
              <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} allowDecimals={false} unit="m" />
              <Tooltip cursor={cursorFill} contentStyle={tooltipStyle} formatter={(v: number) => [`${v} min`, 'Focus']} />
              <Bar dataKey="minutes" fill="var(--ts-fg)" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tasks completed by day" caption="Number of tasks marked done on each day, across all workspaces." empty={cur.completedTasks === 0} emptyText="Completed tasks show up here by the day you finished them.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={doneSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--ts-line)" />
              <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip cursor={cursorFill} contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Completed']} />
              <Bar dataKey="value" fill="var(--ts-muted)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weekly focus hours" caption="Hours of focus per week (Sun–Sat), last 8 weeks ending with the selected period." empty={trend.every((w) => w.focusMs === 0)} emptyText="Your weekly focus hours for the last 8 weeks will appear here.">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--ts-line)" />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} allowDecimals unit="h" />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Week of ${l}`} formatter={(v: number, _n: string, item: { payload?: { completed?: number } }) => [`${v} h · ${plural(item.payload?.completed ?? 0, 'task')} done`, 'Focus']} />
              <Line type="monotone" dataKey="hours" stroke="var(--ts-fg)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--ts-fg)' }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader title="Workspace activity" className="pb-0" />
          <p className="px-5 pb-3 text-[12.5px] text-muted">Per workspace in this period: times opened, tasks completed and notes edited. “Open tasks” is the current count, as on the dashboard.</p>
          <div className="px-5 pb-5">
            {wsRows.length === 0 ? (
              <EmptyState icon={<BarChart3 size={22} />} title="No workspace activity" description="Opening a workspace, finishing its tasks or editing its notes counts here." className="py-8" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-faint">
                    <th scope="col" className="pb-2 font-medium">Workspace</th>
                    <th scope="col" className="pb-2 text-right font-medium">Opened</th>
                    <th scope="col" className="pb-2 text-right font-medium">Tasks done</th>
                    <th scope="col" className="pb-2 text-right font-medium">Notes edited</th>
                    <th scope="col" className="pb-2 text-right font-medium">Open tasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {wsRows.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <th scope="row" className="py-2 pr-3 text-left font-normal break-words">{r.name}</th>
                      <td className="py-2 text-right tabular-nums" aria-label={plural(r.opens, 'open')}>{r.opens}</td>
                      <td className="py-2 text-right tabular-nums" aria-label={`${plural(r.tasksDone, 'task')} completed`}>{r.tasksDone}</td>
                      <td className="py-2 text-right tabular-nums" aria-label={`${plural(r.notesEdited, 'note')} edited`}>{r.notesEdited}</td>
                      <td className="py-2 text-right tabular-nums text-muted" aria-label={`${plural(r.openTasks, 'open task')}`}>{r.openTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {tracking ? (
          <ChartCard className="col-span-2 max-xl:col-span-1" title="Website usage — top sites" caption="Minutes the site was the active tab, by domain (top 8)." empty={domains.length === 0} emptyText="Time on websites is recorded while tracking is on. Check back after browsing for a while.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={domains} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--ts-line)" />
                <XAxis type="number" {...AXIS} unit="m" allowDecimals={false} />
                <YAxis type="category" dataKey="domain" {...AXIS} width={130} />
                <Tooltip cursor={cursorFill} contentStyle={tooltipStyle} formatter={(v: number) => [formatDuration(v * 60_000), 'Time']} />
                <Bar dataKey="minutes" fill="var(--ts-fg)" fillOpacity={0.75} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <Card className="col-span-2 max-xl:col-span-1">
            <div className="flex items-start gap-4 px-5 py-5">
              <Globe size={20} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div className="flex-1">
                <h2 className="text-[15px] font-semibold">Website usage is off</h2>
                <p className="mt-1 max-w-2xl text-[13px] text-muted">
                  Turn this on to see which sites take your time. Tabspace records only the website domain (like github.com) and how long its tab was active — never page addresses, titles or content. Data is stored locally in this browser and is never transmitted.
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-faint">
                  <Lock size={12} aria-hidden /> You can delete usage data any time in Settings → Privacy.
                </p>
              </div>
              <Toggle checked={false} label="Track website usage" onChange={(v) => void update('ts.settings', (s) => ({ ...s, analytics: { ...s.analytics, trackWebsites: v } }))} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
