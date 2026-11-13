<script lang="ts">
  import { SOLAR } from '../lib/icons';
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
    fill="none"
    role="img"
    aria-label={label}
    focusable="false"
    class="icon icon-{size} {className}"
  >
    {@html SOLAR[name]}
  </svg>
{:else}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    focusable="false"
    class="icon icon-{size} {className}"
  >
    {@html SOLAR[name]}
  </svg>
{/if}

<style>
  .icon {
    flex: none;
  }
</style>
