import { get, newId, set, update } from '@/storage/store';
import type { StoreKey } from '@/storage/schema';
import type { Bookmark, BookmarkFolder, CalendarEvent, CalendarSource, Note, QuickLink, SavedSession, SavedTab, Task, Workspace } from '@/types/models';
import { addDays, toDateKey } from '@/utils/date';

/**
 * Example data. Every record id is tracked in `ts.sampleIds` so "Remove example data"
 * deletes exactly these records (and nothing the user created). Loading twice is a no-op.
 */

const SAMPLE_KEYS = ['ts.workspaces', 'ts.sessions', 'ts.tasks', 'ts.notes', 'ts.bookmarkFolders', 'ts.bookmarks', 'ts.quickLinks', 'ts.calendarSources', 'ts.events'] as const satisfies readonly StoreKey[];
type SampleKey = (typeof SAMPLE_KEYS)[number];

export async function hasSampleData(): Promise<boolean> {
  const ids = await get('ts.sampleIds');
  return SAMPLE_KEYS.some((k) => (ids[k]?.length ?? 0) > 0);
}

function at(day: Date, h: number, m = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

/** Build the sample records relative to `now` (pure; exported for tests). */
export function buildSampleData(now = new Date()) {
  const ts = now.getTime();
  const rec = <T extends object>(o: T) => ({ id: newId(), createdAt: ts, updatedAt: ts, ...o });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (n: number) => toDateKey(addDays(today, n));

  const ws = {
    dev: rec({ name: 'Development', icon: 'code', description: 'Coding projects and tools', order: 0 }),
    content: rec({ name: 'Content Creation', icon: 'video', description: 'YouTube and social content', order: 1 }),
    jobs: rec({ name: 'Job Search', icon: 'briefcase', description: 'Applications and interview prep', order: 2 }),
    personal: rec({ name: 'Personal', icon: 'user', description: 'Health, errands and life admin', order: 3 }),
  } satisfies Record<string, Workspace>;

  // One saved session per workspace so "Open" restores real public pages (with a native group in Development).
  const tab = (title: string, url: string, groupId?: string): SavedTab => ({ id: newId(), title, url, pinned: false, groupId });
  const session = (name: string, workspaceId: string, tabs: SavedTab[], groups: SavedSession['groups'] = []): SavedSession => rec({ name, workspaceId, tabs, groups });
  const devDocs = newId();
  const sessions: SavedSession[] = [
    session('Development', ws.dev.id, [
      tab('GitHub', 'https://github.com/'),
      tab('Chrome Extensions docs', 'https://developer.chrome.com/docs/extensions', devDocs),
      tab('MDN Web Docs', 'https://developer.mozilla.org/', devDocs),
    ], [{ id: devDocs, title: 'Docs', color: 'blue', collapsed: false }]),
    session('Content Creation', ws.content.id, [tab('YouTube Studio', 'https://studio.youtube.com/'), tab('Notion', 'https://www.notion.so/')]),
    session('Job Search', ws.jobs.id, [tab('LinkedIn Jobs', 'https://www.linkedin.com/jobs/')]),
  ];

  const task = (title: string, o: Partial<Task>, order: number): Task => rec({ title, done: false, priority: 'none' as const, subtasks: [], order, ...o });
  const tasks: Task[] = [
    task('Finish AI automation script', { dueDate: day(0), dueTime: '17:00', priority: 'high', workspaceId: ws.dev.id }, 0),
    task('Push Tabspace to GitHub', { dueDate: day(1), priority: 'medium', workspaceId: ws.dev.id, subtasks: [{ id: newId(), title: 'Write README', done: true }, { id: newId(), title: 'Tag v1.0.0', done: false }] }, 1),
    task('Review job applications', { dueDate: day(2), priority: 'medium', workspaceId: ws.jobs.id }, 2),
    task('Edit YouTube Short', { dueDate: day(3), priority: 'low', workspaceId: ws.content.id }, 3),
    task('Research Roblox mechanics', { someday: true, workspaceId: ws.dev.id }, 4),
    task('Go for a run', { dueDate: day(0), dueTime: '07:30', workspaceId: ws.personal.id, done: true, completedAt: ts }, 5),
  ];

  const notes: Note[] = [
    rec({ title: 'Roblox game ideas', content: '# Roblox game ideas\n\n- Obby with time-trial leaderboard\n- Co-op tycoon with shared upgrades\n- Physics puzzle rooms', tags: ['ideas', 'roblox'], favorite: true, workspaceId: ws.dev.id }),
    rec({ title: 'YouTube content ideas', content: '# YouTube content ideas\n\n1. 60-second productivity setup tour\n2. Building a Chrome extension in a weekend\n3. My focus routine', tags: ['content'], favorite: false, workspaceId: ws.content.id }),
    rec({ title: 'Tabspace launch checklist', content: '# Tabspace launch checklist\n\n- [x] Icons and screenshots\n- [ ] Privacy notes\n- [ ] Chrome Web Store listing', tags: ['launch'], favorite: false, workspaceId: ws.dev.id }),
  ];

  const folder = (name: string, order: number): BookmarkFolder => rec({ name, order });
  const folders = { ai: folder('AI Tools', 0), dev: folder('Development', 1), content: folder('Content Creation', 2), jobs: folder('Job Search', 3) };
  const bm = (title: string, url: string, folderId: string, workspaceId?: string): Bookmark => rec({ title, url, folderId, workspaceId, tags: [], favorite: false });
  const bookmarks: Bookmark[] = [
    bm('Claude', 'https://claude.ai/', folders.ai.id),
    bm('ChatGPT', 'https://chatgpt.com/', folders.ai.id),
    bm('GitHub', 'https://github.com/', folders.dev.id, ws.dev.id),
    bm('MDN Web Docs', 'https://developer.mozilla.org/', folders.dev.id, ws.dev.id),
    bm('Chrome Extensions docs', 'https://developer.chrome.com/docs/extensions', folders.dev.id, ws.dev.id),
    bm('YouTube Studio', 'https://studio.youtube.com/', folders.content.id, ws.content.id),
    bm('YouTube', 'https://www.youtube.com/', folders.content.id, ws.content.id),
    bm('Notion', 'https://www.notion.so/', folders.content.id),
    bm('LinkedIn Jobs', 'https://www.linkedin.com/jobs/', folders.jobs.id, ws.jobs.id),
  ];

  const ql = (title: string, url: string, order: number): QuickLink => ({ id: newId(), title, url, order });
  const quickLinks: QuickLink[] = [
    ql('GitHub', 'https://github.com/', 0),
    ql('ChatGPT', 'https://chatgpt.com/', 1),
    ql('Claude', 'https://claude.ai/', 2),
    ql('YouTube', 'https://www.youtube.com/', 3),
    ql('Google Drive', 'https://drive.google.com/', 4),
    ql('Notion', 'https://www.notion.so/', 5),
  ];

  const source: CalendarSource = rec({ name: 'Personal', kind: 'local' as const, color: '#a78bfa', enabled: true });
  // Events in the current month: spread around today but clamped to this month.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const inMonth = (n: number) => {
    const d = addDays(today, n);
    return d < monthStart ? monthStart : d > monthEnd ? monthEnd : d;
  };
  const timed = (title: string, d: Date, h: number, durMin: number, o: Partial<CalendarEvent> = {}): CalendarEvent =>
    rec({ sourceId: source.id, title, start: at(d, h).toISOString(), end: new Date(at(d, h).getTime() + durMin * 60_000).toISOString(), allDay: false, ...o });
  const events: CalendarEvent[] = [
    timed('Gym', inMonth(1), 7, 60, { recurrence: 'weekly', workspaceId: ws.personal.id }),
    timed('Content shoot', inMonth(2), 14, 120, { location: 'Home studio', workspaceId: ws.content.id, reminderMinutes: 30 }),
    timed('Job interview prep', inMonth(3), 10, 90, { workspaceId: ws.jobs.id, reminderMinutes: 60 }),
    rec({ sourceId: source.id, title: 'Project milestone: Tabspace beta', start: toDateKey(inMonth(5)), end: toDateKey(addDays(inMonth(5), 1)), allDay: true, workspaceId: ws.dev.id }),
  ];

  return { workspaces: Object.values(ws), sessions, tasks, notes, bookmarkFolders: Object.values(folders), bookmarks, quickLinks, calendarSources: [source], events };
}

