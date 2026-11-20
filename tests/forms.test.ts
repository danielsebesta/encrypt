import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.svelte')) out.push(full);
  }
  return out;
}

const components = walk(join(root, 'src/components')).map((full) => ({
  path: relative(root, full).split(sep).join('/'),
  text: readFileSync(full, 'utf8'),
}));

test('every form that creates a password shows the live PasswordChecklist', () => {
  const creators = components.filter((file) => /<PassphraseField\b/.test(file.text));
  assert.ok(creators.length >= 7, 'expected the share form, both room wizards and the four tools');
  for (const file of creators) {
    assert.match(file.text, /<PasswordChecklist\b/, `${file.path} lets people choose a password without the checklist`);
    for (const tag of file.text.match(/<PasswordChecklist\b[^>]*\/>/g) ?? []) {
      assert.match(tag, /\binvalid=\{/, `${file.path}: the checklist must turn unmet rules danger after a refused submit`);
      assert.match(tag, /\{dict\}/, `${file.path}: the checklist needs dict for the met / not met state`);
    }
  }
  const app = read('src/components/app/MobileApp.svelte');
  assert.match(app, /<PasswordChecklist id="app-new-pw-rules"[^>]*invalid=\{newPwInvalid\}/, '/app new room shows the checklist');
  assert.match(app, /aria-describedby=\{newPwInvalid \? 'app-new-pw-error app-new-pw-rules' : 'app-new-pw-rules'\}/);
  const board = read('src/components/tools/Whiteboard.svelte');
  assert.match(board, /<PasswordChecklist id="wb-backup-rules"/, 'encrypted board export shows whether both passwords match');
});

test('a password checklist names each rule state in its text, without a live region', () => {
  const list = read('src/components/PasswordChecklist.svelte');
  assert.match(list, /common\.rule\.met/);
  assert.match(list, /common\.rule\.unmet/);
  assert.match(list, /common\.rule\.recommended/);
  assert.doesNotMatch(list, /aria-live|role="(?:status|alert)"/);
  assert.match(list, /rule\.ok \? 'check' : failed \? 'x' : 'circle'/);
  assert.match(list, /invalid && !rule\.ok && !rule\.recommended/, 'advice never turns danger');
});

test('rules a form does not enforce are marked recommended, enforced ones are not', () => {
  const share = read('src/components/tools/UltimateEncrypt.svelte');
  assert.doesNotMatch(share, /recommended: true/, 'the share form refuses weak passwords, so every rule is required');
  for (const path of ['ChatCreate', 'WhiteboardCreate', 'ChatCipher', 'PhotoCipher', 'Steganography', 'TimeCapsule'].map((n) => `src/components/tools/${n}.svelte`)) {
    const text = read(path);
    assert.match(text, /passwordLongEnough\(/, `${path} enforces the length rule`);
    assert.match(text, /common\.passwordRuleLength'\) \}/, `${path}: the length rule is required`);
    assert.match(text, /common\.passwordRuleVariety'\), recommended: true/, `${path}: variety is advice only`);
  }
});

test('field errors are visible, sit under their control and are linked to it', () => {
  for (const file of components) {
    for (const match of file.text.matchAll(/<p id="([^"{]+)" class="field-error"/g)) {
      const id = match[1];
      assert.ok(
        new RegExp(`(?:aria-)?describedby=\\{?[^\\n]*${id}`).test(file.text),
        `${file.path}: #${id} is not referenced by aria-describedby`,
      );
    }
    assert.doesNotMatch(file.text, /id="[^"]*-error" class="sr-only"/, `${file.path}: a field error must be visible, not only announced`);
  }
  const field = read('src/components/ui/Field.svelte');
  assert.ok(field.indexOf('class="field-error"') < field.indexOf('class="hint"'), 'Field renders the error directly under the control');
  assert.match(field, /'aria-invalid': error \? 'true' : undefined/);
  assert.match(field, /\[error && errorId, hint && hintId\]/);
});

test('validation forms re-check live after the first submit instead of on the first keystroke', () => {
  const checks: [string, RegExp][] = [
    ['src/components/tools/UltimateEncrypt.svelte', /\$: passwordError = attempted \?/],
    ['src/components/tools/UltimateEncrypt.svelte', /\$: unlockError = attempted \?/],
    ['src/components/tools/ChatCreate.svelte', /\$: roomError = roomAttempted &&/],
    ['src/components/tools/ChatCreate.svelte', /\$: passwordError = passwordAttempted &&/],
    ['src/components/tools/WhiteboardCreate.svelte', /\$: passwordError = attempted &&/],
    ['src/components/tools/TimeCapsule.svelte', /\$: dateError = attempted \?/],
    ['src/components/tools/Whiteboard.svelte', /\$: backupConfirmError = backupAttempted &&/],
    ['src/components/app/MobileApp.svelte', /const newPwInvalid = \$derived\(newRoomAttempted &&/],
    ['src/components/app/MobileApp.svelte', /const joinIdError = \$derived\(joinAttempted &&/],
  ];
  for (const [path, pattern] of checks) assert.match(read(path), pattern, path);
  const app = read('src/components/app/MobileApp.svelte');
  assert.doesNotMatch(app, /canCreateRoom|disabled=\{!joinRoomId/, 'submit stays enabled so a refused submit can point at the field');
  assert.match(app, /focusFirstInvalid\(document\.querySelector\('\[data-app-overlay="newRoom"\]'\)\)/);
  assert.match(app, /focusFirstInvalid\(document\.querySelector\('\[data-app-overlay="join"\]'\)\)/);
});

test('every locale has the checklist strings', () => {
  for (const locale of ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl']) {
    const dict = JSON.parse(read(`src/locales/${locale}.json`)) as Record<string, string>;
    for (const key of ['common.rule.recommended', 'common.passwordRuleMatch', 'app.join.idRequired', 'common.passwordRules']) {
      assert.ok(dict[key], `${locale} is missing ${key}`);
    }
  }
});
