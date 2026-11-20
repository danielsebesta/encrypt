<script lang="ts">
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import type { PipView } from './callPipWindow.svelte';

  let { view }: { view: PipView } = $props();
  let videoEl: HTMLVideoElement | undefined = $state();

  $effect(() => {
    const el = videoEl;
    const stream = view.stream;
    if (!el || el.srcObject === stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  });
</script>

<div class="call-pip">
  <div class="call-pip__stage">
    {#if view.stream}
      <video bind:this={videoEl} class="call-pip__video" autoplay muted playsinline></video>
    {:else}
      <div class="call-pip__people">
        {#each view.people as person, index (index)}
          <span class="call-pip__avatar" class:call-pip__avatar--on={person.on} style:background={person.bg} title={person.name} role="img" aria-label={person.name}></span>
        {/each}
      </div>
    {/if}
  </div>
  <p class="call-pip__label" aria-live="polite">{view.label}</p>
  <div class="call-pip__bar">
    <button type="button" class="btn-secondary btn-icon" class:call-pip__btn--off={view.micMuted} title={t(view.dict, 'chat.callMute')} aria-label={t(view.dict, 'chat.callMute')} aria-pressed={view.micMuted} onclick={view.onmic}>
      <Icon name={view.micMuted ? 'mic-off' : 'mic'} size={20} />
    </button>
    <button type="button" class="btn-secondary btn-icon" class:call-pip__btn--off={view.cameraOff} title={t(view.dict, 'chat.callCameraOff')} aria-label={t(view.dict, 'chat.callCameraOff')} aria-pressed={view.cameraOff} onclick={view.oncamera}>
      <Icon name={view.cameraOff ? 'video-off' : 'video'} size={20} />
    </button>
    <button type="button" class="btn-secondary btn-icon" title={t(view.dict, 'chat.callReturn')} aria-label={t(view.dict, 'chat.callReturn')} onclick={view.onreturn}>
      <Icon name="maximize-2" size={20} />
    </button>
    <button type="button" class="btn-danger btn-icon" title={t(view.dict, 'chat.callHangUp')} aria-label={t(view.dict, 'chat.callHangUp')} onclick={view.onend}>
      <Icon name="phone-off" size={20} />
    </button>
  </div>
</div>

<style>
  .call-pip {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100vh;
    padding: 0.5rem;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
  }
  .call-pip__stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }
  .call-pip__video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--bg);
  }
  .call-pip__people {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem;
  }
  .call-pip__avatar {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 9999px;
    outline: 2px solid transparent;
    outline-offset: 2px;
    transition: outline-color var(--duration-fast) var(--ease-out);
  }
  .call-pip__avatar--on {
    outline-color: var(--accent);
  }
  .call-pip__label {
    margin: 0;
    overflow: hidden;
    font-size: 0.8125rem;
    color: var(--muted);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .call-pip__bar {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
  }
  .call-pip__bar .call-pip__btn--off,
  .call-pip__bar .call-pip__btn--off:hover {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--line));
    background: color-mix(in srgb, var(--danger) 10%, var(--surface));
    color: var(--danger);
  }
  @media (prefers-reduced-motion: reduce) {
    .call-pip__avatar {
      transition: none;
    }
  }
</style>
