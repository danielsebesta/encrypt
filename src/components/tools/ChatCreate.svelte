<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import WizardProgress from '../WizardProgress.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { RETENTION_SECONDS, checkRoomPassword, passwordLongEnough, formatDuration, type ChatMode } from '../../lib/chatRoomSettings';
  import { genRoomPassphrase } from '../../lib/roomPassphrase';
  import MyRooms from './MyRooms.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Keep = 'local' | 'ttl';

  let step = 1;
  let keep: Keep = 'local';
  let customRoomId = '';
  let password = '';
  let retentionIndex = RETENTION_SECONDS.indexOf(3600);
  let roomError = '';
  let passwordError = '';
  let stepEl: HTMLFormElement;

  const DIACRITICS: Record<string, string> = {
    'á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a','ą':'a',
    'č':'c','ć':'c','ç':'c',
    'ď':'d','đ':'d',
    'é':'e','è':'e','ê':'e','ë':'e','ě':'e','ę':'e',
    'í':'i','ì':'i','î':'i','ï':'i',
    'ľ':'l','ĺ':'l','ł':'l',
    'ň':'n','ń':'n','ñ':'n',
    'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o','ø':'o',
    'ř':'r','ŕ':'r',
    'š':'s','ś':'s','ß':'ss',
    'ť':'t','ţ':'t',
    'ú':'u','ù':'u','û':'u','ü':'u','ů':'u',
    'ý':'y','ÿ':'y',
    'ž':'z','ź':'z','ż':'z',
  };

  function stripDiacritics(s: string): string {
    return s.split('').map(c => DIACRITICS[c] || c).join('');
  }

  function sanitizeRoomId(input: string, final = false): string {
    let s = stripDiacritics(input.toLowerCase())
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 48);
    if (final) s = s.replace(/^-|-$/g, '');
    return s;
  }

  function handleRoomIdInput() {
    customRoomId = sanitizeRoomId(customRoomId);
  }


  // A room page that found no room sends people here with its name, so creating always goes through this form.
  onMount(() => {
    const requested = new URLSearchParams(location.search).get('room');
    if (requested) customRoomId = sanitizeRoomId(requested, true);
  });

  const steps = 3;
  $: roomId = sanitizeRoomId(customRoomId.trim(), true);
  $: checks = checkRoomPassword(password, roomId);
  $: rules = [
    { ok: checks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: checks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: checks.strength, label: t(dict, 'common.passwordRuleStrength') },
    { ok: checks.distinct, label: t(dict, 'common.passwordRuleDistinct') },
  ];
  $: retentionSeconds = RETENTION_SECONDS[retentionIndex];
  $: retentionTime = formatDuration(retentionSeconds, locale);
  $: retentionLabel = t(dict, 'chat.retentionTtl').replace('{time}', retentionTime);
  $: stepText = t(dict, 'common.wizardStep').replace('{current}', String(step)).replace('{total}', String(steps));

  async function goTo(next: number) {
    step = next;
    await tick();
    stepEl?.querySelector<HTMLElement>('input:not([type=radio]), button')?.focus();
  }

  function submitKeep() {
    goTo(2);
  }

  function submitRoom() {
    roomError = '';
    if (!roomId) {
      roomError = t(dict, 'chat.roomNameRequired');
      return;
    }
    customRoomId = roomId;
    goTo(3);
  }

  function startChat() {
    passwordError = '';
    if (!roomId) return goTo(2);
    if (!passwordLongEnough(password)) {
      passwordError = t(dict, 'common.passwordTooShort');
      return;
    }
    const typedPassword = password.trim();
    const mode: ChatMode = keep === 'ttl' ? `ttl-${retentionSeconds}` : 'live';
    sessionStorage.setItem('chat-password', typedPassword);
    sessionStorage.setItem('chat-room-config', JSON.stringify({ mode, authMode: 'password', createdAt: Date.now(), v: 3 }));
    sessionStorage.setItem('chat-share-password', typedPassword);
    window.location.href = `${window.location.origin}/chat/${roomId}`;
  }
