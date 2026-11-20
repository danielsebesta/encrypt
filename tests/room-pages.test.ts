import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOCALES = ['cs', 'de', 'es', 'fr', 'pl', 'sk'];
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

for (const room of ['chat', 'whiteboard']) {
  test(`localized ${room} room pages are thin wrappers around the default page`, () => {
    const wrapper = `---\nimport Room from '../../${room}/[id].astro';\n\nexport const prerender = false;\n---\n\n<Room />\n`;
    for (const locale of LOCALES) assert.equal(read(`src/pages/${locale}/${room}/[id].astro`), wrapper, `${locale} ${room} room page drifted`);
  });
}
