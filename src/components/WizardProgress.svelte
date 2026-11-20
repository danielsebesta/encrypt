<script lang="ts">
  export let step: number;
  export let total: number;
  export let label: string;
</script>

<p class="hint wizard-progress tabular-nums" aria-live="polite" data-step={step} data-total={total}>{label}</p>
