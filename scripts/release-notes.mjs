// Prints the CHANGELOG section for a version (used as GitHub Release notes).
// Usage: node scripts/release-notes.mjs 2.3.0
import { readFileSync } from 'node:fs';

const version = process.argv[2];
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const start = log.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}[^\\]]*\\]`, 'm'));
if (start === -1) {
  console.log(`Tabspace ${version}`);
  process.exit(0);
}
const rest = log.slice(start).split('\n');
const end = rest.findIndex((line, i) => i > 0 && line.startsWith('## ['));
const body = rest.slice(1, end === -1 ? undefined : end).join('\n').trim();
console.log(`${body}

---
**Install or update:** download \`tabspace-extension-v${version}.zip\` below, unzip it over your Tabspace folder, then open \`chrome://extensions\` and click ↻ on Tabspace (or use *Reload Tabspace* in the update banner). Your data stays as it is.`);
