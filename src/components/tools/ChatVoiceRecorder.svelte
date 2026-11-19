<script lang="ts">
  import { haptic } from '../../lib/haptics';
  import { hapticTap } from '../../lib/hapticTap';
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import { MAX_VOICE_SECONDS, VoiceRecorder, formatClock, type VoiceRecording } from '../../lib/voiceMessage';

  const WAVE_BARS = 44;

  let { dict, disabled = false, appMode = false, recording = $bindable(false), onrecorded, onerror }: {
    dict: Record<string, string>;
    disabled?: boolean;
    appMode?: boolean;
    recording?: boolean;
    onrecorded: (recording: VoiceRecording) => void;
    onerror: (message: string) => void;
  } = $props();

  let supported = $state(false);
  let starting = $state(false);
  let elapsed = $state(0);
  let recorder: VoiceRecorder | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  let levels = $state<number[]>(Array(WAVE_BARS).fill(0));
  let stopEl: HTMLButtonElement | undefined = $state();
  let micEl: HTMLButtonElement | undefined = $state();

  onMount(() => {
    supported = VoiceRecorder.supported();
  });

  onDestroy(() => {
    clearInterval(ticker);
    clearInterval(meterTimer);
    recorder?.cancel();
  });

  async function start() {
    if (recording || starting || disabled) return;
    starting = true;
    // iOS 18.4+/26: haptic must run sync inside the tap grant — before getUserMedia await.
    if (appMode) haptic('medium');
    const next = new VoiceRecorder(() => void stop(), appMode);
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
    if (appMode) {
      levels = Array(WAVE_BARS).fill(0);
      meterTimer = setInterval(() => { levels = [...levels.slice(1), recorder?.level ?? 0]; }, 70);
    }
    await tick();
    stopEl?.focus();
  }

  async function stop() {
    const current = recorder;
    if (!current) return;
    recorder = null;
    clearInterval(ticker);
    clearInterval(meterTimer);
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
    if (appMode) haptic('warning');
    clearInterval(ticker);
    clearInterval(meterTimer);
    recording = false;
    await tick();
    micEl?.focus();
  }
</script>

{#if supported}
  {#if recording && appMode}
    <button type="button" class="voice-rec-app__cancel" use:hapticTap={'warning'} onclick={cancel} aria-label={t(dict, 'chat.voiceCancel')} title={t(dict, 'chat.voiceCancel')}>
      <Icon name="trash" size={20} />
    </button>
    <div class="voice-rec-app" role="status" aria-label={t(dict, 'chat.voiceRecording')}>
      <span class="voice-rec-app__dot" aria-hidden="true"></span>
      <span class="voice-rec-app__time">{formatClock(elapsed)}</span>
      <span class="voice-rec-app__wave" aria-hidden="true">
        {#each levels as level, i (i)}
          <span style:height="{Math.round(14 + Math.min(1, level) * 86)}%"></span>
        {/each}
      </span>
    </div>
    <button type="button" class="voice-rec-app__send" bind:this={stopEl} onclick={stop} aria-label={t(dict, 'chat.send')} title={t(dict, 'chat.send')}>
      <Icon name="arrow-up" size={20} />
    </button>
  {:else if recording}
    <div class="voice-rec" role="status">
      <span class="voice-rec__dot" aria-hidden="true"></span>
      <span class="voice-rec__label">{t(dict, 'chat.voiceRecording')}</span>
      <span class="voice-rec__time">{formatClock(elapsed)} / {formatClock(MAX_VOICE_SECONDS)}</span>
    </div>
    <button type="button" class="btn-ghost btn-icon" onclick={cancel} aria-label={t(dict, 'chat.voiceCancel')} title={t(dict, 'chat.voiceCancel')}>
      <Icon name="trash" />
    </button>
    <button type="button" class="btn-danger btn-icon" bind:this={stopEl} onclick={stop} aria-label={t(dict, 'chat.voiceStop')} title={t(dict, 'chat.voiceStop')}>
      <Icon name="square" />
    </button>
  {:else}
    <button type="button" class={appMode ? 'voice-rec-app__mic' : 'btn-ghost btn-icon'} use:hapticTap={'medium'} bind:this={micEl} onclick={start} disabled={disabled || starting} aria-label={t(dict, 'chat.voiceRecord')} title={t(dict, 'chat.voiceRecord')}>
      <Icon name="mic" size={20} />
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
    font-size: 0.875rem;
  }
  .voice-rec__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--danger);
    animation: voice-pulse calc(var(--duration-slow) * 4) var(--ease-move) infinite;
  }
  .voice-rec__label {
    font-weight: 600;
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
  @keyframes voice-pulse {
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .voice-rec__dot { animation: none; }
  }
</style>
