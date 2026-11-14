<script lang="ts">
  import { onMount } from 'svelte';

  export let code: string;

  let host: HTMLDivElement;

  onMount(() => {
    if (matchMedia('(prefers-reduced-data: reduce)').matches) return;
    let handle: { destroy(): void } | null = null;
    let gone = false;
    import('asciify-engine/kit').then(({ fieldBackground }) => {
      if (gone) return;
      handle = fieldBackground(host, { preset: 'notFound', text: code, ink: 'var(--accent)' });
    });
    return () => {
      gone = true;
      handle?.destroy();
    };
  });
</script>

<div bind:this={host} class="ascii-404" aria-hidden="true"></div>