</script>

<div class="stack text-left">
  <WizardProgress step={step} total={steps} label={stepText} />

  {#if step === 1}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitKeep}>
      <fieldset class="field">
        <legend class="label">{t(dict, 'chat.retention')}</legend>
        <div class="choice-list">
          <label class="choice" class:choice--active={keep === 'local'}>
            <input type="radio" name="chat-keep" value="local" bind:group={keep} />
            <span>
              <span class="choice__title">{t(dict, 'chat.modeLiveTitle')}</span>
              <span class="choice__hint">{t(dict, 'chat.modeLiveHint')}</span>
            </span>
          </label>
          <label class="choice" class:choice--active={keep === 'ttl'}>
            <input type="radio" name="chat-keep" value="ttl" bind:group={keep} />
            <span class="min-w-0 flex-1">
              <span class="choice__title">{t(dict, 'chat.modeTtlTitle')}</span>
              <span class="choice__hint">{t(dict, 'chat.modeTtlHint')}</span>
              {#if keep === 'ttl'}
                <span class="retention-picker">
                  <span class="retention-value" aria-hidden="true">{retentionLabel}</span>
                  <input
                    id="chat-retention"
                    type="range"
                    min="0"
                    max={RETENTION_SECONDS.length - 1}
                    step="1"
                    bind:value={retentionIndex}
                    aria-label={t(dict, 'chat.retention')}
                    aria-valuetext={retentionLabel}
                  />
                  <span class="retention-scale" aria-hidden="true">
                    <span>{formatDuration(RETENTION_SECONDS[0], locale, 'short')}</span>
                    <span>{formatDuration(RETENTION_SECONDS[RETENTION_SECONDS.length - 1], locale, 'short')}</span>
                  </span>
                </span>
              {/if}
            </span>
          </label>
        </div>
      </fieldset>
      <button class="btn w-full" type="submit">{t(dict, 'common.continue')}</button>
    </form>
  {:else if step === 2}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={submitRoom}>
      <div class="field">
        <label class="label" for="chat-room">{t(dict, 'chat.customRoomId')}</label>
        <input
          id="chat-room"
          class="input"
          type="text"
          bind:value={customRoomId}
          on:input={handleRoomIdInput}
          placeholder={t(dict, 'chat.customRoomIdPlaceholder')}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore="true"
          aria-describedby="chat-room-hint"
          aria-invalid={roomError ? 'true' : undefined}
        />
        {#if roomError}
          <p class="status status--error" role="alert">{roomError}</p>
        {/if}
        <p id="chat-room-hint" class="hint">{t(dict, 'chat.customRoomIdHint')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'common.continue')}</button>
      </div>
    </form>
  {:else}
    <form class="stack" method="dialog" bind:this={stepEl} on:submit|preventDefault={startChat}>
      <div class="field">
        <label class="label" for="chat-pass">{t(dict, 'chat.password')}</label>
        <PassphraseField {dict} id="chat-pass" bind:value={password} placeholder={t(dict, 'chat.roomPasswordPlaceholder')} describedby="chat-pass-rules chat-pass-hint" invalid={!!passwordError} generate={() => { passwordError = ''; return genRoomPassphrase(); }} />
        <PasswordChecklist id="chat-pass-rules" label={t(dict, 'common.passwordRules')} {rules} />
        {#if passwordError}
          <p class="status status--error status--box" role="alert">{passwordError}</p>
        {/if}
        <p id="chat-pass-hint" class="hint">{t(dict, 'chat.createDescription')}</p>
      </div>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(2)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'chat.createRoom')}</button>
      </div>
    </form>
  {/if}
  <MyRooms {dict} {locale} />
</div>

<style>
  .retention-picker {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  .retention-value {
    font-size: 1rem;
    font-weight: 800;
    color: var(--text);
  }
  .retention-scale {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
