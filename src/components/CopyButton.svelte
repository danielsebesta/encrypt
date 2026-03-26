<script lang="ts">
  export let text = '';
  export let label = 'COPY';
  export let className = '';

  let copied = false;
  let timeout: ReturnType<typeof setTimeout>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      clearTimeout(timeout);
      timeout = setTimeout(() => { copied = false; }, 1500);
    } catch {}
  }
</script>

<button
  on:click={copy}
  class="text-[10px] font-bold hover:underline transition-colors {copied ? 'text-emerald-500' : 'text-emerald-600'} {className}"
>
  {copied ? '✓' : label}
</button>
