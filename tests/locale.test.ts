import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLocale, localeFromCookie, localeInPath, localeResponse, localizedRequest, languageChoiceHref } from '../src/lib/locale';

const page = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://encrypt.click${path}`, { method, headers: { Accept: 'text/html,*/*;q=0.8', ...headers } });

test('Accept-Language picks the best supported language by weight', () => {
  assert.equal(pickLocale('cs-CZ,cs;q=0.9,en;q=0.8'), 'cs');
  assert.equal(pickLocale('en-US,en;q=0.9,de;q=0.8'), 'en');
  assert.equal(pickLocale('fr;q=0.5,de;q=0.9'), 'de');
  assert.equal(pickLocale('ja,zh;q=0.8'), 'en');
  assert.equal(pickLocale('sk-SK'), 'sk');
  assert.equal(pickLocale(''), 'en');
  assert.equal(pickLocale(null), 'en');
  assert.equal(pickLocale('de;q=0,cs;q=0.1'), 'cs');
});

test('cookie and path readers only accept supported codes', () => {
  assert.equal(localeFromCookie('theme=dark; ec-lang=pl'), 'pl');
  assert.equal(localeFromCookie('ec-lang=xx'), null);
  assert.equal(localeFromCookie(null), null);
  assert.equal(localeInPath('/cs/tools/chat-cipher'), 'cs');
  assert.equal(localeInPath('/tools/chat-cipher'), null);
  assert.equal(localeInPath('/'), null);
});

test('unprefixed pages are rendered in the browser language without changing the address', () => {
  assert.equal(localeResponse(page('/', { 'Accept-Language': 'cs-CZ,cs;q=0.9' })), null);
  assert.equal(localizedRequest(page('/', { 'Accept-Language': 'cs-CZ,cs;q=0.9' }))?.url, 'https://encrypt.click/cs/');
  assert.equal(localizedRequest(page('/tools/time-capsule?x=1', { 'Accept-Language': 'de' }))?.url, 'https://encrypt.click/de/tools/time-capsule?x=1');
});

test('English browsers and English cookies are served the unprefixed page as it is', () => {
  assert.equal(localizedRequest(page('/', { 'Accept-Language': 'en-GB' })), null);
  assert.equal(localizedRequest(page('/share', { 'Accept-Language': 'cs', Cookie: 'ec-lang=en' })), null);
  assert.equal(localizedRequest(page('/')), null);
});

test('a stored choice wins over the browser language', () => {
  assert.equal(localizedRequest(page('/u', { 'Accept-Language': 'cs', Cookie: 'ec-lang=fr' }))?.url, 'https://encrypt.click/fr/u');
});

test('pages under a language prefix redirect permanently to the same path without it', () => {
  const res = localeResponse(page('/cs/chat/room-1?x=1', { 'Accept-Language': 'de' }));
  assert.equal(res?.status, 301);
  assert.equal(res?.headers.get('Location'), 'https://encrypt.click/chat/room-1?x=1');
  assert.equal(localeResponse(page('/pl'))?.headers.get('Location'), 'https://encrypt.click/');
  assert.equal(localeResponse(page('/de/'))?.headers.get('Location'), 'https://encrypt.click/');
});

test('assets, APIs and non-GET requests are left alone', () => {
  for (const path of ['/_astro/x.css', '/og.png', '/api/turn', '/cs/_astro/x.css']) {
    assert.equal(localeResponse(page(path, { 'Accept-Language': 'cs' })), null);
    assert.equal(localizedRequest(page(path, { 'Accept-Language': 'cs' })), null);
  }
  assert.equal(localizedRequest(page('/share', { 'Accept-Language': 'cs' }, 'POST')), null);
  assert.equal(localeResponse(page('/cs/share', { 'Accept-Language': 'cs' }, 'POST')), null);
  assert.equal(localizedRequest(new Request('https://encrypt.click/', { headers: { Accept: 'application/json', 'Accept-Language': 'cs' } })), null);
});

test('the choice endpoint sets the cookie and continues to a same-origin path only', () => {
  assert.equal(languageChoiceHref('de', '/de/tools/chat-cipher'), '/_lang/de?to=%2Fde%2Ftools%2Fchat-cipher');
  const res = localeResponse(page('/_lang/de?to=%2Fde%2Ftools%2Fchat-cipher'));
  assert.equal(res?.status, 303);
  assert.equal(res?.headers.get('Location'), 'https://encrypt.click/de/tools/chat-cipher');
  assert.match(res?.headers.get('Set-Cookie') ?? '', /^ec-lang=de; Path=\/; Max-Age=\d+; SameSite=Lax; Secure; HttpOnly$/);
  const open = localeResponse(page('/_lang/de?to=https%3A%2F%2Fevil.example%2F'));
  assert.equal(open?.headers.get('Location'), 'https://encrypt.click/');
  const scheme = localeResponse(page('/_lang/de?to=%2F%2Fevil.example'));
  assert.equal(scheme?.headers.get('Location'), 'https://encrypt.click/');
  assert.equal(localeResponse(page('/_lang/xx?to=%2F'))?.status, 404);
});
