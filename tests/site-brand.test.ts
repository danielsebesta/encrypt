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
  siteHello,
  siteName,
} from '../src/lib/siteBrand';
import { getTranslations } from '../src/lib/i18n';

afterEach(() => setRuntimeEnv({}));

test('SITE_NAME unset keeps Encrypt.click branding', () => {
  setRuntimeEnv({});
  assert.equal(siteName(), PRODUCT_NAME);
  assert.equal(isWhitelabeled(), false);
  assert.equal(brandText('Welcome to Encrypt.click'), 'Welcome to Encrypt.click');
  assert.equal(getTranslations('en')['meta.defaultTitle'], 'Encrypt.click | Encrypt files and messages in your browser');
});

test('default contacts on the official brand', () => {
  setRuntimeEnv({});
  assert.equal(siteContact(), 'security@encrypt.click');
  assert.equal(siteHello(), 'hello@encrypt.click');
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
  assert.equal(siteHello(), 'hello@vault.example.com');
  assert.equal(brandText('Open on encrypt.click/u'), 'Open on vault.example.com/u');
  assert.equal(brandText('security@encrypt.click and l.encrypt.click'), 'sec@example.com and s.example.com');
  assert.equal(brandText('hello@encrypt.click'), 'hello@vault.example.com');
  assert.equal(brandText("encrypt.click's server"), "Acme Vault's server");

  const html = brandHtml(
    `<span>${PRODUCT_NAME}</span>` +
      `<title>Security | Encrypt.click</title>` +
      `<script>const k="encrypt.click/chat/v3"; const s="encrypt.click:alias:";</script>` +
      `<a href="https://encrypt.click/u">go</a>`,
  );
  assert.match(html, new RegExp(`<span>${PRODUCT_NAME}</span>`));
  assert.match(html, /<title>Security \| Acme Vault<\/title>/);
  assert.match(html, /encrypt\.click\/chat\/v3/);
  assert.match(html, /encrypt\.click:alias:/);
  assert.match(html, /https:\/\/vault\.example\.com\/u/);
  assert.equal(getTranslations('en')['meta.defaultTitle'], 'Acme Vault | Encrypt files and messages in your browser');
});

test('applySiteBrand rewrites HTML responses only when whitelabeled', async () => {
  setRuntimeEnv({ SITE_NAME: 'Ops Privacy', PUBLIC_URL: 'https://privacy.ops.test' });
  const plain = await applySiteBrand(new Response('<span>Encrypt.click</span> Hi Encrypt.click', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  assert.equal(await plain.text(), '<span>Encrypt.click</span> Hi Ops Privacy');

  setRuntimeEnv({});
  const untouched = await applySiteBrand(new Response('Hi Encrypt.click', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  assert.equal(await untouched.text(), 'Hi Encrypt.click');
});

test('rejects unsafe SITE_NAME values', () => {
  setRuntimeEnv({ SITE_NAME: '<script>x</script>' });
  assert.equal(siteName(), PRODUCT_NAME);
  setRuntimeEnv({ SITE_NAME: 'a'.repeat(80) });
  assert.equal(siteName(), PRODUCT_NAME);
});
