import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'tmp'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(svelte|astro|ts|js|mjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = walk('src');
const used = new Set();
const re = /\bt\(\s*dict\s*,\s*['"]([^'"]+)['"]/g;
const tmpl = /\bt\(\s*dict\s*,\s*`([^`$]+(?:\$\{[^}]+\}[^`$]*)*)`/g;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = re.exec(text))) used.add(match[1]);
  while ((match = tmpl.exec(text))) {
    const raw = match[1];
    // Expand common numeric ranges used on the homepage / security pages.
    if (raw.includes('${')) {
      const base = raw.replace(/\$\{[^}]+\}/g, '*');
      used.add(`TEMPLATE:${base}`);
    } else {
      used.add(raw);
    }
  }
}

// Known dynamic expansions from templates in pages
for (let n = 1; n <= 3; n++) {
  used.add(`landing.how.${n}.title`);
  used.add(`landing.how.${n}.text`);
}
for (let n = 1; n <= 6; n++) {
  used.add(`landing.features.${n}.title`);
  used.add(`landing.features.${n}.text`);
}
for (let n = 1; n <= 4; n++) {
  used.add(`security.glance.${n}`);
}

const en = JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8'));
const missing = [...used].filter((k) => !k.startsWith('TEMPLATE:') && !(k in en)).sort();
console.log(JSON.stringify({ used: used.size, missingCount: missing.length, missing }, null, 2));
