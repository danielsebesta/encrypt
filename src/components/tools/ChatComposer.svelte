<script lang="ts">
  import { haptic } from '../../lib/haptics';
  import { untrack } from 'svelte';
  import { List, ListItem, Sheet } from 'konsta/svelte';
  import { t } from '../../lib/t';
  import { LUCIDE } from '../../lib/lucideIcons';
  import ChatVoiceRecorder from './ChatVoiceRecorder.svelte';
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
  } = $props();

  let keepFocus = false;

  function presetLabel(id: string): string {
    return t(dict, `chat.schedule.${id}`);
  }

  function closeMenus() {
    composerMenuOpen = false;
    scheduleMenuOpen = false;
  }

  const COMPOSER_MAX_PX = 120;
  function autogrow(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
    ontyping();
  }
  $effect(() => {
    if (inputText) return;
    const el = untrack(() => inputEl);
    if (el) el.style.height = '';
  });


</script>

{#snippet attachMenu()}
  {#if !voiceRecording}
  <div class="chat-attach-menu">
    <button
      type="button"
      class="chat-attach-btn"
      class:chat-attach-btn--active={composerMenuOpen || onceEnabled}
      on:click={() => { composerMenuOpen = !composerMenuOpen; scheduleMenuOpen = false; if (appMode) haptic('light'); }}
      disabled={(!connected && !allowQueue) || uploading}
      aria-haspopup="menu"
      aria-expanded={composerMenuOpen}
      aria-label={t(dict, 'chat.addMenu')}
      title={t(dict, 'chat.addMenu')}
    >
      {#if uploading}
        <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['loader-circle']}</svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['plus']}</svg>
      {/if}
    </button>
    {#if composerMenuOpen && !appMode}
      <div class="chat-attach-dropdown" role="menu">
        <button type="button" class="chat-attach-option" role="menuitem" on:click={() => { closeMenus(); onchoosefile(); }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['file']}</svg>
          <span>{t(dict, 'chat.uploadFile')}</span>
        </button>
        <button type="button" class="chat-attach-option" role="menuitem" on:click={() => { closeMenus(); oncreatewhiteboard(); }} disabled={!verified}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['presentation']}</svg>
          <span>{t(dict, 'chat.createWhiteboard')}</span>
        </button>
        <button
          type="button"
          class="chat-attach-option"
          class:chat-attach-option--on={onceEnabled}
          role="menuitemcheckbox"
          aria-checked={onceEnabled}
          on:click={() => { onceEnabled = !onceEnabled; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['eye-off']}</svg>
          <span>{t(dict, 'chat.once')}</span>
        </button>
        <button
          type="button"
          class="chat-attach-option"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={scheduleMenuOpen}
          disabled={!inputText.trim()}
          on:click={() => { scheduleMenuOpen = !scheduleMenuOpen; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['clock']}</svg>
          <span>{t(dict, 'chat.schedule')}</span>
        </button>
        {#if scheduleMenuOpen}
          <div class="chat-attach-submenu" role="menu">
            {#each schedulePresets as preset}
              <button type="button" class="chat-attach-option" role="menuitem" on:click={() => { closeMenus(); onschedule(preset.offsetMs); }}>
                <span>{presetLabel(preset.id)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {#if appMode}
    <Sheet opened={composerMenuOpen} onBackdropClick={closeMenus} class="chat-attach-sheet app-sheet pb-[env(safe-area-inset-bottom)]">
      <div class="app-sheet__handle"></div>
      <List strongIos insetIos class="mt-2! mb-3!">
        {#if !scheduleMenuOpen}
          <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.uploadFile')} onClick={() => { closeMenus(); onchoosefile(); }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--file"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['file']}</svg></span>
            {/snippet}
          </ListItem>
          <ListItem link linkComponent="button" linkProps={{ type: 'button', disabled: !verified }} chevron={false} title={t(dict, 'chat.createWhiteboard')} onClick={() => { closeMenus(); oncreatewhiteboard(); }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--board"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['pen-tool']}</svg></span>
            {/snippet}
          </ListItem>
          <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.once')} aria-checked={onceEnabled} onClick={() => { onceEnabled = !onceEnabled; }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--once"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['eye-off']}</svg></span>
            {/snippet}
            {#snippet after()}{#if onceEnabled}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
            {/if}{/snippet}
          </ListItem>
          <ListItem link linkComponent="button" linkProps={{ type: 'button', disabled: !inputText.trim() }} title={t(dict, 'chat.schedule')} onClick={() => { scheduleMenuOpen = true; }}>
            {#snippet media()}
              <span class="attach-badge attach-badge--schedule"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html LUCIDE['clock']}</svg></span>
            {/snippet}
          </ListItem>
        {:else}
          <ListItem link linkComponent="button" linkProps={{ type: 'button' }} chevron={false} title={t(dict, 'chat.schedule')} onClick={() => { scheduleMenuOpen = false; }}>
            {#snippet media()}
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['chevron-left']}</svg>
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
    class="chat-send-btn"
    class:chat-send-btn--ready={Boolean(inputText.trim()) || uploading}
    aria-label={t(dict, 'chat.send')}
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
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['send']}</svg>
  </button>
  {/if}
{/snippet}

<div class="chat-input">
  <input id="chat-file" type="file" class="sr-only" bind:this={fileInputEl} on:change={onfileselect} />
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
            on:input={autogrow}
            on:focus={closeMenus}
            on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onsend(); } else if (e.key === 'Escape' && hasReply) onclearreply(); }}
            disabled={(!connected && !allowQueue) || uploading}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="sentences"
            spellcheck="false"
            enterkeyhint="send"
            inputmode="text"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore
            data-bwignore
            rows="1"
          ></textarea>
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
    <input
      type="text"
      class="chat-input-field"
      id="chat-compose-input"
      name="encrypt-chat-compose"
      aria-label={t(dict, 'chat.messagePlaceholder')}
      placeholder={uploading ? t(dict, 'chat.uploading') : (onceEnabled ? t(dict, 'chat.oncePlaceholder') : t(dict, 'chat.messagePlaceholder'))}
      bind:value={inputText}
      bind:this={inputEl}
      on:input={ontyping}
      on:keydown={(e) => { if (e.key === 'Enter') onsend(); else if (e.key === 'Escape' && hasReply) onclearreply(); }}
      on:focus={closeMenus}
      disabled={(!connected && !allowQueue) || uploading}
      autocomplete="off"
      autocorrect="off"
      autocapitalize="sentences"
      spellcheck="false"
      enterkeyhint="send"
      inputmode="text"
      data-form-type="other"
      data-lpignore="true"
      data-1p-ignore
      data-bwignore
    />
    {/if}
  {/if}
  {#if !appMode}
    <ChatVoiceRecorder {dict} bind:recording={voiceRecording} disabled={(!connected && !allowQueue) || !verified || uploading} onrecorded={onvoicerecorded} onerror={onvoiceerror} />
    {@render sendBtn()}
  {/if}
</div>

<style>
  .chat-input {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--line-soft);
  }
  .chat-input-field {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 15px; color: var(--text); padding: 0.5rem 0;
  }
  :global(.dark) .chat-input-field { color: var(--text); }
  .chat-input-field::placeholder { color: var(--muted); }
  .chat-attach-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: var(--muted); transition: color 0.15s;
  }
  .chat-attach-menu { position: relative; flex-shrink: 0; }
  .chat-attach-btn:hover:not(:disabled),
  .chat-attach-btn--active {
    color: var(--accent);
  }
  .chat-attach-btn:disabled { opacity: 0.3; }
  .chat-attach-dropdown {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 30;
    width: 210px;
    max-width: calc(100vw - 1rem);
    max-height: min(60dvh, 22rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.3rem;
    border-radius: 0.65rem;
    border: 1px solid var(--line-soft);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
    backdrop-filter: blur(14px);
  }
  .chat-attach-submenu {
    margin: 0.15rem 0 0.2rem;
    padding: 0.2rem 0 0.1rem 0.55rem;
    border-left: 2px solid var(--line-soft);
  }
  :global(.dark) .chat-attach-dropdown {
    border-color: var(--muted);
    background: rgba(7, 11, 6, 0.96);
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.38);
  }
  .chat-attach-option {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0 0.55rem;
    border-radius: 0.5rem;
    font-size: 12px;
    font-weight: 800;
    color: var(--muted);
    text-align: left;
  }
  .chat-attach-option:hover:not(:disabled) {
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.08);
  }
  .chat-attach-option--on {
    color: var(--accent);
    background: oklch(0.7019 0.1577 160.44 / 0.1);
  }
  .chat-attach-option:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  :global(.dark) .chat-attach-option {
    color: var(--text);
  }
  /* Desktop site only — /app paints a filled primary circle in app.css */
  .chat-send-btn {
    padding: 0.4rem;
    border-radius: 0.5rem;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }
  :global(:root:not([data-app-platform])) .chat-send-btn {
    color: var(--accent);
  }
  :global(:root:not([data-app-platform])) .chat-send-btn:hover:not(:disabled) {
    background: oklch(0.7019 0.1577 160.44 / 0.1);
  }
  :global(:root:not([data-app-platform])) .chat-send-btn:disabled {
    opacity: 0.3;
  }
</style>
