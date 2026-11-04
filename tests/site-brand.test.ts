import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setRuntimeEnv } from '../src/platform/env';
import {
  PRODUCT_NAME,
  applySiteBrand,
  brandHtml,
  brandText,
  isWhitelabeled,
  siteContact,
  siteName,
} from '../src/lib/siteBrand';
import { getTranslations } from '../src/lib/i18n';

afterEach(() => setRuntimeEnv({}));

test('SITE_NAME unset keeps encrypt.click branding', () => {
  setRuntimeEnv({});
  assert.equal(siteName(), PRODUCT_NAME);
  assert.equal(isWhitelabeled(), false);
  assert.equal(brandText('Welcome to encrypt.click'), 'Welcome to encrypt.click');
  assert.equal(getTranslations('en')['meta.defaultTitle'], 'encrypt.click - Your privacy toolkit');
});

test('SITE_NAME rewrites UI copy but not protocol labels in HTML', () => {
  setRuntimeEnv({
    SITE_NAME: 'Acme Vault',
    PUBLIC_URL: 'https://vault.example.com',
    SITE_CONTACT_EMAIL: 'sec@example.com',
    SHORTENER_URL: 'https://s.example.com/rest/v1/short-urls',
  });
  assert.equal(siteName(), 'Acme Vault');
  assert.equal(isWhitelabeled(), true);
  assert.equal(siteContact(), 'sec@example.com');
  assert.equal(brandText('Open on encrypt.click/u'), 'Open on vault.example.com/u');
  assert.equal(brandText('mail@encrypt.click and l.encrypt.click'), 'sec@example.com and s.example.com');
  assert.equal(brandText("encrypt.click's server"), "Acme Vault's server");

  const html = brandHtml(
    `<span>${PRODUCT_NAME}</span>` +
      `<title>Security - encrypt.click</title>` +
      `<script>const k="encrypt.click/chat/v3"; const s="encrypt.click:alias:";</script>` +
      `<a href="https://encrypt.click/u">go</a>`,
  );
  assert.match(html, new RegExp(`<span>${PRODUCT_NAME}</span>`));
  assert.match(html, /<title>Security - Acme Vault<\/title>/);
  assert.match(html, /encrypt\.click\/chat\/v3/);
  assert.match(html, /encrypt\.click:alias:/);
  assert.match(html, /https:\/\/vault\.example\.com\/u/);
  assert.equal(getTranslations('en')['meta.defaultTitle'], 'Acme Vault - Your privacy toolkit');
});

test('applySiteBrand rewrites HTML responses only when whitelabeled', async () => {
  setRuntimeEnv({ SITE_NAME: 'Ops Privacy', PUBLIC_URL: 'https://privacy.ops.test' });
  const plain = await applySiteBrand(new Response('<span>encrypt.click</span> Hi encrypt.click', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  assert.equal(await plain.text(), '<span>encrypt.click</span> Hi Ops Privacy');

  setRuntimeEnv({});
  const untouched = await applySiteBrand(new Response('Hi encrypt.click', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  assert.equal(await untouched.text(), 'Hi encrypt.click');
});

test('rejects unsafe SITE_NAME values', () => {
  setRuntimeEnv({ SITE_NAME: '<script>x</script>' });
  assert.equal(siteName(), PRODUCT_NAME);
  setRuntimeEnv({ SITE_NAME: 'a'.repeat(80) });
  assert.equal(siteName(), PRODUCT_NAME);
});
