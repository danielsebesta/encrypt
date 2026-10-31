<script lang="ts">
  import { identiconSvg, type IdenticonSeed } from '../lib/identicon';

  export let seed: IdenticonSeed = '';
  export let size: number = 24;
  export let alt: string = '';
  export let className: string = '';

  $: svg = identiconSvg(seed, size);
</script>

<span
  class="inline-flex flex-shrink-0 select-none overflow-hidden rounded-full leading-none {className}"
  style="width: {size}px; height: {size}px;"
  role={alt ? 'img' : 'presentation'}
  aria-label={alt || undefined}
>
  {@html svg}
</span>
