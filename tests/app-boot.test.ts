import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../src/pages/app/index.astro', import.meta.url), 'utf8');
const boot = page.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1] ?? '';

function run(pathname: string, { mobile = true, installed = false } = {}) {
  const replaced: string[] = [];
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  runInNewContext(boot, {
    navigator: { userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' : 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: mobile ? 5 : 0, standalone: installed },
    matchMedia: (query: string) => ({ matches: installed && query.includes('standalone') }),
    location: { pathname, search: '', hash: '', replace: (url: string) => replaced.push(url) },
    document: { documentElement: { lang: 'en', style: {}, dataset: {}, setAttribute() {}, classList: { add() {}, toggle() {} } } },
    sessionStorage: storage,
    localStorage: storage,
    window: {},
    URLSearchParams,
  });
  return replaced;
}

test('the /app boot script sends a mobile browser tab to the website', () => {
  assert.ok(boot.length > 0);
  assert.deepEqual(run('/app'), ['/']);
  assert.deepEqual(run('/app', { mobile: false }), ['/install']);
});

test('the /app boot script stays put when the installed app opens', () => {
  assert.deepEqual(run('/app', { installed: true }), []);
});

test('the /app shell served offline for another page does not redirect again', () => {
  assert.deepEqual(run('/'), []);
  assert.deepEqual(run('/install', { mobile: false }), []);
});
