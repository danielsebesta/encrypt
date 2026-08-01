<script lang="ts">
  export let title = '';
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
    border: 1px solid oklch(0.7019 0.1577 160.44 / 0.15);
    background: linear-gradient(135deg, oklch(0.7019 0.1577 160.44 / 0.06), rgba(255, 255, 255, 0.9));
  }

  :global(.dark) .pp {
    background: linear-gradient(135deg, oklch(0.7019 0.1577 160.44 / 0.08), rgba(9, 9, 11, 0.85));
    border-color: oklch(0.7019 0.1577 160.44 / 0.2);
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
    background: oklch(0.7019 0.1577 160.44 / 0.15);
    animation: dotGlow 1.6s ease-in-out infinite;
  }

  .pp-title {
    font-size: 0.75rem;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: oklch(0.60 0.14 160.44);
  }

  :global(.dark) .pp-title {
    color: oklch(0.77 0.155 160.44);
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
      background: oklch(0.7019 0.1577 160.44 / 0.12);
      box-shadow: none;
    }
    50% {
      background: oklch(0.7019 0.1577 160.44 / 0.9);
      box-shadow: 0 0 6px oklch(0.7019 0.1577 160.44 / 0.5), 0 0 12px oklch(0.7019 0.1577 160.44 / 0.2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pp-dot {
      animation: none;
      background: oklch(0.7019 0.1577 160.44 / 0.6);
    }
  }
</style>
