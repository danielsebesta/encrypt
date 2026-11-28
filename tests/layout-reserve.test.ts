import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tabs = readFileSync(new URL('../src/components/ui/Tabs.svelte', import.meta.url), 'utf8');
const quickStart = readFileSync(new URL('../src/components/home/HomeQuickStart.svelte', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const indexPage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const installGuide = readFileSync(new URL('../src/components/InstallGuide.svelte', import.meta.url), 'utf8');

test('Tabs seeds visited with the active value so SSR paints the panel', () => {
  assert.match(tabs, /visited = \$state<Partial<Record<T, boolean>>>\(\{ \[value\]: true \}/);
  assert.match(tabs, /\$effect\.pre\(\(\) => \{[\s\S]*visited\[value\]/);
});

test('HomeQuickStart reserves a pending shell while chat/whiteboard chunks load', () => {
  assert.match(quickStart, /home-quickstart-pending/);
  assert.match(quickStart, /aria-busy="true"/);
  assert.match(globalCss, /\.home-quickstart-pending\s*\{[^}]*min-height:\s*20rem/);
  assert.match(globalCss, /\.home-hero__form\s*\{[^}]*min-height:\s*28rem/);
});

test('landing page keeps the hero, use cases, lean app teaser and tools', () => {
  assert.match(indexPage, /home-hero/);
  assert.match(indexPage, /HomeQuickStart/);
  assert.match(indexPage, /home-uses/);
  assert.match(indexPage, /AppShowcase/);
  assert.match(indexPage, /home-app__showcase/);
  assert.match(indexPage, /home-tools/);
  assert.doesNotMatch(indexPage, /HomeBento|HomeTools|AppQr|home-trust|home-app__card/);
});

test('Install guide reserves a shell before device detection', () => {
  assert.match(installGuide, /install-now--pending/);
  assert.match(installGuide, /device === 'desktop'[\s\S]*install-now__qr[\s\S]*aria-busy=\{!qrSvg\}/);
  assert.match(globalCss, /\.install-now--pending\s*\{[^}]*min-height:\s*16rem/);
  assert.match(globalCss, /\.share-form\s*\{[^}]*min-height:\s*26rem/);
});
