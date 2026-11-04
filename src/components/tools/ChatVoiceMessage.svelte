<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../../lib/t';
  import { LUCIDE } from '../../lib/lucideIcons';
  import { VOICE_BARS, formatClock, placeholderPeaks, voicePeaks } from '../../lib/voiceMessage';

  const RATES = [1, 1.5, 2];

  let { dict, seconds, gone, note, load, appMode = false, seed = '' }: {
    dict: Record<string, string>;
    seconds: number;
    gone: boolean;
    note: string;
    load: () => Promise<Blob | null>;
    appMode?: boolean;
    seed?: string;
  } = $props();

  let audio: HTMLAudioElement | undefined = $state();
  let url = $state('');
  let loading = $state(false);
  let failed = $state(false);
  let playing = $state(false);
  let position = $state(0);
  let length = $state(0);
  let rate = $state(1);
  let scrubbing = false;
  let measured = $state<number[] | null>(null);
  const total = $derived(length && Number.isFinite(length) ? length : seconds);
  const peaks = $derived(measured ?? placeholderPeaks(seed || String(seconds)));
  const iconSize = $derived(appMode ? 16 : 14);
  const progress = $derived(total ? Math.min(1, position / total) : 0);

  onDestroy(() => {
    audio?.pause();
    if (url) URL.revokeObjectURL(url);
  });

  async function toggle() {
    if (!audio || gone) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (!url) {
      loading = true;
      failed = false;
      const blob = await load().catch(() => null);
      loading = false;
      if (!blob) {
        failed = true;
        return;
      }
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      if (appMode) void voicePeaks(blob, seconds).then((value) => { if (value) measured = value; });
    }
    await audio.play().catch(() => { failed = true; });
  }

  function seek(event: Event) {
    if (!audio || !url) return;
    audio.currentTime = Number((event.target as HTMLInputElement).value);
  }

  function jump(to: number) {
    if (!audio || !url || !total) return;
    const next = Math.max(0, Math.min(total, to));
    audio.currentTime = next;
    position = next;
  }

  function scrubTo(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    jump(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total);
  }

  function wavedown(event: PointerEvent) {
    if (gone) return;
    if (!url) {
      void toggle();
      return;
    }
    scrubbing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    scrubTo(event);
  }

  function wavemove(event: PointerEvent) {
    if (scrubbing) scrubTo(event);
  }

  function waveup() {
    scrubbing = false;
  }

  function wavekey(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : 0;
    if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(total);
    else if (step) jump(position + step);
    else return;
    event.preventDefault();
  }

  function cycleRate() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    if (!audio) return;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  }
</script>

{#snippet playIcon()}
  {#if loading}
    <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width={iconSize} height={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['loader-circle']}</svg>
  {:else if playing}
    <svg xmlns="http://www.w3.org/2000/svg" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['pause']}</svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['play']}</svg>
  {/if}
{/snippet}

<div class="voice-msg" class:voice-msg--gone={gone} class:voice-msg--app={appMode}>
  <button
    type="button"
    class="voice-msg__play"
    onclick={toggle}
    disabled={gone || loading}
    aria-label={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
    title={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
  >
    {@render playIcon()}
  </button>
  <div class="voice-msg__body">
    {#if appMode}
      <div
        class="voice-msg__wave"
        role="slider"
        tabindex={gone || !url ? -1 : 0}
        aria-label={t(dict, 'chat.voiceProgress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total) || 1}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatClock(position)} / ${formatClock(total)}`}
        aria-disabled={gone || !url}
        onpointerdown={wavedown}
        onpointermove={wavemove}
        onpointerup={waveup}
        onpointercancel={waveup}
        onkeydown={wavekey}
      >
        {#each peaks as peak, i (i)}
          <span class:voice-msg__tick--on={(i + 0.5) / VOICE_BARS <= progress} style:height="{Math.round(peak * 100)}%"></span>
        {/each}
      </div>
    {:else}
      <input
        type="range"
        class="voice-msg__bar"
        min="0"
        max={total || 1}
        step="0.1"
        value={position}
        oninput={seek}
        disabled={gone || !url}
        aria-label={t(dict, 'chat.voiceProgress')}
        aria-valuetext={`${formatClock(position)} / ${formatClock(total)}`}
      />
    {/if}
    <span class="voice-msg__meta">
      <span class="voice-msg__time">{playing || position ? formatClock(position) : formatClock(total)}</span>
      <span>· {failed ? t(dict, 'chat.voiceUnavailable') : note}</span>
    </span>
  </div>
  {#if appMode && url}
    <button type="button" class="voice-msg__rate" onclick={cycleRate} aria-label={t(dict, 'app.voice.speed')} title={t(dict, 'app.voice.speed')}>{rate}×</button>
  {/if}
  <audio
    bind:this={audio}
    preload="none"
    onplay={() => { playing = true; }}
    onpause={() => { playing = false; }}
    onended={() => { playing = false; position = 0; }}
    ontimeupdate={() => { if (!scrubbing) position = audio?.currentTime ?? 0; }}
    onloadedmetadata={() => { length = audio?.duration ?? 0; }}
  ></audio>
</div>

<style>
  .voice-msg {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: min(15rem, 60vw);
    margin: 0.25rem 0;
  }
  .voice-msg__play {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
  }
  .voice-msg__play:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .voice-msg__body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.15rem;
  }
  .voice-msg__bar {
    width: 100%;
    accent-color: var(--accent);
  }
  .voice-msg__meta {
    display: flex;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .voice-msg__time {
    font-variant-numeric: tabular-nums;
  }
</style>
