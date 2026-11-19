<script lang="ts">
  import type { Snippet } from 'svelte';
  import CopyButton from '../CopyButton.svelte';
  import { t } from '../../lib/t';

  interface Props {
    dict: Record<string, string>;
    id: string;
    label: string;
    text?: string;
    copy?: boolean;
    prose?: boolean;
    class?: string;
    output?: Snippet;
    children?: Snippet;
  }

  let { dict, id, label, text = '', copy = true, prose = false, class: className = '', output, children }: Props = $props();
</script>

<div class="field">
  <div class="output-head">
    <span class="label" id="{id}-label">{label}</span>
    {#if copy && text}
      <CopyButton {text} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
    {/if}
  </div>
  {#if output}
    {@render output()}
  {:else}
    <output {id} class="output output--ok {prose ? '[overflow-wrap:anywhere] [word-break:normal]' : ''} {className}" aria-labelledby="{id}-label">{text}</output>
  {/if}
  {@render children?.()}
</div>
