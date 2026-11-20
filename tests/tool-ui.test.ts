import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (name: string) => readFileSync(join(root, 'src/components/tools', name), 'utf8');

const SHARE_AND_TOOLS = [
  'UltimateEncrypt.svelte', 'UltimateDecrypt.svelte', 'ChatCipher.svelte', 'CoverStream.svelte', 'PhotoCipher.svelte',
  'SpectralCipher.svelte', 'Steganography.svelte', 'TimeCapsule.svelte', 'PasskeyExplain.svelte',
];

test('every file dropzone of the image and audio tools accepts dropped files', () => {
  for (const name of ['PhotoCipher.svelte', 'Steganography.svelte', 'SpectralCipher.svelte']) {
    const text = read(name);
    const zones = text.match(/<div class="dropzone[^"]*"/g) ?? [];
    assert.ok(zones.length > 0, `${name} has no dropzone`);
    for (const zone of text.matchAll(/<div class="dropzone[^>]*>/g)) assert.match(zone[0], /use:dropFiles/, `${name}: ${zone[0]}`);
  }
});

test('a decrypted file is shown once, not also as a decrypted message', () => {
  assert.match(read('UltimateDecrypt.svelte'), /\{#if openedText && !openedFileName\}\s*<div class="field">\s*<div class="output-head">\s*<span class="label">\{t\(dict, 'tools\.ultimateDecrypt\.decryptedMessage'\)\}/);
});

test('the time capsule countdown is a timer, not a live region that speaks every second', () => {
  const text = read('TimeCapsule.svelte');
  assert.match(text, /role="timer">\{countdownDisplay\}/);
  assert.doesNotMatch(text, /<div class="status status--warn" role="status">/);
});

test('share and tool components format dates in the page language and keep to the type scale', () => {
  for (const name of SHARE_AND_TOOLS) {
    const text = read(name);
    assert.doesNotMatch(text.replace(/catch \{[^}]*\}/g, ''), /toLocaleString\(\)/,`${name} formats a date in the browser language instead of the page language`);
    assert.doesNotMatch(text, /\bfont-bold\b/, `${name} uses font-bold; headings and titles are font-semibold`);
    assert.doesNotMatch(text, /font-size:\s*0\.8125rem/, `${name} sets 13 px text; use text-sm`);
  }
});
