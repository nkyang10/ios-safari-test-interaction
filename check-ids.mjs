// Static check: every element id referenced from app.js must exist in index.html,
// and every button/listener id in app.js wiring must exist too. Run: node check-ids.mjs
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const js = readFileSync('app.js', 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const htmlData = new Set([...html.matchAll(/\bdata-verdict="([^"]+)"/g)].map((m) => m[1]));
const dynamic = new Set(['fatal']); // created by the inline boot script

const refs = new Set();
for (const m of js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) refs.add(m[1]);
for (const m of js.matchAll(/\$\(`#\$\{[^}]+\}`\)/g)) refs.add('(dynamic)');
for (const m of js.matchAll(/verdict\('([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);
for (const m of js.matchAll(/block\('#([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);
for (const m of js.matchAll(/\$\$\('#([A-Za-z0-9_-]+)/g)) refs.add(m[1]);
for (const m of js.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) refs.add(m[1]);
for (const m of js.matchAll(/outSel = '([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);

const bad = [];
for (const r of refs) {
  if (r === '(dynamic)') continue;
  if (htmlIds.has(r) || htmlData.has(r) || dynamic.has(r)) continue;
  bad.push(r);
}

// reverse direction: ids in the html that app.js never touches (informational)
const unused = [...htmlIds].filter((id) => !refs.has(id));

console.log('html ids:', htmlIds.size, '| js refs:', refs.size);
if (bad.length) {
  console.log('MISSING IN HTML (these throw):', bad.join(', '));
  process.exitCode = 1;
} else {
  console.log('OK: every referenced id exists in index.html');
}
if (unused.length) console.log('html ids not referenced from app.js (fine):', unused.join(', '));
