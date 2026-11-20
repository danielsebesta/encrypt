<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
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
  const progress = $derived(total ? Math.min(1, position / total) : 0);

  onDestroy(() => {
    audio?.pause();
    if (url) URL.revokeObjectURL(url);
  });

  async function toggle() {
    if (!audio || gone || loading) return;
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
      void voicePeaks(blob, seconds).then((value) => { if (value) measured = value; });
    }
    await audio.play().catch(() => { failed = true; });
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
  {#if loading && appMode}
    <Icon name="loader-circle" class="animate-spin" />
  {:else if playing}
    <Icon name="pause" />
  {:else}
    <Icon name="play" />
  {/if}
{/snippet}

<div class="voice-msg" class:voice-msg--gone={gone} class:voice-msg--app={appMode}>
  <button
    type="button"
    class={appMode ? 'voice-msg__play' : 'btn-secondary btn-sm btn-icon'}
    onclick={toggle}
    disabled={gone || (appMode && loading)}
    aria-busy={!appMode && loading ? 'true' : undefined}
    aria-label={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
    title={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
  >
    {@render playIcon()}
  </button>
  <div class="voice-msg__body">
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
    <span class="voice-msg__meta">
      <span class="voice-msg__time">{playing || position ? formatClock(position) : formatClock(total)}</span>
      <span class="voice-msg__note"><span class="voice-msg__sep" aria-hidden="true">· </span>{failed ? t(dict, 'chat.voiceUnavailable') : note}</span>
      {#if !appMode}
        <button type="button" class="btn-link btn-sm voice-msg__rate" onclick={cycleRate} disabled={gone} aria-label={`${t(dict, 'chat.voiceSpeed')} ${rate}×`} title={t(dict, 'chat.voiceSpeed')}>{rate}×</button>
      {/if}
    </span>
  </div>
  {#if appMode && url}
    <button type="button" class="voice-msg__rate" onclick={cycleRate} aria-label={`${t(dict, 'app.voice.speed')} ${rate}×`} title={t(dict, 'app.voice.speed')}>{rate}×</button>
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
    border-radius: 50%;
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
  .voice-msg__meta {
    display: flex;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .voice-msg__time {
    font-variant-numeric: tabular-nums;
  }
  .voice-msg:not(.voice-msg--app) {
    --voice-on: var(--accent);
    container-type: inline-size;
    align-items: flex-start;
    gap: 0.5rem;
    width: 16rem;
    min-width: 0;
    max-width: 100%;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__body {
    gap: 0.25rem;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__wave {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1px;
    height: 2rem;
    border-radius: 6px;
    cursor: pointer;
    touch-action: none;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__wave > span {
    flex: 1 1 0;
    min-width: 1px;
    max-width: 3px;
    min-height: 3px;
    border-radius: 1px;
    background: currentColor;
    opacity: 0.35;
    transition: opacity var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__wave > span.voice-msg__tick--on {
    background: var(--voice-on);
    opacity: 1;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "time note rate";
    align-items: center;
    column-gap: 0.5rem;
    overflow: visible;
    line-height: 1rem;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__time {
    grid-area: time;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__note {
    grid-area: note;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__sep {
    display: none;
  }
  @container (max-width: 15rem) {
    .voice-msg:not(.voice-msg--app) .voice-msg__meta {
      grid-template-areas: "time . rate" "note note note";
    }
    .voice-msg:not(.voice-msg--app) .voice-msg__note {
      white-space: normal;
    }
  }
  .voice-msg__time {
    flex: none;
  }
  .voice-msg__note {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .voice-msg:not(.voice-msg--app) .voice-msg__rate {
    grid-area: rate;
    min-width: 2rem;
    min-height: 1.5rem;
    padding: 0 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .voice-msg--gone:not(.voice-msg--app) .voice-msg__wave {
    cursor: not-allowed;
    opacity: 0.5;
  }
  @media (forced-colors: active) {
    .voice-msg:not(.voice-msg--app) .voice-msg__wave > span {
      background: CanvasText;
    }
    .voice-msg:not(.voice-msg--app) .voice-msg__wave > span.voice-msg__tick--on {
      background: Highlight;
    }
  }
</style>
