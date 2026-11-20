<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import LZString from 'lz-string';
  import { readLimited } from '../../lib/httpLimits';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { hkdfAesKey, hkdfKey } from '../../lib/kdf';
  import { generatePassphrase } from '../../lib/passphrase';
  import { openPassword as openEnvelope, sealPassword as sealEnvelope, PASSWORD_ENVELOPE_MAGIC } from '../../lib/passwordEnvelope';
  import { t } from '../../lib/t';
  import { DRAND_CHAIN, lockTimeSecret, roundAt, tlock as getTlock, unlockTimeSecret } from '../../lib/timelock';
  import LinkWithQr from '../share/LinkWithQr.svelte';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import ToolResult from './ToolResult.svelte';
  import ToolStatus from './ToolStatus.svelte';

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
  let messageError = '';
  let passwordError = '';
  let dateError = '';
  let unixError = '';
  let pasteError = '';
  let openPasswordError = '';
  let advancedOpen = false;
  let panelEl: HTMLElement;
  let loading = false;
  let decryptLoading = false;

  $: if (message.trim()) messageError = '';
  $: if (!password || passwordLongEnough(password)) passwordError = '';
  $: if (targetLocal || useManualUnix || manualUnix) { dateError = ''; unixError = ''; }
  $: if (decryptInput.trim()) pasteError = '';
  $: if (openPassword) openPasswordError = '';

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
    } catch {}
    try {
      const bytes = fromB64Url(raw);
      if (!bytes) return null;
      const json = JSON.parse(new TextDecoder().decode(await gunzipBytes(bytes))) as { v: number; r?: number; t?: number; c: string; e?: string };
      if (json?.v === 2 && Number.isSafeInteger(json.r) && json.r > 0 && typeof json.c === 'string' && json.c
        && typeof json.e === 'string' && json.e && fromB64Url(json.c) && fromB64Url(json.e)) {
        return { v: 2, r: json.r, t: json.t, c: json.c, e: json.e };
      }
    } catch {}
    return null;
  }

  async function handleEncrypt() {
    error = '';
    ciphertext = '';
    capsuleLink = '';
    decrypted = '';
    messageError = message.trim() ? '' : t(dict, 'tools.timeCapsule.errorMessage');
    passwordError = password && !passwordLongEnough(password) ? t(dict, 'common.passwordTooShort') : '';
    dateError = '';
    unixError = '';

    let timeMs = NaN;
    const manual = String(manualUnix ?? '').trim();
    const usesUnix = useManualUnix && !!manual;
    const timeError = (text: string) => { if (usesUnix) unixError = text; else dateError = text; };
    if (usesUnix) {
      const unix = Number(manual);
      if (!Number.isFinite(unix) || unix <= 0) unixError = t(dict, 'tools.timeCapsule.errorInvalidUnix');
      else timeMs = unix * 1000;
    } else if (!targetLocal) {
      dateError = t(dict, 'tools.timeCapsule.errorUnlockTime');
    } else {
      timeMs = new Date(targetLocal).getTime();
    }
    if (!unixError && !dateError) {
      if (!Number.isFinite(timeMs)) timeError(t(dict, 'tools.timeCapsule.errorInvalidDate'));
      else if (timeMs <= Date.now()) timeError(t(dict, 'tools.timeCapsule.errorFuture'));
    }
    if (messageError || passwordError || dateError || unixError) {
      if (unixError) advancedOpen = true;
      void focusFirstInvalid(panelEl);
      return;
    }

    loading = true;
    try {
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
    openPasswordError = '';
    decrypted = '';

    const input = decryptInput.trim();
    if (!input) {
      pasteError = t(dict, 'tools.timeCapsule.errorPaste');
      void focusFirstInvalid(panelEl);
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
            openPasswordError = t(dict, 'tools.timeCapsule.errorPasswordNeeded');
            if (fromLink) setTimeout(() => document.getElementById('tc-open-password')?.focus(), 0);
          }
        } else {
          // Bare utf8 only existed in v1; a v2 envelope without the magic is the time-secret GCM.
          decrypted = new TextDecoder().decode(await openWithTimeSecret(payloadBytes, secret));
        }
      } else if (!looksPasswordSealed) {
        decrypted = new TextDecoder().decode(payloadBytes);
      } else if (!openPassword) {
        openPasswordError = t(dict, 'tools.timeCapsule.errorPasswordNeeded');
        if (fromLink) setTimeout(() => document.getElementById('tc-open-password')?.focus(), 0);
      } else {
        decrypted = new TextDecoder().decode(await openEnvelope(payloadBytes, openPassword));
      }
    } catch {
      openPasswordError = t(dict, 'tools.timeCapsule.errorWrongPassword');
    } finally {
      decryptLoading = false;
    }
  }
