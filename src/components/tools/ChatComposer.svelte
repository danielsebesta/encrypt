<script lang="ts">
  import { t } from '../../lib/t';
  import ChatVoiceRecorder from './ChatVoiceRecorder.svelte';
  import type { VoiceRecording } from '../../lib/voiceMessage';
  import type { SchedulePreset } from '../../lib/chatSchedule';

  let {
    dict,
    connected,
    verified,
    uploading,
    inputText = $bindable(''),
    inputEl = $bindable<HTMLInputElement | undefined>(undefined),
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
    inputText?: string;
    inputEl?: HTMLInputElement;
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

  function presetLabel(id: string): string {
    return t(dict, `chat.schedule.${id}`);
  }

  function closeMenus() {
    composerMenuOpen = false;
    scheduleMenuOpen = false;
  }
</script>

<div class="chat-input">
  {#if !voiceRecording}
  <div class="chat-attach-menu">
    <button
      type="button"
      class="chat-attach-btn"
      class:chat-attach-btn--active={composerMenuOpen || onceEnabled}
      on:click={() => { composerMenuOpen = !composerMenuOpen; scheduleMenuOpen = false; }}
      disabled={!connected || uploading}
      aria-haspopup="menu"
      aria-expanded={composerMenuOpen}
      aria-label={t(dict, 'chat.addMenu')}
      title={t(dict, 'chat.addMenu')}
    >
      {#if uploading}
        <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      {/if}
    </button>
    {#if composerMenuOpen}
      <div class="chat-attach-dropdown" role="menu">
        <button type="button" class="chat-attach-option" role="menuitem" on:click={() => { closeMenus(); onchoosefile(); }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>{t(dict, 'chat.uploadFile')}</span>
        </button>
        <button type="button" class="chat-attach-option" role="menuitem" on:click={() => { closeMenus(); oncreatewhiteboard(); }} disabled={!verified}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v14H3z"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 9h5"/><path d="M7 13h10"/></svg>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/></svg>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
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
  </div>
  {/if}
  <input id="chat-file" type="file" class="sr-only" bind:this={fileInputEl} on:change={onfileselect} />
  {#if !voiceRecording}
  <input
    type="text"
    class="chat-input-field"
    aria-label={t(dict, 'chat.messagePlaceholder')}
    placeholder={uploading ? t(dict, 'chat.uploading') : (onceEnabled ? t(dict, 'chat.oncePlaceholder') : t(dict, 'chat.messagePlaceholder'))}
    bind:value={inputText}
    bind:this={inputEl}
    on:input={ontyping}
    on:keydown={(e) => { if (e.key === 'Enter') onsend(); else if (e.key === 'Escape' && hasReply) onclearreply(); }}
    on:focus={closeMenus}
    disabled={!connected || uploading}
    autocomplete="off"
    spellcheck="false"
    data-lpignore="true"
    data-1p-ignore
  />
  {/if}
  <ChatVoiceRecorder {dict} bind:recording={voiceRecording} disabled={!connected || !verified || uploading} onrecorded={onvoicerecorded} onerror={onvoiceerror} />
  {#if !voiceRecording}
  <button type="button" class="chat-send-btn" aria-label={t(dict, 'chat.send')} on:click={onsend} disabled={!connected || (!inputText.trim() && !uploading)}>
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  </button>
  {/if}
</div>

<style>
  .chat-input {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--line-soft);
  }
  :global(.dark) .chat-input { border-color: var(--text); }
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
    min-height: 34px;
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
  .chat-send-btn {
    padding: 0.4rem; border-radius: 0.5rem;
    color: var(--accent); transition: background 0.15s;
  }
  .chat-send-btn:hover:not(:disabled) { background: oklch(0.7019 0.1577 160.44 / 0.1); }
  .chat-send-btn:disabled { opacity: 0.3; }
</style>
