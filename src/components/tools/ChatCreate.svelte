<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import WizardProgress from '../WizardProgress.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { RETENTION_SECONDS, checkRoomPassword, passwordLongEnough, formatDuration, type ChatMode } from '../../lib/chatRoomSettings';
  import { genRoomPassphrase } from '../../lib/roomPassphrase';
  import MyRooms from './MyRooms.svelte';
  import Field from '../ui/Field.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import { roving } from '../ui/roving';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Keep = 'local' | 'ttl';

  let step = 1;
  let keep: Keep = 'local';
  let customRoomId = '';
  let password = '';
  let retentionIndex = RETENTION_SECONDS.indexOf(3600);
  let roomAttempted = false;
  let passwordAttempted = false;
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
    { ok: checks.variety, label: t(dict, 'common.passwordRuleVariety'), recommended: true },
    { ok: checks.strength, label: t(dict, 'common.passwordRuleStrength'), recommended: true },
    { ok: checks.distinct, label: t(dict, 'common.passwordRuleDistinct'), recommended: true },
  ];
  $: roomError = roomAttempted && !roomId ? t(dict, 'chat.roomNameRequired') : '';
  $: passwordError = passwordAttempted && !passwordLongEnough(password) ? t(dict, 'common.passwordTooShort') : '';
  $: retentionSeconds = RETENTION_SECONDS[retentionIndex];
  $: stepText = t(dict, 'common.wizardStep').replace('{current}', String(step)).replace('{total}', String(steps));

  async function goTo(next: number) {
    step = next;
    await tick();
    stepEl?.querySelector<HTMLElement>('input:not([type=radio]), button:not([role=radio])')?.focus();
  }

  function submitKeep() {
    goTo(2);
  }

  function submitRoom() {
    roomAttempted = true;
    if (!roomId) {
      void focusFirstInvalid(stepEl);
      return;
    }
    customRoomId = roomId;
    goTo(3);
  }

  function startChat() {
    if (!roomId) return goTo(2);
    passwordAttempted = true;
    if (!passwordLongEnough(password)) {
      void focusFirstInvalid(stepEl);
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
          <div class="choice flex-col" class:choice--active={keep === 'ttl'}>
            <label class="flex w-full cursor-pointer items-start gap-3">
              <input type="radio" name="chat-keep" value="ttl" bind:group={keep} />
              <span class="min-w-0 flex-1">
                <span id="chat-ttl-title" class="choice__title">{t(dict, 'chat.modeTtlTitle')}</span>
                <span class="choice__hint">{t(dict, 'chat.modeTtlHint')}</span>
              </span>
            </label>
            {#if keep === 'ttl'}
              <div class="ml-7 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="chat-ttl-title" use:roving>
                {#each RETENTION_SECONDS as seconds, i (seconds)}
                  <button
                    type="button"
                    class="chip aria-checked:border-accent aria-checked:bg-accent aria-checked:text-on-accent"
                    role="radio"
                    aria-checked={retentionIndex === i}
                    on:click={() => (retentionIndex = i)}
                    on:focus={() => (retentionIndex = i)}
                  >{formatDuration(seconds, locale, 'short')}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </fieldset>
      <button class="btn btn-block" type="submit">{t(dict, 'common.continue')}</button>
    </form>
  {:else if step === 2}
    <form class="stack" method="dialog" novalidate bind:this={stepEl} on:submit|preventDefault={submitRoom}>
      <Field id="chat-room" label={t(dict, 'chat.customRoomId')} hint={t(dict, 'chat.customRoomIdHint')} error={roomError} required>
        {#snippet children(control)}
          <input
            {...control}
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
          />
        {/snippet}
      </Field>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(1)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'common.continue')}</button>
      </div>
    </form>
  {:else}
    <form class="stack" method="dialog" novalidate bind:this={stepEl} on:submit|preventDefault={startChat}>
      <Field id="chat-pass" label={t(dict, 'chat.password')} hint={t(dict, 'chat.createDescription')} error={passwordError} required>
        {#snippet children(control)}
          <PassphraseField {dict} id={control.id} bind:value={password} describedby={[control['aria-describedby'], 'chat-pass-rules'].filter(Boolean).join(' ')} invalid={!!passwordError} required generate={genRoomPassphrase} />
        {/snippet}
        {#snippet below()}
          <PasswordChecklist id="chat-pass-rules" label={t(dict, 'common.passwordRules')} {rules} {dict} invalid={!!passwordError} />
        {/snippet}
      </Field>
      <div class="wizard-actions">
        <button class="btn-secondary" type="button" on:click={() => goTo(2)}>{t(dict, 'common.back')}</button>
        <button class="btn" type="submit">{t(dict, 'chat.createRoom')}</button>
      </div>
    </form>
  {/if}
  <MyRooms {dict} {locale} kind="chat" />
</div>

