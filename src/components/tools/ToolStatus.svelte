<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'info' | 'ok' | 'warn' | 'error' | 'busy';
    id?: string;
    children: Snippet;
  }

  let { tone = 'info', id, children }: Props = $props();
</script>

<p {id} class="status" class:status--ok={tone === 'ok'} class:status--warn={tone === 'warn'} class:status--error={tone === 'error'} class:status--busy={tone === 'busy'} role={tone === 'error' ? 'alert' : 'status'}>
  {@render children()}
</p>
