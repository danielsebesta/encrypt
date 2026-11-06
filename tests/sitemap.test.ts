import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITEMAP_PATHS, buildSitemapXml } from '../src/lib/sitemap';

test('sitemap lists core pages for every locale with hreflang', () => {
  const xml = buildSitemapXml('https://encrypt.click');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);

  for (const path of SITEMAP_PATHS) {
    if (path === '/') {
      assert.match(xml, /<loc>https:\/\/encrypt\.click\/<\/loc>/);
      assert.match(xml, /<loc>https:\/\/encrypt\.click\/cs\/<\/loc>/);
    } else {
      assert.match(xml, new RegExp(`<loc>https://encrypt\\.click${path.replaceAll('/', '\\/')}</loc>`));
      assert.match(xml, new RegExp(`<loc>https://encrypt\\.click/cs${path.replaceAll('/', '\\/')}</loc>`));
    }
  }

  assert.match(xml, /hreflang="x-default"/);
  assert.match(xml, /hreflang="pl"/);
  assert.doesNotMatch(xml, /\/privacy/);
  assert.doesNotMatch(xml, /\/preview/);
  assert.doesNotMatch(xml, /\/aes-words/);
  assert.equal((xml.match(/<url>/g) ?? []).length, SITEMAP_PATHS.length * 7);
});
