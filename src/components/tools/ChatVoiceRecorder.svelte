<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import { MAX_VOICE_SECONDS, VoiceRecorder, formatClock, type VoiceRecording } from '../../lib/voiceMessage';

  let { dict, disabled = false, recording = $bindable(false), onrecorded, onerror }: {
    dict: Record<string, string>;
    disabled?: boolean;
    recording?: boolean;
    onrecorded: (recording: VoiceRecording) => void;
    onerror: (message: string) => void;
  } = $props();

  let supported = $state(false);
  let starting = $state(false);
  let elapsed = $state(0);
  let recorder: VoiceRecorder | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let stopEl: HTMLButtonElement | undefined = $state();
  let micEl: HTMLButtonElement | undefined = $state();

  onMount(() => {
    supported = VoiceRecorder.supported();
  });

  onDestroy(() => {
    clearInterval(ticker);
    recorder?.cancel();
  });

  async function start() {
    if (recording || starting || disabled) return;
    starting = true;
    const next = new VoiceRecorder(() => void stop());
    try {
      await next.start();
    } catch (error) {
      onerror(t(dict, (error as DOMException)?.name === 'NotAllowedError' ? 'chat.voiceMicDenied' : 'chat.voiceFailed'));
      return;
    } finally {
      starting = false;
    }
    recorder = next;
    elapsed = 0;
    recording = true;
    ticker = setInterval(() => { elapsed = (recorder?.elapsedMs ?? 0) / 1000; }, 250);
    await tick();
    stopEl?.focus();
  }

  async function stop() {
    const current = recorder;
    if (!current) return;
    recorder = null;
    clearInterval(ticker);
    recording = false;
    const result = await current.stop();
    await tick();
    micEl?.focus();
    if (result) onrecorded(result);
    else onerror(t(dict, 'chat.voiceFailed'));
  }

  async function cancel() {
    recorder?.cancel();
    recorder = null;
    clearInterval(ticker);
    recording = false;
    await tick();
    micEl?.focus();
  }
</script>

{#if supported}
  {#if recording}
    <div class="voice-rec" role="status">
      <span class="voice-rec__dot" aria-hidden="true"></span>
      <span class="voice-rec__label">{t(dict, 'chat.voiceRecording')}</span>
      <span class="voice-rec__time">{formatClock(elapsed)} / {formatClock(MAX_VOICE_SECONDS)}</span>
    </div>
    <button type="button" class="btn-ghost btn-sm btn-icon" onclick={cancel} aria-label={t(dict, 'chat.voiceCancel')} title={t(dict, 'chat.voiceCancel')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
    <button type="button" class="voice-rec__stop" bind:this={stopEl} onclick={stop} aria-label={t(dict, 'chat.voiceStop')} title={t(dict, 'chat.voiceStop')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
    </button>
  {:else}
    <button type="button" class="btn-ghost btn-sm btn-icon" bind:this={micEl} onclick={start} disabled={disabled || starting} aria-label={t(dict, 'chat.voiceRecord')} title={t(dict, 'chat.voiceRecord')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>
    </button>
  {/if}
{/if}

<style>
  .voice-rec {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .voice-rec__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    background: var(--danger);
    animation: voice-pulse 1.2s ease-in-out infinite;
  }
  .voice-rec__label {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .voice-rec__time {
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .voice-rec__stop {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--danger);
    color: var(--on-accent);
  }
  @keyframes voice-pulse {
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .voice-rec__dot { animation: none; }
  }
</style>
