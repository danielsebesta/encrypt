<script lang="ts">
  import { onMount } from 'svelte';
  import LZString from 'lz-string';
  import { decrypt as openWithPassword, encrypt as sealWithPassword } from '../../lib/aesGcm';
  import { checkRoomPassword, roomPasswordOk } from '../../lib/chatRoomSettings';
  import { generatePassphrase } from '../../lib/passphrase';
  import { PASSWORD_ENVELOPE_MAGIC } from '../../lib/passwordEnvelope';
  import { t } from '../../lib/t';
  import { DRAND_CHAIN, roundAt, tlock as getTlock } from '../../lib/timelock';
  import CopyButton from '../CopyButton.svelte';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let mode: 'encrypt' | 'decrypt' = 'encrypt';

  let message = '';
  let targetLocal = '';
  let ciphertext = '';

  let decryptInput = '';
  let decrypted = '';
  let password = '';
  let openPassword = '';

  $: passwordChecks = checkRoomPassword(password, '');
  $: passwordRules = [
    { ok: passwordChecks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: passwordChecks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: passwordChecks.strength, label: t(dict, 'common.passwordRuleStrength') },
  ];

  let error = '';
  let decryptError = '';
  let loading = false;
  let decryptLoading = false;

  let debugUtc = '';
  let debugUnix = '';
  let debugRound: number | null = null;

  let manualUnix = '';
  let useManualUnix = false;

  let countdownTarget: number | null = null;
  let countdownDisplay = '';
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  function startCountdown(unlockUnix: number) {
    countdownTarget = unlockUnix;
    decryptError = '';
    if (countdownInterval) clearInterval(countdownInterval);
    function tick() {
      const diff = unlockUnix - Math.floor(Date.now() / 1000);
      if (diff <= 0) {
        countdownDisplay = '';
        countdownTarget = null;
        if (countdownInterval) clearInterval(countdownInterval);
        return;
      }
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      const parts: string[] = [];
      if (d > 0) parts.push(`${d}d`);
      parts.push(`${String(h).padStart(2, '0')}h`);
      parts.push(`${String(m).padStart(2, '0')}m`);
      parts.push(`${String(s).padStart(2, '0')}s`);
      countdownDisplay = parts.join(' ');
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  const nowIsoLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  function updateDerived() {
    debugUtc = '';
    debugUnix = '';
    debugRound = null;
    if (!targetLocal) return;
    const localDate = new Date(targetLocal);
    const timeMs = localDate.getTime();
    if (!Number.isFinite(timeMs)) return;
    const round = roundAt(timeMs);
    debugUtc = new Date(timeMs).toISOString();
    debugUnix = String(Math.floor(timeMs / 1000));
    debugRound = round > 0 ? round : null;
  }

  onMount(() => {
    targetLocal = nowIsoLocal();
    updateDerived();
  });

  function tryDecodeCompact(input: string) {
    const raw = input.trim();
    if (!raw || raw.includes('\n')) return null;
    try {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
      const json = LZString.decompressFromBase64(b64);
      const obj = json ? JSON.parse(json) as { v: number; r?: number; t?: number; c: string } : null;
      return obj?.v === 1 && typeof obj.c === 'string' && obj.c ? obj : null;
    } catch {
      return null;
    }
  }

  async function handleEncrypt() {
    error = '';
    ciphertext = '';
    decrypted = '';

    if (!message.trim()) {
      error = t(dict, 'tools.timeCapsule.errorMessage');
      return;
    }
    if (password && !roomPasswordOk(password, '')) {
      error = t(dict, 'common.passwordWeak');
      return;
    }

    let timeMs: number;

    if (useManualUnix && manualUnix.trim()) {
      const unix = Number(manualUnix.trim());
      if (!Number.isFinite(unix) || unix <= 0) {
        error = t(dict, 'tools.timeCapsule.errorInvalidUnix');
        return;
      }
      timeMs = unix * 1000;
    } else {
      if (!targetLocal) {
        error = t(dict, 'tools.timeCapsule.errorUnlockTime');
        return;
      }
      const localDate = new Date(targetLocal);
      timeMs = localDate.getTime();
    }
    if (!Number.isFinite(timeMs)) {
      error = t(dict, 'tools.timeCapsule.errorInvalidDate');
      return;
    }

    const now = Date.now();
    if (timeMs <= now) {
      error = t(dict, 'tools.timeCapsule.errorFuture');
      return;
    }

    loading = true;
    try {
      const { timelockEncrypt, Buffer, client } = await getTlock();

      if (!Number.isFinite(timeMs)) {
        throw new Error(t(dict, 'tools.timeCapsule.errorInvalidBeacon'));
      }
      if (timeMs < DRAND_CHAIN.genesis * 1000) {
        throw new Error(t(dict, 'tools.timeCapsule.errorAfterGenesis'));
      }

      const round = roundAt(timeMs);

      // The password goes inside the time lock, so whoever breaks the lock early still faces Argon2id and AES-256.
      const payload = password ? Buffer.from(await sealWithPassword(message, password)) : Buffer.from(message, 'utf8');
      const armored = await timelockEncrypt(round, payload, client);

      const unix = Math.floor(timeMs / 1000);
      const packed = {
        v: 1,
        r: round,
        t: unix,
        c: armored
      };
      const json = JSON.stringify(packed);
      const compressed = LZString.compressToBase64(json);
      const token = compressed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

      ciphertext = token;
      debugUtc = new Date(timeMs).toISOString();
      debugUnix = String(unix);
      debugRound = round > 0 ? round : null;
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.timeCapsule.errorEncryptFailed');
    } finally {
      loading = false;
    }
  }

  async function handleDecrypt() {
    decryptError = '';
    decrypted = '';

    const input = decryptInput.trim();
    if (!input) {
      decryptError = t(dict, 'tools.timeCapsule.errorPaste');
      return;
    }

    decryptLoading = true;
    const compact = tryDecodeCompact(input);
    let opened: Uint8Array;
    try {
      if (!compact) throw new Error('Invalid capsule');
      const { timelockDecrypt, client } = await getTlock();
      opened = new Uint8Array(await timelockDecrypt(compact.c, client));
    } catch {
      const unlock = compact?.t && Number.isFinite(compact.t) ? compact.t : null;
      if (unlock && unlock > Math.floor(Date.now() / 1000)) {
        startCountdown(unlock);
      } else {
        const label = unlock ? new Date(unlock * 1000).toISOString() : t(dict, 'tools.timeCapsule.unlockTimeUtcLabel');
        decryptError = t(dict, 'tools.timeCapsule.tooEarly').replace('{time}', label);
      }
      decryptLoading = false;
      return;
    }
    try {
      if (!PASSWORD_ENVELOPE_MAGIC.every((byte, i) => opened[i] === byte)) {
        decrypted = new TextDecoder().decode(opened);
      } else if (!openPassword) {
        decryptError = t(dict, 'tools.timeCapsule.errorPasswordNeeded');
      } else {
        decrypted = await openWithPassword(opened, openPassword);
      }
    } catch {
      decryptError = t(dict, 'tools.timeCapsule.errorWrongPassword');
    } finally {
      decryptLoading = false;
    }
  }
</script>
<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.timeCapsule.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encrypt'} aria-controls="tc-panel" on:click={() => (mode = 'encrypt')}>{t(dict, 'tools.timeCapsule.createCapsule')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decrypt'} aria-controls="tc-panel" on:click={() => (mode = 'decrypt')}>{t(dict, 'tools.timeCapsule.openCapsule')}</button>
  </div>

  <div id="tc-panel" role="tabpanel" class="stack">
    {#if mode === 'encrypt'}
      <div class="field">
        <label class="label" for="tc-message">{t(dict, 'tools.timeCapsule.message')}</label>
        <textarea id="tc-message" class="input" bind:value={message} placeholder={t(dict, 'tools.timeCapsule.messagePlaceholder')} spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
      </div>
      <div class="field">
        <label class="label" for="tc-password">{t(dict, 'tools.timeCapsule.passwordLabel')}</label>
        <PassphraseField {dict} id="tc-password" bind:value={password} placeholder={t(dict, 'tools.timeCapsule.passwordPlaceholder')} describedby={password ? 'tc-password-rules tc-password-hint' : 'tc-password-hint'} generate={generatePassphrase} />
        {#if password}
          <PasswordChecklist id="tc-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} />
        {/if}
        <p id="tc-password-hint" class="hint">{t(dict, 'tools.timeCapsule.passwordHint')}</p>
      </div>
      <div class="field">
        <label class="label" for="tc-date">{t(dict, 'tools.timeCapsule.unlockAfter')}</label>
        <input id="tc-date" type="datetime-local" class="input" bind:value={targetLocal} on:change={updateDerived} />
      </div>

      <details class="more">
        <summary>{t(dict, 'tools.timeCapsule.advancedTiming')}</summary>
        <div class="more__body">
          <dl class="grid gap-1 text-sm text-muted sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt class="font-bold text-text">{t(dict, 'tools.timeCapsule.localTime')}</dt>
            <dd class="font-mono">{targetLocal || '-'}</dd>
            {#if debugUtc}
              <dt class="font-bold text-text">{t(dict, 'tools.timeCapsule.utc')}</dt>
              <dd class="font-mono">{debugUtc}</dd>
              <dt class="font-bold text-text">{t(dict, 'tools.timeCapsule.unixTimestamp')}</dt>
              <dd class="font-mono">{debugUnix}</dd>
              {#if debugRound}
                <dt class="font-bold text-text">{t(dict, 'tools.timeCapsule.drandRound')}</dt>
                <dd class="font-mono">{debugRound}</dd>
              {/if}
            {/if}
          </dl>
          <div class="field">
            <label class="label" for="tc-manual-unix">{t(dict, 'tools.timeCapsule.manualUnix')}</label>
            <input id="tc-manual-unix" type="number" inputmode="numeric" class="input input--mono" bind:value={manualUnix} placeholder={t(dict, 'tools.timeCapsule.manualUnixPlaceholder')} />
          </div>
          <label class="check">
            <input type="checkbox" bind:checked={useManualUnix} />
            <span>{t(dict, 'tools.timeCapsule.useManualUnix')}</span>
          </label>
        </div>
      </details>

      <button class="btn w-full" type="button" on:click={handleEncrypt} disabled={loading}>
        {loading ? t(dict, 'tools.timeCapsule.encrypting') : t(dict, 'tools.timeCapsule.lockMessage')}
      </button>
      {#if error}
        <p class="status status--error" role="alert">{error}</p>
      {/if}
      {#if ciphertext}
        <div class="field">
          <div class="output-head">
            <label class="label" for="tc-output">{t(dict, 'tools.timeCapsule.ciphertext')}</label>
            <CopyButton text={ciphertext} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
          </div>
          <textarea id="tc-output" class="input input--mono min-h-44" readonly value={ciphertext}></textarea>
        </div>
      {/if}
    {:else}
      <div class="field">
        <label class="label" for="tc-cipher">{t(dict, 'tools.timeCapsule.ciphertext')}</label>
        <textarea id="tc-cipher" class="input input--mono min-h-40" bind:value={decryptInput} placeholder={t(dict, 'tools.timeCapsule.pastePlaceholder')}></textarea>
      </div>
      <div class="field">
        <label class="label" for="tc-open-password">{t(dict, 'tools.timeCapsule.openPasswordLabel')}</label>
        <input id="tc-open-password" type="password" class="input" bind:value={openPassword} autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
      </div>
      <button class="btn w-full" type="button" on:click={handleDecrypt} disabled={decryptLoading}>
        {decryptLoading ? t(dict, 'tools.timeCapsule.decrypting') : t(dict, 'tools.timeCapsule.openCapsule')}
      </button>
      {#if decryptError}
        <p class="status status--error" role="alert">{decryptError}</p>
      {/if}
      {#if countdownTarget}
        <div class="status status--warn" role="status">
          <div>
            <p class="status__title">{t(dict, 'tools.timeCapsule.tooEarly').split('{time}')[0].replace(/\.?\s*$/, '')}</p>
            <p class="mt-1 font-mono text-2xl font-bold tabular-nums text-text">{countdownDisplay}</p>
            <p class="status__detail">{new Date(countdownTarget * 1000).toLocaleString()}</p>
          </div>
        </div>
      {/if}
      {#if decrypted}
        <div class="field">
          <div class="output-head">
            <span class="label" id="tc-decrypted-label">{t(dict, 'tools.timeCapsule.decryptedMessage')}</span>
            <CopyButton text={decrypted} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
          </div>
          <output class="output output--ok break-words" aria-labelledby="tc-decrypted-label" aria-live="polite">{decrypted}</output>
        </div>
      {/if}
    {/if}
  </div>
</div>
