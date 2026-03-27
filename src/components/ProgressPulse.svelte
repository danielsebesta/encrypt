<script lang="ts">
  export let title = 'Working...';
  export let detail = '';
  export let compact = false;
</script>

<div class={`progress-pulse ${compact ? 'progress-pulse-compact' : ''}`} aria-live="polite" aria-busy="true">
  <div class="progress-pulse-grid" aria-hidden="true">
    {#each Array(8) as _, index}
      <span class="progress-pulse-pixel" style={`animation-delay: ${index * 90}ms`}></span>
    {/each}
  </div>
  <div class="space-y-1">
    <p class="progress-pulse-title">{title}</p>
    {#if detail}
      <p class="progress-pulse-detail">{detail}</p>
    {/if}
  </div>
</div>

<style>
  .progress-pulse {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.9rem 1rem;
    border-radius: 1.25rem;
    border: 1px solid rgba(16, 185, 129, 0.18);
    background:
      linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(255, 255, 255, 0.88));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  :global(.dark) .progress-pulse {
    background:
      linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(24, 24, 27, 0.82));
    border-color: rgba(16, 185, 129, 0.24);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .progress-pulse-compact {
    padding: 0.8rem 0.9rem;
  }

  .progress-pulse-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 0.45rem));
    gap: 0.22rem;
    flex: 0 0 auto;
  }

  .progress-pulse-pixel {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 0.12rem;
    background: rgba(16, 185, 129, 0.24);
    animation: pixelPulse 900ms ease-in-out infinite;
  }

  .progress-pulse-title {
    font-size: 0.78rem;
    line-height: 1rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgb(5 150 105);
  }

  :global(.dark) .progress-pulse-title {
    color: rgb(52 211 153);
  }

  .progress-pulse-detail {
    font-size: 0.78rem;
    line-height: 1.25rem;
    color: rgb(82 82 91);
  }

  :global(.dark) .progress-pulse-detail {
    color: rgb(161 161 170);
  }

  @keyframes pixelPulse {
    0%, 100% {
      opacity: 0.22;
      transform: scale(0.88);
      background: rgba(16, 185, 129, 0.24);
    }

    50% {
      opacity: 1;
      transform: scale(1);
      background: rgba(16, 185, 129, 0.95);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-pulse-pixel {
      animation: none;
      opacity: 0.8;
      transform: none;
      background: rgba(16, 185, 129, 0.8);
    }
  }
</style>
