<script lang="ts">
  export let step: number;
  export let total: number;
  export let label: string;
</script>

<div class="wizard-progress">
  <div class="wizard-progress__bars" style="--steps: {total}" aria-hidden="true">
    {#each Array(total) as _, i}
      <span class="wizard-progress__bar" class:wizard-progress__bar--done={i < step}></span>
    {/each}
  </div>
  <p class="hint" aria-live="polite">{label}</p>
</div>

<style>
  .wizard-progress {
    display: grid;
    gap: 0.5rem;
  }
  .wizard-progress__bars {
    display: grid;
    grid-template-columns: repeat(var(--steps), 1fr);
    gap: 0.375rem;
  }
  .wizard-progress__bar {
    height: 4px;
    border-radius: 999px;
    background: var(--line-soft);
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  .wizard-progress__bar--done {
    background: var(--accent);
  }
</style>
