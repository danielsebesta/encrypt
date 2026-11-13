<script lang="ts">
  export let step: number;
  export let total: number;
  export let label: string;
</script>

<p class="hint wizard-progress" aria-live="polite" data-step={step} data-total={total}>{label}</p>

<style>
  .wizard-progress {
    font-variant-numeric: tabular-nums;
  }
</style>
