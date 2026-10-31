<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../../lib/t';
  import { formatClock } from '../../lib/voiceMessage';

  let { dict, seconds, gone, note, load }: {
    dict: Record<string, string>;
    seconds: number;
    gone: boolean;
    note: string;
    load: () => Promise<Blob | null>;
  } = $props();

  let audio: HTMLAudioElement | undefined = $state();
  let url = '';
  let loading = $state(false);
  let failed = $state(false);
  let playing = $state(false);
  let position = $state(0);
  let length = $state(0);
  const total = $derived(length && Number.isFinite(length) ? length : seconds);

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
    }
    await audio.play().catch(() => { failed = true; });
  }

  function seek(event: Event) {
    if (!audio || !url) return;
    audio.currentTime = Number((event.target as HTMLInputElement).value);
  }
</script>

<div class="voice-msg" class:voice-msg--gone={gone}>
  <button
    type="button"
    class="voice-msg__play"
    onclick={toggle}
    disabled={gone || loading}
    aria-label={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
    title={t(dict, playing ? 'chat.voicePause' : 'chat.voicePlay')}
  >
    {#if loading}
      <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
    {:else if playing}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z"/></svg>
    {/if}
  </button>
  <div class="voice-msg__body">
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
    <span class="voice-msg__meta">
      <span class="voice-msg__time">{playing || position ? formatClock(position) : formatClock(total)}</span>
      <span>· {failed ? t(dict, 'chat.voiceUnavailable') : note}</span>
    </span>
  </div>
  <audio
    bind:this={audio}
    preload="none"
    onplay={() => { playing = true; }}
    onpause={() => { playing = false; }}
    onended={() => { playing = false; position = 0; }}
    ontimeupdate={() => { position = audio?.currentTime ?? 0; }}
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
