<script lang="ts">
  export let title = 'Working...';
  export let detail = '';
  export let compact = false;
</script>

<div class={`pp ${compact ? 'pp--compact' : ''}`} aria-live="polite" aria-busy="true">
  <div class="pp-grid" aria-hidden="true">
    {#each Array(16) as _, i}
      <span
        class="pp-dot"
        style={`animation-delay: ${(i % 4) * 120 + Math.floor(i / 4) * 80}ms`}
      ></span>
    {/each}
  </div>
  <div class="pp-text">
    <p class="pp-title">{title}</p>
    {#if detail}
      <p class="pp-detail">{detail}</p>
    {/if}
  </div>
</div>

<style>
  .pp {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.15rem;
    border-radius: 1rem;
    border: 1px solid rgba(16, 185, 129, 0.15);
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(255, 255, 255, 0.9));
  }

  :global(.dark) .pp {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(9, 9, 11, 0.85));
    border-color: rgba(16, 185, 129, 0.2);
  }

  .pp--compact {
    padding: 0.75rem 0.9rem;
    gap: 0.8rem;
  }

  .pp-grid {
    display: grid;
    grid-template-columns: repeat(4, 6px);
    gap: 3px;
    flex: 0 0 auto;
  }

  .pp-dot {
    width: 6px;
    height: 6px;
    border-radius: 1.5px;
    background: rgba(16, 185, 129, 0.15);
    animation: dotGlow 1.6s ease-in-out infinite;
  }

  .pp-title {
    font-size: 0.75rem;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgb(5, 150, 105);
  }

  :global(.dark) .pp-title {
    color: rgb(52, 211, 153);
  }

  .pp-detail {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: rgb(113, 113, 122);
  }

  :global(.dark) .pp-detail {
    color: rgb(161, 161, 170);
  }

  @keyframes dotGlow {
    0%, 100% {
      background: rgba(16, 185, 129, 0.12);
      box-shadow: none;
    }
    50% {
      background: rgba(16, 185, 129, 0.9);
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.5), 0 0 12px rgba(16, 185, 129, 0.2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pp-dot {
      animation: none;
      background: rgba(16, 185, 129, 0.6);
    }
  }
</style>
