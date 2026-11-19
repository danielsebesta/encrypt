import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOCALES = ['cs', 'de', 'es', 'fr', 'pl', 'sk'];
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('localized whiteboard room pages match the default page apart from import depth', () => {
  const canonical = read('src/pages/whiteboard/[id].astro').replace(/'\.\.\/\.\.\//g, "'../../../");
  for (const locale of LOCALES) assert.equal(read(`src/pages/${locale}/whiteboard/[id].astro`), canonical, `${locale} whiteboard room page drifted`);
});
