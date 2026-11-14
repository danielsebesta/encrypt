import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PATHS, buildSitemapXml } from '../src/lib/sitemap';

test('sitemap lists each public page once, without language prefixes', () => {
  const xml = buildSitemapXml('https://encrypt.click');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);

  for (const path of SITEMAP_PATHS) {
    assert.match(xml, new RegExp(`<loc>https://encrypt\.click${path === '/' ? '/' : path.replaceAll('/', '\/')}</loc>`));
  }

  assert.doesNotMatch(xml, /hreflang/);
  assert.doesNotMatch(xml, /\/(cs|de|es|fr|sk|pl)\//);
  assert.doesNotMatch(xml, /\/privacy/);
  assert.doesNotMatch(xml, /\/preview/);
  assert.doesNotMatch(xml, /\/aes-words/);
  assert.equal((xml.match(/<url>/g) ?? []).length, SITEMAP_PATHS.length);
});
