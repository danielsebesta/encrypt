<script lang="ts">
  type Shape = 'diamond' | 'hexagon' | 'triangle';
  let { shape }: { shape: Shape } = $props();
  const PATHS: Record<Shape, string> = {
    diamond: 'M12 3 21 12 12 21 3 12Z',
    hexagon: 'M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z',
    triangle: 'M12 3.5 21 19.5H3Z',
  };
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" focusable="false" class="icon icon-20">
  <path d={PATHS[shape]} />
</svg>
