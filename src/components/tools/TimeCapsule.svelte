<script lang="ts">
  import { onMount } from 'svelte';
  import LZString from 'lz-string';
  import { readLimited } from '../../lib/httpLimits';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { hkdfAesKey, hkdfKey } from '../../lib/kdf';
  import { generatePassphrase } from '../../lib/passphrase';
  import { openPassword as openEnvelope, sealPassword as sealEnvelope, PASSWORD_ENVELOPE_MAGIC } from '../../lib/passwordEnvelope';
  import { t } from '../../lib/t';
  import { DRAND_CHAIN, lockTimeSecret, roundAt, tlock as getTlock, unlockTimeSecret } from '../../lib/timelock';
  import CopyButton from '../CopyButton.svelte';
  import LinkWithQr from '../share/LinkWithQr.svelte';
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

  let manualUnix: number | string | null = '';
  let useManualUnix = false;

  // The capsule travels after #c=, which browsers keep to themselves; the page opens it from there.
  let capsuleLink = '';
  let fromLink = false;
  const CAPSULE_HASH_RE = /^#c=([A-Za-z0-9_-]+)$/;

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
        if (fromLink) setTimeout(() => void handleDecrypt(), 4000);
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
    const shared = location.hash.match(CAPSULE_HASH_RE);
    if (shared) {
      mode = 'decrypt';
      decryptInput = shared[1];
      fromLink = true;
      void handleDecrypt();
    }
    return () => { if (countdownInterval) clearInterval(countdownInterval); };
  });

  const B64URL_RE = /^[A-Za-z0-9_-]+$/;

  function toB64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(text: string): Uint8Array | null {
    if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
    // A capsule token is a few hundred bytes, so a crafted one is cut off long before it can inflate into one
    // that buries the tab.
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
    return readLimited(new Response(stream), 2 * 1024 * 1024);
  }

  /** AES-256-GCM under the time secret alone, for capsules without a password: until the round lands, it is the only key. */
  async function sealWithTimeSecret(bytes: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await hkdfAesKey(await hkdfKey(secret), 'encrypt.click/time-capsule/v2/secret');
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource));
    const out = new Uint8Array(12 + cipher.length);
    out.set(iv);
    out.set(cipher, 12);
    return out;
  }

  async function openWithTimeSecret(blob: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
    if (blob.length < 12 + 16) throw new Error('Invalid capsule envelope');
    const key = await hkdfAesKey(await hkdfKey(secret), 'encrypt.click/time-capsule/v2/secret');
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.subarray(0, 12) as BufferSource },
      key,
      blob.subarray(12) as BufferSource,
    ));
  }

  /** v1 tokens kept the armored age text inside LZString'd JSON. v2 carries the binary lock and the envelope as b64url fields of gzipped JSON. */
  async function tryDecodeCapsule(input: string): Promise<{ v: 1; r?: number; t?: number; c: string } | { v: 2; r: number; t?: number; c: string; e: string } | null> {
    // A quarter of every v1 token ever made is a quarter-byte long — the LZString encoder left lengths that
    // no padding rule calls for — so nothing is rejected on shape beyond the alphabet. Standard base64 is
    // normalised too: those tokens were legal input once, and they still open.
    const raw = input.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!raw || raw.includes('\n') || !B64URL_RE.test(raw)) return null;
    try {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
      const json = LZString.decompressFromBase64(b64);
      const obj = json ? JSON.parse(json) as { v: number; r?: number; t?: number; c: string } : null;
      if (obj?.v === 1 && typeof obj.c === 'string' && obj.c) return { v: 1, r: obj.r, t: obj.t, c: obj.c };
    } catch {
      /* not v1 */
    }
    try {
      const bytes = fromB64Url(raw);
      if (!bytes) return null;
      const json = JSON.parse(new TextDecoder().decode(await gunzipBytes(bytes))) as { v: number; r?: number; t?: number; c: string; e?: string };
      if (json?.v === 2 && Number.isSafeInteger(json.r) && json.r > 0 && typeof json.c === 'string' && json.c
        && typeof json.e === 'string' && json.e && fromB64Url(json.c) && fromB64Url(json.e)) {
        return { v: 2, r: json.r, t: json.t, c: json.c, e: json.e };
      }
    } catch {
      /* not v2 */
    }
    return null;
  }

  async function handleEncrypt() {
    error = '';
    ciphertext = '';
    capsuleLink = '';
    decrypted = '';

    if (!message.trim()) {
      error = t(dict, 'tools.timeCapsule.errorMessage');
      return;
    }
    if (password && !passwordLongEnough(password)) {
      error = t(dict, 'common.passwordTooShort');
      return;
    }

    let timeMs: number;

    const manual = String(manualUnix ?? '').trim();
    if (useManualUnix && manual) {
      const unix = Number(manual);
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
      if (!Number.isFinite(timeMs)) {
        throw new Error(t(dict, 'tools.timeCapsule.errorInvalidBeacon'));
      }
      if (timeMs < DRAND_CHAIN.genesis * 1000) {
        throw new Error(t(dict, 'tools.timeCapsule.errorAfterGenesis'));
      }

      const round = roundAt(timeMs);

      // v2: only the 32-byte secret goes into the time lock. The message rides in a second envelope that needs both
      // the secret and the password, so a broken lock still faces Argon2id and AES-256, while the lock itself stays
      // the stripped binary age file — no armor, no base64 inside base64.
      const { secret, lock } = await lockTimeSecret(timeMs);
      const messageBytes = new TextEncoder().encode(message);
      const envelopeBytes = password
        ? await sealEnvelope(messageBytes, password, { timeSecret: secret })
        : await sealWithTimeSecret(messageBytes, secret);

      const unix = Math.floor(timeMs / 1000);
      const packed = {
        v: 2,
        r: lock.round,
        t: unix,
        c: toB64Url(lock.ciphertext),
        e: toB64Url(envelopeBytes)
      };
      const token = toB64Url(await gzipBytes(new TextEncoder().encode(JSON.stringify(packed))));

      ciphertext = token;
      capsuleLink = `${location.origin}/experiments/time-capsule#c=${token}`;
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
    const capsule = await tryDecodeCapsule(input);
    const unlock = capsule?.t && Number.isFinite(capsule.t) ? capsule.t : null;

    let secret: Uint8Array;
    let payloadBytes: Uint8Array;
    try {
      if (!capsule) throw new Error('Invalid capsule');
      if (capsule.v === 2) {
        const lockBytes = fromB64Url(capsule.c);
        const envelopeBytes = fromB64Url(capsule.e);
        if (!lockBytes || !envelopeBytes) throw new Error('Invalid capsule');
        secret = await unlockTimeSecret({ round: capsule.r, ciphertext: lockBytes });
        payloadBytes = envelopeBytes;
      } else {
        // v1 locked the whole payload: the password envelope, or the bare utf8 message, comes back out.
        const { timelockDecrypt, client } = await getTlock();
        payloadBytes = new Uint8Array(await timelockDecrypt(capsule.c, client));
        secret = new Uint8Array(0);
      }
    } catch {
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
      const looksPasswordSealed = PASSWORD_ENVELOPE_MAGIC.every((byte, i) => payloadBytes[i] === byte);
      if (capsule?.v === 2) {
        // The magic cannot tell a password seal from the one secret seal in 2^40 whose random IV happens to
        // begin with it, so every failure falls through to the other envelope before it gives up.
        if (looksPasswordSealed && openPassword) {
          try {
            decrypted = new TextDecoder().decode(await openEnvelope(payloadBytes, openPassword, secret));
          } catch {
            decrypted = new TextDecoder().decode(await openWithTimeSecret(payloadBytes, secret));
          }
        } else if (looksPasswordSealed) {
          try {
            decrypted = new TextDecoder().decode(await openWithTimeSecret(payloadBytes, secret));
          } catch {
            decryptError = t(dict, 'tools.timeCapsule.errorPasswordNeeded');
            if (fromLink) setTimeout(() => document.getElementById('tc-open-password')?.focus(), 0);
          }
        } else {
          // Bare utf8 only existed in v1; a v2 envelope without the magic is the time-secret GCM.
          decrypted = new TextDecoder().decode(await openWithTimeSecret(payloadBytes, secret));
        }
      } else if (!looksPasswordSealed) {
        decrypted = new TextDecoder().decode(payloadBytes);
      } else if (!openPassword) {
        decryptError = t(dict, 'tools.timeCapsule.errorPasswordNeeded');
        if (fromLink) setTimeout(() => document.getElementById('tc-open-password')?.focus(), 0);
      } else {
        decrypted = new TextDecoder().decode(await openEnvelope(payloadBytes, openPassword));
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
          <PasswordChecklist id="tc-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules}  {dict}/>
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
        {#if capsuleLink}
          <LinkWithQr
            id="tc-link"
            url={capsuleLink}
            label={t(dict, 'tools.timeCapsule.link')}
            copyLabel={t(dict, 'tools.timeCapsule.copyLink')}
            copiedLabel={t(dict, 'common.copied')}
            qrLabel={t(dict, 'tools.timeCapsule.showQr')}
            qrAlt={t(dict, 'tools.timeCapsule.qrAlt')}
            hint={t(dict, 'tools.timeCapsule.linkHint')}
          />
        {/if}
      {/if}
    {:else}
      <div class="field">
        <label class="label" for="tc-cipher">{t(dict, 'tools.timeCapsule.ciphertext')}</label>
        <textarea id="tc-cipher" class="input input--mono min-h-40" bind:value={decryptInput} placeholder={t(dict, 'tools.timeCapsule.pastePlaceholder')}></textarea>
      </div>
      <div class="field">
        <label class="label" for="tc-open-password">{t(dict, 'tools.timeCapsule.openPasswordLabel')}</label>
        <input id="tc-open-password" type="password" class="input" bind:value={openPassword} autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore on:keydown={(e) => { if (e.key === 'Enter' && !decryptLoading) { e.preventDefault(); void handleDecrypt(); } }} />
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
