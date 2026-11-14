<script lang="ts">
  import { TABLER } from '../lib/icons';
  import type { IconName } from '../lib/iconManifest';

  interface Props {
    name: IconName;
    size?: 16 | 20;
    class?: string;
    label?: string;
  }

  let { name, size = 16, class: className = '', label }: Props = $props();
</script>

{#if label}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    role="img"
    aria-label={label}
    focusable="false"
    class="icon icon-{size} {className}"
  >
    {@html TABLER[name]}
  </svg>
{:else}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
    class="icon icon-{size} {className}"
  >
    {@html TABLER[name]}
  </svg>
{/if}

<style>
  .icon {
    flex: none;
  }
</style>
