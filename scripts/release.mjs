// Bump the version everywhere, commit and tag. Pushing the tag publishes a GitHub Release.
// Usage: npm run release 2.3.1   (then: git push && git push --tags)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run release <major.minor.patch>');
  process.exit(1);
}
const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
if (status) {
  console.error('Commit or stash your changes first.');
  process.exit(1);
}
for (const file of ['package.json', 'public/manifest.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
const log = readFileSync('CHANGELOG.md', 'utf8');
if (!log.includes(`## [${version}]`)) {
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync('CHANGELOG.md', log.replace(/^## \[/m, `## [${version}] — ${date}\n\n- _Describe the changes here._\n\n## [`));
  console.log('Added a CHANGELOG entry — edit it, then re-run this command.');
  process.exit(0);
}
execSync('npm install --package-lock-only --ignore-scripts', { stdio: 'inherit' });
execSync(`git add package.json package-lock.json public/manifest.json CHANGELOG.md && git commit -m "Release v${version}" && git tag v${version}`, { stdio: 'inherit' });
console.log(`\nTagged v${version}. Publish it with:\n  git push && git push --tags`);
