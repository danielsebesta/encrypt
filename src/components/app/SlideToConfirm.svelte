<script lang="ts">
  import Icon from '../Icon.svelte';

  let { label, hint, active, onconfirm }: {
    label: string;
    hint: string;
    active: boolean;
    onconfirm: () => void;
  } = $props();

  const KEY_STEP = 0.25;
  const CONFIRM_AT = 0.92;
  const TAP_SLOP = 4;
  const uid = $props.id();
  const hintId = `app-slide-hint-${uid}`;

  let track: HTMLDivElement;
  let thumb: HTMLSpanElement;
  let progress = $state(0);
  let dragging = $state(false);
  let confirmed = $state(false);
  let pointerId: number | null = null;
  let startX = 0;
  let startProgress = 0;

  $effect(() => {
    if (!active) reset();
  });

  function reset() {
    confirmed = false;
    dragging = false;
    pointerId = null;
    progress = 0;
  }

  function travel() {
    return Math.max(1, track.clientWidth - thumb.offsetWidth - 6);
  }

  function confirm() {
    if (confirmed) return;
    confirmed = true;
    dragging = false;
    progress = 1;
    onconfirm();
  }

  function settle() {
    if (confirmed) return;
    if (progress >= CONFIRM_AT) confirm();
    else progress = 0;
  }

  function onpointerdown(event: PointerEvent) {
    if (confirmed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    thumb.focus({ preventScroll: true });
    thumb.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    startX = event.clientX;
    startProgress = progress;
    dragging = true;
  }

  function onpointermove(event: PointerEvent) {
    if (!dragging || event.pointerId !== pointerId) return;
    progress = Math.min(1, Math.max(0, startProgress + (event.clientX - startX) / travel()));
  }

  function onpointerup(event: PointerEvent) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    if (Math.abs(event.clientX - startX) < TAP_SLOP) {
      progress = Math.min(1, startProgress + KEY_STEP);
      if (progress >= 1) confirm();
      return;
    }
    settle();
  }

  function onpointercancel(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    if (!confirmed) progress = 0;
  }

  function onkeydown(event: KeyboardEvent) {
    if (confirmed) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') next = progress + KEY_STEP;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') next = progress - KEY_STEP;
    else if (event.key === 'End') next = 1;
    else if (event.key === 'Home') next = 0;
    if (next === null) return;
    event.preventDefault();
    progress = Math.min(1, Math.max(0, next));
    if (progress >= 1) confirm();
  }

  function onblur() {
    if (!dragging && !confirmed) progress = 0;
  }
</script>

<div
  class="app-slide"
  class:app-slide--dragging={dragging}
  class:app-slide--confirmed={confirmed}
  style="--slide-p: {progress}"
  bind:this={track}
>
  <span class="app-slide__fill" aria-hidden="true"></span>
  <span class="app-slide__label" aria-hidden="true">{label}</span>
  <span
    class="app-slide__thumb"
    role="slider"
    tabindex={active ? 0 : -1}
    aria-label={label}
    aria-describedby={hintId}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
    bind:this={thumb}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onkeydown}
    {onblur}
  ><Icon name="arrow-right" size={20} /></span>
  <span id={hintId} class="sr-only">{hint}</span>
</div>
