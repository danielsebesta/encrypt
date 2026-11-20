<script lang="ts">
  import { haptic } from '../../lib/haptics';
  import { hapticTap } from '../../lib/hapticTap';
  import { tick, untrack } from 'svelte';
  import { List, ListItem, Sheet } from 'konsta/svelte';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import ChatVoiceRecorder from './ChatVoiceRecorder.svelte';
  import { menu } from '../ui/menu';
  import type { VoiceRecording } from '../../lib/voiceMessage';
  import type { SchedulePreset } from '../../lib/chatSchedule';

  let {
    dict,
    connected,
    verified,
    uploading,
    allowQueue = false,
    appMode = false,
    inputText = $bindable(''),
    inputEl = $bindable<HTMLInputElement | HTMLTextAreaElement | undefined>(undefined),
    fileInputEl = $bindable<HTMLInputElement | undefined>(undefined),
    composerMenuOpen = $bindable(false),
    voiceRecording = $bindable(false),
    onceEnabled = $bindable(false),
    scheduleMenuOpen = $bindable(false),
    hasReply = false,
    schedulePresets = [],
    onsend,
    ontyping,
    onchoosefile,
    oncreatewhiteboard,
    onfileselect,
    onvoicerecorded,
    onvoiceerror,
    onclearreply,
    onschedule,
    emojiOpen = false,
    onemoji,
  }: {
    dict: Record<string, string>;
    connected: boolean;
    verified: boolean;
    uploading: boolean;
    allowQueue?: boolean;
    appMode?: boolean;
    inputText?: string;
    inputEl?: HTMLInputElement | HTMLTextAreaElement;
    fileInputEl?: HTMLInputElement;
    composerMenuOpen?: boolean;
    voiceRecording?: boolean;
    onceEnabled?: boolean;
    scheduleMenuOpen?: boolean;
    hasReply?: boolean;
    schedulePresets?: SchedulePreset[];
    onsend: () => void;
    ontyping: () => void;
    onchoosefile: () => void;
    oncreatewhiteboard: () => void;
    onfileselect: (e: Event) => void;
    onvoicerecorded: (recording: VoiceRecording) => void;
    onvoiceerror: (message: string) => void;
    onclearreply: () => void;
    onschedule: (offsetMs: number) => void;
    emojiOpen?: boolean;
    onemoji?: (anchor: HTMLElement) => void;
  } = $props();

  let keepFocus = false;

  function presetLabel(id: string): string {
    return t(dict, `chat.schedule.${id}`);
  }

  function closeMenus() {
    composerMenuOpen = false;
    scheduleMenuOpen = false;
  }

  const COMPOSER_MAX_PX = 140;
  function fit(el: HTMLTextAreaElement | null | undefined) {
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    const cs = getComputedStyle(el);
    const inset = cs.boxSizing === 'content-box'
      ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      : -(parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth));
    el.style.height = 'auto';
    const natural = el.scrollHeight - inset;
    el.style.height = `${Math.min(natural, COMPOSER_MAX_PX)}px`;
    el.style.overflowY = natural > COMPOSER_MAX_PX ? 'auto' : 'hidden';
  }
  function oninputText(e: Event) {
    fit(e.currentTarget as HTMLTextAreaElement);
    ontyping();
  }
  function onkeyComposer(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); onsend(); }
    else if (e.key === 'Escape' && hasReply) onclearreply();
  }

  let attachBtnEl: HTMLButtonElement | undefined = $state();
  let attachMenuRoot: HTMLDivElement | undefined = $state();
  let scheduleItemEl: HTMLButtonElement | undefined = $state();
  let scheduleGroupEl: HTMLDivElement | undefined = $state();
  let attachMenuWasOpen = false;

  function openSchedule() {
    scheduleMenuOpen = true;
    void tick().then(() => scheduleGroupEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  function closeSchedule() {
    scheduleItemEl?.focus();
    scheduleMenuOpen = false;
  }

  function onScheduleItemKeys(e: KeyboardEvent) {
    if (scheduleMenuOpen && (e.key === 'Escape' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      closeSchedule();
      return;
    }
    if (e.key !== 'ArrowRight' || scheduleMenuOpen || !inputText.trim()) return;
    e.preventDefault();
    openSchedule();
  }

  function onScheduleGroupKeys(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeSchedule();
  }

  function onAttachMenuFocusout(e: FocusEvent) {
    if (composerMenuOpen && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) closeMenus();
  }

  $effect(() => {
    const wasOpen = attachMenuWasOpen;
    attachMenuWasOpen = composerMenuOpen;
    if (!appMode) return;
    if (!composerMenuOpen) {
      if (wasOpen) attachBtnEl?.focus();
      return;
    }
    void tick().then(() => {
      attachMenuRoot?.querySelector<HTMLElement>('.chat-attach-sheet button:not([disabled])')?.focus();
    });
  });
  $effect(() => {
    void inputText;
    const el = untrack(() => inputEl);
    queueMicrotask(() => fit(el as HTMLTextAreaElement));
  });

</script>

{#snippet attachMenu()}
  {#if !voiceRecording}
  <div class="chat-attach-menu" bind:this={attachMenuRoot} on:focusout={onAttachMenuFocusout}>
    <button
      type="button"
      class={appMode ? 'chat-attach-btn' : 'btn-ghost btn-icon'}
      class:chat-attach-btn--active={composerMenuOpen || onceEnabled}
      bind:this={attachBtnEl}
      use:hapticTap
      on:click={() => { composerMenuOpen = !composerMenuOpen; scheduleMenuOpen = false; }}
      disabled={(!connected && !allowQueue) || uploading}
      aria-haspopup="menu"
      aria-expanded={composerMenuOpen}
      aria-label={t(dict, 'chat.addMenu')}
      title={t(dict, 'chat.addMenu')}
    >
      {#if uploading}
        <Icon name="loader-circle" class="animate-spin" />
      {:else}
        <Icon name="plus" size={20} />
      {/if}
    </button>
    {#if composerMenuOpen && !appMode}
      <div
        class="menu menu--open chat-attach-dropdown"
        role="menu"
        tabindex="-1"
        aria-label={t(dict, 'chat.addMenu')}
        use:menu={{ open: composerMenuOpen, onclose: closeMenus, trigger: attachBtnEl }}
      >
        <button type="button" class="menu__item" role="menuitem" on:click={() => { closeMenus(); onchoosefile(); }}>
          <Icon name="file" />
          <span>{t(dict, 'chat.uploadFile')}</span>
        </button>
        <button type="button" class="menu__item" role="menuitem" on:click={() => { closeMenus(); oncreatewhiteboard(); }} disabled={!verified}>
          <Icon name="presentation" />
          <span>{t(dict, 'chat.createWhiteboard')}</span>
        </button>
        <button type="button" class="menu__item" role="menuitemcheckbox" aria-checked={onceEnabled} on:click={() => { onceEnabled = !onceEnabled; }}>
          <Icon name="eye-off" />
          <span>{t(dict, 'chat.once')}</span>
          {#if onceEnabled}<Icon name="check" class="chat-attach-dropdown__end" />{/if}
        </button>
        <button
          type="button"
          class="menu__item"
          role="menuitem"
          aria-expanded={scheduleMenuOpen}
          aria-controls="chat-schedule-menu"
          bind:this={scheduleItemEl}
          disabled={!inputText.trim()}
          on:keydown={onScheduleItemKeys}
          on:click={() => { if (scheduleMenuOpen) scheduleMenuOpen = false; else openSchedule(); }}
        >
          <Icon name="clock" />
          <span>{t(dict, 'chat.schedule')}</span>
          <Icon name={scheduleMenuOpen ? 'chevron-up' : 'chevron-down'} class="chat-attach-dropdown__end" />
        </button>
        {#if scheduleMenuOpen}
          <div class="chat-attach-submenu" role="group" id="chat-schedule-menu" aria-label={t(dict, 'chat.schedule')} bind:this={scheduleGroupEl} on:keydown={onScheduleGroupKeys}>
            {#each schedulePresets as preset}
              <button type="button" class="menu__item" role="menuitem" on:click={() => { closeMenus(); onschedule(preset.offsetMs); }}>
                <span>{presetLabel(preset.id)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {#if appMode}
    <Sheet opened={composerMenuOpen} inert={!composerMenuOpen} role="dialog" aria-modal="true" aria-label={t(dict, 'chat.addMenu')} onBackdropClick={closeMenus} class="chat-attach-sheet app-sheet pb-[env(safe-area-inset-bottom)]">
      <div class="app-sheet__handle"></div>
      <List strongIos insetIos class="mt-2! mb-3!">
        {#if !scheduleMenuOpen}
          <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.uploadFile')} onClick={() => { closeMenus(); onchoosefile(); }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--file"><Icon name="file" size={20} /></span>
            {/snippet}
          </ListItem>
          <ListItem link linkComponent="button" linkProps={{ type: 'button', disabled: !verified }} chevron={false} title={t(dict, 'chat.createWhiteboard')} onClick={() => { closeMenus(); oncreatewhiteboard(); }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--board"><Icon name="pen-tool" size={20} /></span>
            {/snippet}
          </ListItem>
          <ListItem link linkComponent="button" linkProps={{ type: 'button', role: 'switch', 'aria-checked': onceEnabled }} chevron={false} title={t(dict, 'chat.once')} onClick={() => { onceEnabled = !onceEnabled; }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--once"><Icon name="eye-off" size={20} /></span>
            {/snippet}
            {#snippet after()}{#if onceEnabled}
              <Icon name="check" size={20} />
            {/if}{/snippet}
          </ListItem>
          <ListItem link chevronMaterial={false} linkComponent="button" linkProps={{ type: 'button', disabled: !inputText.trim() }} title={t(dict, 'chat.schedule')} onClick={() => { scheduleMenuOpen = true; }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--schedule"><Icon name="clock" size={20} /></span>
            {/snippet}
          </ListItem>
        {:else}
          <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.schedule')} onClick={() => { scheduleMenuOpen = false; }}>
            {#snippet media()}
              <Icon name="chevron-left" size={20} />
            {/snippet}
          </ListItem>
          {#each schedulePresets as preset}
            <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={presetLabel(preset.id)} onClick={() => { closeMenus(); onschedule(preset.offsetMs); }} />
          {/each}
        {/if}
      </List>
    </Sheet>
  {/if}
  </div>
  {/if}
{/snippet}

{#snippet sendBtn()}
  {#if !voiceRecording}
  <button
    type="button"
    class={appMode ? 'chat-send-btn' : 'btn btn-icon'}
    class:chat-send-btn--ready={appMode && (Boolean(inputText.trim()) || uploading)}
    aria-label={t(dict, 'chat.send')}
    title={t(dict, 'chat.send')}
    use:hapticTap
    on:mousedown|preventDefault
    on:pointerdown={() => { keepFocus = document.activeElement === inputEl; }}
    on:click={() => {
      if (appMode) haptic('light');
      const keep = keepFocus || document.activeElement === inputEl;
      keepFocus = false;
      if (keep) inputEl?.focus();
      onsend();
      if (keep) setTimeout(() => inputEl?.focus(), 60);
    }}
    disabled={(!connected && !allowQueue) || (!inputText.trim() && !uploading)}
  >
    <Icon name="send" size={20} />
  </button>
  {/if}
{/snippet}

{#snippet emojiBtn()}
  {#if onemoji}
    <button
      type="button"
      class={appMode ? 'app-composer__emoji' : 'btn-ghost btn-icon chat-emoji-btn'}
      class:chat-emoji-btn--active={emojiOpen}
      use:hapticTap
      aria-label={t(dict, 'emoji.label')}
      title={t(dict, 'emoji.label')}
      aria-haspopup="dialog"
      aria-expanded={emojiOpen}
      disabled={(!connected && !allowQueue) || uploading}
      on:pointerdown={(e) => e.preventDefault()}
      on:click={(e) => onemoji?.(e.currentTarget)}
    >
      <Icon name="smile" size={20} />
    </button>
  {/if}
{/snippet}

<div class="chat-input" class:chat-input--site={!appMode}>
  <input id="chat-file" type="file" class="sr-only" tabindex="-1" aria-label={t(dict, 'chat.uploadFile')} bind:this={fileInputEl} on:change={onfileselect} />
  {#if appMode}
    <div class="app-composer">
      {#if !voiceRecording}
        {@render attachMenu()}
        <div class="app-composer__field" role="presentation" on:pointerdown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputEl?.focus(); } }}>
          <textarea
            id="chat-compose-input"
            class="app-composer__input"
            name="encrypt-chat-compose"
            aria-label={t(dict, 'chat.messagePlaceholder')}
            placeholder={uploading ? t(dict, 'chat.uploading') : (onceEnabled ? t(dict, 'chat.oncePlaceholder') : t(dict, 'chat.messagePlaceholder'))}
            bind:value={inputText}
            bind:this={inputEl}
            on:input={oninputText}
            on:focus={closeMenus}
            on:keydown={onkeyComposer}
            disabled={(!connected && !allowQueue) || uploading}
            autocomplete="off"
            autocorrect="on"
            autocapitalize="sentences"
            spellcheck="true"
            enterkeyhint="send"
            inputmode="text"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore
            data-bwignore
            rows="1"
          ></textarea>
          {@render emojiBtn()}
        </div>
      {/if}
      <ChatVoiceRecorder {dict} {appMode} bind:recording={voiceRecording} disabled={(!connected && !allowQueue) || !verified || uploading} onrecorded={onvoicerecorded} onerror={onvoiceerror} />
      {#if !voiceRecording}
        {@render sendBtn()}
      {/if}
    </div>
  {:else}
    {@render attachMenu()}
    {#if !voiceRecording}
    <textarea
      class="input chat-input-field"
      id="chat-compose-input"
      name="encrypt-chat-compose"
      aria-label={t(dict, 'chat.messagePlaceholder')}
      placeholder={uploading ? t(dict, 'chat.uploading') : (onceEnabled ? t(dict, 'chat.oncePlaceholder') : t(dict, 'chat.messagePlaceholder'))}
      bind:value={inputText}
      bind:this={inputEl}
      on:input={oninputText}
      on:keydown={onkeyComposer}
      on:focus={closeMenus}
      disabled={(!connected && !allowQueue) || uploading}
      autocomplete="off"
      autocorrect="on"
      autocapitalize="sentences"
      spellcheck="true"
      enterkeyhint="send"
      inputmode="text"
      data-form-type="other"
      data-lpignore="true"
      data-1p-ignore
      data-bwignore
      rows="1"
    ></textarea>
    {@render emojiBtn()}
    {/if}
  {/if}
  {#if !appMode}
    <ChatVoiceRecorder {dict} bind:recording={voiceRecording} disabled={(!connected && !allowQueue) || !verified || uploading} onrecorded={onvoicerecorded} onerror={onvoiceerror} />
    {@render sendBtn()}
  {/if}
</div>

<style>
  .chat-input {
    display: flex; align-items: flex-end; gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--line-soft);
  }
  .chat-input-field {
    flex: 1; min-height: 2.5rem; padding-block: 0.4375rem;
    line-height: 1.5; resize: none; overflow-y: hidden; display: block;
  }
  .chat-attach-btn {
    padding: 0.4rem; border-radius: 8px;
    color: var(--muted); transition: color var(--duration-fast) var(--ease-out);
  }
  .chat-attach-menu { position: relative; flex-shrink: 0; }
  @media (max-width: 30rem) {
    .chat-input--site { flex-wrap: wrap; padding: 0.5rem 0.75rem; }
    .chat-input--site .chat-input-field { order: -1; flex-basis: 100%; }
    .chat-input--site .chat-attach-menu { margin-inline-end: auto; }
  }
  .chat-attach-btn:hover:not(:disabled),
  .chat-attach-btn--active {
    color: var(--accent);
  }
  .chat-attach-btn:disabled { opacity: 0.3; }
  .chat-emoji-btn { flex-shrink: 0; }
  .chat-emoji-btn--active { color: var(--accent); }
  .chat-attach-dropdown {
    top: auto;
    bottom: calc(100% + 0.5rem);
    margin: 0;
    width: max-content;
    max-width: calc(100vw - 2rem);
    max-height: min(60dvh, 24rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .chat-attach-dropdown :global(.chat-attach-dropdown__end) {
    margin-left: auto;
  }
  .chat-attach-submenu {
    display: grid;
    gap: 0.125rem;
    margin-left: 1.25rem;
    padding-left: 0.5rem;
    border-left: 2px solid var(--line-soft);
  }
  .chat-send-btn {
    padding: 0.4rem;
    border-radius: 8px;
    transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
  }
</style>
