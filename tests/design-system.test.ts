import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BUTTON_MODIFIERS, BUTTON_VARIANTS } from '../src/components/ui/button';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const css = readFileSync(join(root, 'src/styles/global.css'), 'utf8');

/** The /app PWA renders Konsta UI and is styled by src/styles/app.css; it has its own rules. */
const OUT_OF_SCOPE = ['src/components/app/', 'src/pages/app/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|astro)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ['src/components', 'src/pages', 'src/layouts']
  .flatMap((dir) => walk(join(root, dir)))
  .map((full) => ({ path: relative(root, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))
  .filter((file) => !OUT_OF_SCOPE.some((prefix) => file.path.startsWith(prefix)));

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Reads an opening tag up to its closing `>`, skipping `>` inside quotes and `{…}` expressions. */
function readTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function classValue(tag: string): string | null {
  const m = tag.match(/\sclass=("[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})/);
  return m ? m[1] : null;
}

/* ── Colour literals ─────────────────────────────────────── */

const COLOUR = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const TAILWIND_PALETTE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|outline|decoration|divide|placeholder|accent|caret|shadow|from|via|to)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?![\w-])/g;

/** Literal colours that cannot come from tokens. Every entry names the exact literal and why. */
const COLOUR_ALLOW: Record<string, { literals: string[]; why: string }> = {
  'src/components/tools/EmojiPicker.svelte': {
    literals: ['#ffc93a', '#f7d7c4', '#e5b48f', '#c68e62', '#9e6a43', '#5c4033'],
    why: 'skin-tone swatches show the Unicode Fitzpatrick tones themselves, they are content, not chrome',
  },
  'src/components/tools/PhotoCipher.svelte': {
    literals: ['#ffffff'],
    why: 'transparent pixels are flattened onto white before encoding; it is part of the image data, not a theme colour',
  },
  'src/components/tools/Whiteboard.svelte': {
    literals: ['rgba(', '#ffffff'],
    why: "rgba( compares a computed style with 'rgba(0, 0, 0, 0)'; #ffffff is --wb-on-peer, text on the fixed alias colours from src/lib/alias.ts (pending a token, see docs/design-system.md)",
  },
};

test('no hardcoded colours in components, pages and layouts', () => {
  const problems: string[] = [];
  for (const file of files) {
    const allow = COLOUR_ALLOW[file.path]?.literals ?? [];
    let text = file.text;
    if (file.path === 'src/layouts/Layout.astro') text = text.replace(/<meta name="theme-color"[^>]*>/g, '');
    for (const m of text.matchAll(COLOUR)) {
      if (allow.includes(m[0].toLowerCase()) || allow.includes(m[0])) continue;
      problems.push(`${file.path}:${lineOf(text, m.index!)} ${m[0]}`);
    }
    for (const m of text.matchAll(TAILWIND_PALETTE)) problems.push(`${file.path}:${lineOf(text, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(problems, [], 'use a token from src/styles/global.css (var(--…) or its Tailwind utility) instead of a colour literal');
});

test('colour allowlist entries are still needed', () => {
  for (const [path, { literals }] of Object.entries(COLOUR_ALLOW)) {
    const file = files.find((f) => f.path === path);
    assert.ok(file, `${path} no longer exists; drop it from COLOUR_ALLOW`);
    for (const literal of literals) assert.ok(file.text.includes(literal), `${path} no longer contains ${literal}; drop it from COLOUR_ALLOW`);
  }
});

test('theme-color meta tags match the --bg token of each theme', () => {
  const layout = files.find((f) => f.path === 'src/layouts/Layout.astro')!.text;
  const token = (scope: string) => css.slice(css.indexOf(scope)).match(/--bg:\s*(#[0-9a-f]{6})/i)![1];
  assert.match(layout, new RegExp(`theme-color" content="${token(':root {')}" media="\\(prefers-color-scheme: light\\)"`));
  assert.match(layout, new RegExp(`theme-color" content="${token('html.dark {')}" media="\\(prefers-color-scheme: dark\\)"`));
});

/* ── Buttons ─────────────────────────────────────────────── */

const VARIANTS: readonly string[] = BUTTON_VARIANTS;
const MODIFIERS: readonly string[] = BUTTON_MODIFIERS;
/** Other canonical control classes a `<button>` may carry instead of a button variant. */
const CONTROL_CLASSES = ['menu__item', 'chip', 'tab', 'nav__link', 'dropzone'];
const CANONICAL = [...VARIANTS, ...CONTROL_CLASSES];
/** Internal parts of CopyButton / ShareLinkButton feedback animation, not button styles. */
const BTN_INTERNAL = /^btn-feedback(?:__|--|$)/;

/** Primitives whose class comes from buttonClass() or a prop; their callers are checked instead. */
const COMPUTED_CLASS: Record<string, string> = {
  'src/components/ui/Button.svelte': 'class={cls} from buttonClass()',
  'src/components/ui/Menu.svelte': 'trigger class from buttonClass()',
  'src/components/ui/Tabs.svelte': 'renders class="tab"',
  'src/components/CopyButton.svelte': "baseClass is 'btn' or 'btn-ghost btn-sm'",
  'src/components/ShareLinkButton.svelte': "className defaults to 'btn-ghost btn-sm'; callers pass a canonical variant",
};

/**
 * One-off button classes that predate the design system. Wave-1 migration removes them file by file
 * (see docs/design-system.md, "Migration"). Do not add entries; remove them as files migrate.
 */
const PENDING: Record<string, string[]> = {
  'src/components/tools/ChatCall.svelte': ['call-mini__main', 'call-mini__btn', 'call__top-btn', 'call__expand', 'call__btn', 'chat-call-fullscreen__close'],
  'src/components/tools/ChatRoom.svelte': [
    'chat-me-pill', 'chat-react-btn', 'app-incoming__btn', 'chat-call-accept', 'chat-call-decline', 'chat-key-warn', 'chat-once-reveal',
    'chat-file__dl', 'chat-whiteboard-card__btn', 'chat-preview-img-btn', 'chat-preview-expand', 'chat-kmsg-actions__btn', 'chat-kmsg-pending',
    'chat-send-state', 'chat-jump-latest', 'chat-lightbox__close',
  ],
  'src/components/tools/ChatVoiceMessage.svelte': ['voice-msg__rate'],
  'src/components/tools/ChatVoiceRecorder.svelte': ['voice-rec-app__cancel', 'voice-rec-app__send'],
  'src/components/tools/EmojiPicker.svelte': ['ep__cell', 'ep__swatch', 'ep__clear', 'ep__tone-toggle', 'ep__tab'],
  'src/components/tools/RoomInviteCard.svelte': ['invite-card__copy'],
  'src/components/tools/Whiteboard.svelte': ['wb-btn', 'wb-color', 'wb-key-warn', 'wb-people-trigger'],
};

/** Markup written into another document (the call Picture-in-Picture window), where global.css does not exist. */
const FOREIGN_DOCUMENT = { path: 'src/components/tools/ChatRoom.svelte', marker: 'd.body.innerHTML = `' };

function buttons() {
  const out: { path: string; line: number; tag: string; cls: string | null }[] = [];
  for (const file of files) {
    const lines = file.text.split('\n');
    for (const m of file.text.matchAll(/<button\b/g)) {
      const line = lines[lineOf(file.text, m.index!) - 1];
      if (file.path === FOREIGN_DOCUMENT.path && line.includes(FOREIGN_DOCUMENT.marker)) continue;
      const tag = readTag(file.text, m.index!);
      out.push({ path: file.path, line: lineOf(file.text, m.index!), tag, cls: classValue(tag) });
    }
  }
  return out;
}

const literalsOf = (cls: string) => (cls.startsWith('"') ? [cls.slice(1, -1)] : [...cls.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]));
const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

test('every <button> uses a canonical class or a primitive', () => {
  const problems: string[] = [];
  for (const b of buttons()) {
    if (COMPUTED_CLASS[b.path]) continue;
    const cls = b.cls ?? '';
    const words = literalsOf(cls).flatMap(tokens);
    if (words.some((w) => CANONICAL.includes(w))) continue;
    if (cls.includes('buttonClass(')) continue;
    const pending = PENDING[b.path] ?? [];
    if (pending.some((p) => (p.startsWith('{') ? cls === p : words.includes(p)))) continue;
    problems.push(`${b.path}:${b.line} class=${cls || '(none)'}`);
  }
  assert.deepEqual(problems, [], `use .btn / .btn-secondary / .btn-ghost / .btn-danger / .btn-link (+ .btn-sm, .btn-icon, .btn-block), ${CONTROL_CLASSES.join(', ')} or src/components/ui/Button.svelte`);
});

test('pending one-off button classes still exist (remove migrated entries)', () => {
  for (const [path, classes] of Object.entries(PENDING)) {
    const file = files.find((f) => f.path === path);
    assert.ok(file, `${path} no longer exists; drop it from PENDING`);
    for (const cls of classes) assert.ok(file.text.includes(cls), `${path} no longer uses ${cls}; drop it from PENDING`);
  }
});

test('btn-* classes are canonical, with exactly one variant', () => {
  const problems: string[] = [];
  for (const file of files) {
    for (const m of file.text.matchAll(/(["'`])([^"'`\n]*)\1/g)) {
      const words = tokens(m[2]);
      const btn = words.filter((w) => /^btn(-|$)/.test(w) && !BTN_INTERNAL.test(w));
      if (!btn.length) continue;
      const where = `${file.path}:${lineOf(file.text, m.index!)}`;
      for (const w of btn) if (!VARIANTS.includes(w) && !MODIFIERS.includes(w)) problems.push(`${where} unknown ${w}`);
      const variants = btn.filter((w) => VARIANTS.includes(w));
      if (variants.length > 1) problems.push(`${where} several variants: ${variants.join(' ')}`);
      if (!variants.length && btn.some((w) => MODIFIERS.includes(w)) && !/^\s|\s$/.test(m[2])) problems.push(`${where} modifier without a variant: ${m[2]}`);
      if (variants.length && words.includes('w-full')) problems.push(`${where} use btn-block instead of w-full`);
    }
    for (const m of file.text.matchAll(/\.(btn-[a-z][a-z0-9-]*)/g)) {
      if (!VARIANTS.includes(m[1]) && !MODIFIERS.includes(m[1]) && !BTN_INTERNAL.test(m[1])) problems.push(`${file.path}:${lineOf(file.text, m.index!)} styles unknown .${m[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('global.css defines exactly the canonical button classes', () => {
  const defined = new Set([...css.matchAll(/\.(btn(?:-[a-z][a-z0-9-]*)?)(?![\w-])/g)].map((m) => m[1]).filter((c) => !BTN_INTERNAL.test(c)));
  assert.deepEqual([...defined].sort(), [...VARIANTS, ...MODIFIERS].sort());
});

test('icon-only buttons have an accessible name', () => {
  const problems: string[] = [];
  for (const b of buttons()) {
    if (!b.cls || !literalsOf(b.cls).flatMap(tokens).includes('btn-icon')) continue;
    if (!/\saria-label(ledby)?=/.test(b.tag)) problems.push(`${b.path}:${b.line}`);
  }
  for (const file of files) {
    for (const m of file.text.matchAll(/<Button\b/g)) {
      const tag = readTag(file.text, m.index!);
      if (tag.endsWith('/>') && !/\slabel=/.test(tag)) problems.push(`${file.path}:${lineOf(file.text, m.index!)} <Button/> without label`);
    }
  }
  assert.deepEqual(problems, [], 'icon-only buttons need aria-label (or label= on <Button>)');
});

/* ── Sizes and states ────────────────────────────────────── */

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector} in global.css`);
  return css.slice(start, css.indexOf('}', start));
}

test('button sizes: 40 px default, 32 px small, 44 px on coarse pointers', () => {
  assert.match(rule('    .btn,\n    .btn-secondary,\n    .btn-ghost,\n    .btn-danger,\n    .btn-link'), /min-h-10[\s\S]*rounded-md[\s\S]*text-sm font-medium/);
  assert.match(rule('    .btn-sm'), /min-h-8/);
  assert.match(rule('    .btn-icon'), /w-10/);
  assert.match(rule('    .btn-icon.btn-sm'), /w-8/);
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)', css.indexOf('.btn-block')));
  assert.match(coarse.slice(0, 400), /\.btn-sm \{\s*@apply min-h-11/);
  assert.match(coarse.slice(0, 400), /\.btn-icon\.btn-sm \{\s*@apply w-11/);
});

test('busy, disabled, pressed and forced-colors states exist for buttons', () => {
  assert.match(css, /\[aria-busy="true"\]::after/);
  assert.match(css, /:is\(:disabled, \[aria-disabled="true"\]\)/);
  assert.match(css, /\[aria-pressed="true"\]/);
  const forced = css.slice(css.indexOf('@media (forced-colors: active)', css.indexOf('.spinner')));
  assert.match(forced.slice(0, 300), /ButtonText/);
});

test('one class per pattern: badge, chip, toast, field-error, progress, empty, panel', () => {
  for (const selector of ['.badge', '.chip', '.toast', '.field-error', '.progress', '.empty', '.panel', '.spinner', '.menu__item', '.tab']) {
    assert.ok(new RegExp(`\\${selector}\\s*\\{`).test(css), `${selector} missing from global.css`);
  }
  for (const legacy of ['.btn-outline', '.btn-lg', '.tab-btn', '.tab-bar', '.result-box', '.error-box', '.status__bar', '.card {']) {
    assert.ok(!css.includes(legacy), `legacy ${legacy} is back in global.css`);
  }
});
