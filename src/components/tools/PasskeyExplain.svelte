<script lang="ts">
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../../lib/iconManifest';

  let { dict, collapsible = false }: { dict: Record<string, string>; collapsible?: boolean } = $props();

  const ITEMS: { title: string; body: string; icon: IconName }[] = [
    { title: 'rooms.passkeyExplain.tab1', body: 'rooms.passkeyExplain.body1', icon: 'fingerprint-pattern' },
    { title: 'rooms.passkeyExplain.tab2', body: 'rooms.passkeyExplain.body2', icon: 'lock' },
    { title: 'rooms.passkeyExplain.tab3', body: 'rooms.passkeyExplain.body3', icon: 'shield' },
  ];
</script>

{#snippet content()}
  <ul class="panel panel--flush m-0 grid list-none p-0">
    {#each ITEMS as item, i}
      <li class="flex items-start gap-3 px-4 py-3" class:border-t={i > 0} class:border-line-soft={i > 0}>
        <span class="icon-tile icon-tile--accent">
          <Icon name={item.icon} />
        </span>
        <div class="grid min-w-0 gap-0.5">
          <p class="m-0 text-sm font-semibold text-text">{t(dict, item.title)}</p>
          <p class="hint m-0">{t(dict, item.body)}</p>
        </div>
      </li>
    {/each}
  </ul>
  <p class="hint m-0">{t(dict, 'rooms.passkeyExplain.tip')}</p>
{/snippet}

{#if collapsible}
  <details class="more">
    <summary>{t(dict, 'rooms.passkeyExplain.title')}</summary>
    <div class="more__body">
      {@render content()}
    </div>
  </details>
{:else}
  <section class="grid gap-3" aria-labelledby="passkey-explain-title">
    <h3 id="passkey-explain-title" class="label">{t(dict, 'rooms.passkeyExplain.title')}</h3>
    {@render content()}
  </section>
{/if}