</script>
<div class="stack" bind:this={panelEl}>
  <Tabs items={[{ id: 'encrypt', label: t(dict, 'tools.timeCapsule.createCapsule') }, { id: 'decrypt', label: t(dict, 'tools.timeCapsule.openCapsule') }]} value={mode} label={t(dict, 'tools.timeCapsule.h1')} idBase="tc" panelClass="stack" onchange={(next) => (mode = next)}>
    {#if mode === 'encrypt'}
      <form class="stack" novalidate on:submit|preventDefault={handleEncrypt}>
        <Field label={t(dict, 'tools.timeCapsule.message')} error={messageError} required>
          {#snippet children(control)}
            <textarea {...control} class="input" bind:value={message} placeholder={t(dict, 'tools.timeCapsule.messagePlaceholder')} spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
          {/snippet}
        </Field>
        <Field label={t(dict, 'tools.timeCapsule.passwordLabel')} hint={t(dict, 'tools.timeCapsule.passwordHint')} error={passwordError}>
          {#snippet children(control)}
            <PassphraseField {dict} id={control.id} bind:value={password} placeholder={t(dict, 'tools.timeCapsule.passwordPlaceholder')} describedby={[control['aria-describedby'], password && 'tc-password-rules'].filter(Boolean).join(' ')} invalid={!!passwordError} generate={generatePassphrase} />
            {#if password}
              <PasswordChecklist id="tc-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} {dict} />
            {/if}
          {/snippet}
        </Field>
        <Field label={t(dict, 'tools.timeCapsule.unlockAfter')} error={dateError} required>
          {#snippet children(control)}
            <input {...control} type="datetime-local" class="input" bind:value={targetLocal} on:change={updateDerived} />
          {/snippet}
        </Field>

        <details class="more" bind:open={advancedOpen}>
          <summary>{t(dict, 'tools.timeCapsule.advancedTiming')}</summary>
          <div class="more__body">
            <dl class="grid gap-1 text-sm text-muted sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt class="font-semibold text-text">{t(dict, 'tools.timeCapsule.localTime')}</dt>
              <dd class="font-mono">{targetLocal || '-'}</dd>
              {#if debugUtc}
                <dt class="font-semibold text-text">{t(dict, 'tools.timeCapsule.utc')}</dt>
                <dd class="font-mono">{debugUtc}</dd>
                <dt class="font-semibold text-text">{t(dict, 'tools.timeCapsule.unixTimestamp')}</dt>
                <dd class="font-mono">{debugUnix}</dd>
                {#if debugRound}
                  <dt class="font-semibold text-text">{t(dict, 'tools.timeCapsule.drandRound')}</dt>
                  <dd class="font-mono">{debugRound}</dd>
                {/if}
              {/if}
            </dl>
            <Field label={t(dict, 'tools.timeCapsule.manualUnix')} error={unixError}>
              {#snippet children(control)}
                <input {...control} type="number" inputmode="numeric" class="input input--mono" bind:value={manualUnix} placeholder={t(dict, 'tools.timeCapsule.manualUnixPlaceholder')} />
              {/snippet}
            </Field>
            <label class="check">
              <input type="checkbox" bind:checked={useManualUnix} />
              <span>{t(dict, 'tools.timeCapsule.useManualUnix')}</span>
            </label>
          </div>
        </details>

        <Button type="submit" block busy={loading}>{t(dict, 'tools.timeCapsule.lockMessage')}</Button>
        {#if error}
          <ToolStatus tone="error">{error}</ToolStatus>
        {/if}
        {#if ciphertext}
          <ToolResult {dict} id="tc-output" label={t(dict, 'tools.timeCapsule.ciphertext')} text={ciphertext} class="output--scroll" />
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
      </form>
    {:else}
      <form class="stack" novalidate on:submit|preventDefault={handleDecrypt}>
        <Field label={t(dict, 'tools.timeCapsule.ciphertext')} error={pasteError} required>
          {#snippet children(control)}
            <textarea {...control} class="input input--mono min-h-40" bind:value={decryptInput} placeholder={t(dict, 'tools.timeCapsule.pastePlaceholder')}></textarea>
          {/snippet}
        </Field>
        <Field id="tc-open-password" label={t(dict, 'tools.timeCapsule.openPasswordLabel')} error={openPasswordError}>
          {#snippet children(control)}
            <input {...control} type="password" class="input" bind:value={openPassword} autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore />
          {/snippet}
        </Field>
        <Button type="submit" block busy={decryptLoading}>{t(dict, 'tools.timeCapsule.openCapsule')}</Button>
        {#if decryptError}
          <ToolStatus tone="error">{decryptError}</ToolStatus>
        {/if}
        {#if countdownTarget}
          <div class="status status--warn" role="status">
            <div>
              <p class="status__title">{t(dict, 'tools.timeCapsule.tooEarly').split('{time}')[0].replace(/\.?\s*$/, '')}</p>
              <p class="mt-1 font-mono text-2xl font-semibold tabular-nums text-text">{countdownDisplay}</p>
              <p class="status__detail">{new Date(countdownTarget * 1000).toLocaleString()}</p>
            </div>
          </div>
        {/if}
        {#if decrypted}
          <ToolResult {dict} id="tc-decrypted" label={t(dict, 'tools.timeCapsule.decryptedMessage')} text={decrypted} prose />
        {/if}
      </form>
    {/if}
  </Tabs>
</div>