export async function loadSampleData(): Promise<void> {
  if (await hasSampleData()) return;
  const d = buildSampleData();
  const pairs: [SampleKey, { id: string }[]][] = [
    ['ts.workspaces', d.workspaces],
    ['ts.sessions', d.sessions],
    ['ts.tasks', d.tasks],
    ['ts.notes', d.notes],
    ['ts.bookmarkFolders', d.bookmarkFolders],
    ['ts.bookmarks', d.bookmarks],
    ['ts.quickLinks', d.quickLinks],
    ['ts.calendarSources', d.calendarSources],
    ['ts.events', d.events],
  ];
  // Record ids first so a partial failure can still be cleaned up.
  await set('ts.sampleIds', Object.fromEntries(pairs.map(([k, items]) => [k, items.map((i) => i.id)])));
  for (const [key, items] of pairs) {
    await update(key, (list) => [...(list as { id: string }[]), ...items] as never);
  }
}

export async function removeSampleData(): Promise<void> {
  const ids = await get('ts.sampleIds');
  for (const key of SAMPLE_KEYS) {
    const drop = new Set(ids[key] ?? []);
    if (key === 'ts.events') {
      // The sample calendar source is removed, so its events go too (same rule as removing any calendar).
      const sampleSources = new Set(ids['ts.calendarSources'] ?? []);
      await update('ts.events', (list) => list.filter((e) => !drop.has(e.id) && !sampleSources.has(e.sourceId)));
      continue;
    }
    if (!drop.size) continue;
    await update(key, (list) => (list as { id: string }[]).filter((r) => !drop.has(r.id)) as never);
  }
  await set('ts.sampleIds', {});
}
