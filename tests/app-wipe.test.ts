import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANIC_FLAG, WIPE_LS_PREFIXES, WIPE_SS_KEYS, WIPE_SS_PREFIXES, wipeRoomStorage } from '../src/lib/appWipe';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const NOT_STORAGE = new Set(['encrypt.click:', 'encrypt.click:safety-v3:']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|svelte|ts)$/.test(name)) out.push(full);
  }
  return out;
}

function memoryStorage(entries: Record<string, string>): Storage {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)!).sort();
const covered = (prefix: string) => [...WIPE_LS_PREFIXES, ...WIPE_SS_PREFIXES].some((p) => prefix.startsWith(p));

test('every room-scoped storage key prefix in src is on the panic wipe list', () => {
  const prefixes = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"`](encrypt[\w.-]*:(?:[\w.-]+:)*)(?=['"`]|\$\{)/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/(?:local|session)Storage\.(?:setItem|getItem)\(\s*`([^`$]+)\$\{/g)) prefixes.add(m[1]);
  }
  assert.ok(prefixes.has('encrypt:joined:'), 'scanner finds the join stamp prefix');
  const missing = [...prefixes].filter((p) => !NOT_STORAGE.has(p) && !covered(p));
  assert.deepEqual(missing, [], 'add these to WIPE_LS_PREFIXES / WIPE_SS_PREFIXES in src/lib/appWipe.ts or to NOT_STORAGE here');
});

test('wipeRoomStorage removes room traces and keeps app preferences', () => {
  const local = memoryStorage({
    'encrypt:joined:alpha-room': '1767225600000',
    'encrypt.click:chat-trust:alpha-room': '{}',
    'encrypt.click:chat-history:v3:alpha-room:main': '[]',
    'encrypt.click:chat-last-view': '{}',
    'encrypt.click:alias:alpha-room': '{}',
    'encrypt.click:nick:alpha-room': 'ann',
    'encrypt-app-platform': 'ios',
    'encrypt-app-seed': '#5b6472',
    'chat-blur-when-away': '1',
    [PANIC_FLAG]: '1',
  });
  const session = memoryStorage({
    'chat-pw:alpha-room': 'secret',
    'wb-pw:board': 'secret',
    'encrypt-click:once:abc': '1',
    'encrypt.click:chat-draft:alpha': 'x',
    ...Object.fromEntries(WIPE_SS_KEYS.map((k) => [k, 'secret'])),
    'encrypt-app-redirect': 'install',
  });
  wipeRoomStorage(local, session);
  assert.deepEqual(keys(local), ['chat-blur-when-away', 'encrypt-app-platform', 'encrypt-app-seed', PANIC_FLAG].sort());
  assert.deepEqual(keys(session), ['encrypt-app-redirect']);
});
