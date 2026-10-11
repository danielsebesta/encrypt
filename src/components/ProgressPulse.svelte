<script lang="ts">
  export let title = '';
  export let detail = '';
  export let compact = false;
</script>

<div class="status status--busy" role="status" aria-live="polite" aria-busy="true">
  <div>
    <p class="status__title">{title}</p>
    {#if detail && !compact}
      <p class="status__detail">{detail}</p>
    {/if}
  </div>
</div>
