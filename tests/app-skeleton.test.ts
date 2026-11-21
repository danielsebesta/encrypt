import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appCss = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const materialCss = readFileSync(new URL('../src/styles/app-material.css', import.meta.url), 'utf8');
const mobileApp = readFileSync(new URL('../src/components/app/MobileApp.svelte', import.meta.url), 'utf8');
const chatRoom = readFileSync(new URL('../src/components/tools/ChatRoom.svelte', import.meta.url), 'utf8');

test('app skeletons shimmer instead of blinking opacity', () => {
  assert.match(appCss, /@keyframes app-skel-shimmer/);
  assert.doesNotMatch(appCss, /app-skel-pulse/);
  assert.doesNotMatch(appCss, /\.app-skel\s*\{[^}]*animation:\s*app-skel-pulse/);
});

test('the hub skeleton mirrors navbar, search, filter and list rows', () => {
  assert.match(mobileApp, /app-skel-hub__bar/);
  assert.match(mobileApp, /app-skel--search/);
  assert.match(mobileApp, /app-skel-hub__filter/);
  assert.match(mobileApp, /app-skel-hub__list/);
  assert.match(mobileApp, /app-skel--meta/);
  assert.match(materialCss, /\.app-skel-row[\s\S]*min-height:\s*72px/);
  assert.match(materialCss, /\.app-skel--search[\s\S]*height:\s*3\.5rem/);
});

test('the chat opening skeleton mirrors the room bar and bubbles', () => {
  assert.match(chatRoom, /app-skel-chat__bar/);
  assert.match(chatRoom, /app-skel-chat__bubble/);
  assert.match(chatRoom, /app-skel-chat__row--mine/);
  assert.doesNotMatch(chatRoom, /chat-preview-skeleton::after[\s\S]*chat-spin/);
});
