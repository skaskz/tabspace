// Follow-up: notes editor typing latency + side panel section switch with large data.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, loadExampleData, SHOTS } from './harness.mjs';

const { ctx, worker, url } = await launch();
await loadExampleData(ctx, url);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
async function typing(page, loc, text) {
  await loc.click();
  const per = [];
  for (const ch of text) { const a = Date.now(); await page.keyboard.type(ch); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r)))); per.push(Date.now() - a); }
  return { median: med(per), max: Math.max(...per) };
}
async function editorTyping() {
  const page = await ctx.newPage();
  await page.goto(url('dashboard.html#/notes'));
  await page.waitForTimeout(1200);
  await page.locator('main').getByText(/YouTube content ideas|^Note \d+/).first().click();
  await page.waitForTimeout(500);
  const editCtl = page.locator('main').getByText('Edit', { exact: true }).first();
  if (await editCtl.count()) await editCtl.click();
  await page.waitForTimeout(300);
  const ta = page.locator('main textarea').first();
  const info = { textareas: await ta.count(), roles: await page.evaluate(() => [...document.querySelectorAll('main [role]')].map((e) => e.getAttribute('role')).filter((r, i, a) => a.indexOf(r) === i)) };
  if (info.textareas) Object.assign(info, await typing(page, ta, 'hello world typing test'));
  await page.close();
  return info;
}
const res = { small: await editorTyping() };
await worker.evaluate(async () => {
  const now = Date.now();
  const w = (n) => Array.from({ length: n }, (_, i) => ['alpha', 'roblox', 'focus', 'deploy', 'notes'][i % 5]).join(' ');
  const cur = await chrome.storage.local.get(['ts.bookmarks', 'ts.notes', 'ts.tasks']);
  const id = () => crypto.randomUUID();
  await chrome.storage.local.set({
    'ts.bookmarks': [...cur['ts.bookmarks'], ...Array.from({ length: 2000 }, (_, i) => ({ id: id(), createdAt: now - i, updatedAt: now - i, url: `https://s${i}.example.com/`, title: `Bookmark ${i}`, tags: [], favorite: false }))],
    'ts.notes': [...cur['ts.notes'], ...Array.from({ length: 1000 }, (_, i) => ({ id: id(), createdAt: now - i, updatedAt: now - i, title: `Note ${i}`, content: `# Note ${i}\n\n${w(300)}`, tags: [], favorite: false }))],
    'ts.tasks': [...cur['ts.tasks'], ...Array.from({ length: 1000 }, (_, i) => ({ id: id(), createdAt: now - i, updatedAt: now - i, title: `Task ${i}`, done: false, priority: 'none', subtasks: [], order: 100 + i }))],
  });
});
res.large = await editorTyping();
{
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(url('sidepanel.html'));
  await page.waitForTimeout(1000);
  res.sidepanel = {};
  for (const label of ['Tasks', 'Notes', 'Bookmarks', 'Workspaces']) {
    const tab = page.getByRole('tab', { name: label }).first();
    const a = Date.now();
    await tab.click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
    res.sidepanel[label] = { switchMs: Date.now() - a, nodes: await page.evaluate(() => document.querySelectorAll('*').length) };
    await page.screenshot({ path: join(SHOTS, `sidepanel-360-${label.toLowerCase()}-large.png`) });
  }
  // Rail keyboard: arrow keys between tabs
  await page.getByRole('tab', { name: 'Tasks' }).focus();
  await page.keyboard.press('ArrowDown');
  res.sidepanel.arrowDownFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.close();
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(join(SHOTS, '_perf-followup.json'), JSON.stringify(res, null, 2));
await ctx.close();
