<script lang="ts">
  import { t } from '../../lib/t';
  import ShareForm from '../tools/ShareForm.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { sendIcon, chatIcon, whiteboardIcon } from '../../lib/tools';
  import type { IconName } from '../../lib/iconManifest';

  export let locale = 'en';
  export let dict: Record<string, string>;

  type Tab = 'send' | 'chat' | 'whiteboard';

  const tabs: { id: Tab; label: string; text: string; icon: IconName }[] = [
    { id: 'send', label: 'landing.try.tab.send', text: 'landing.paths.share.text', icon: sendIcon },
    { id: 'chat', label: 'landing.try.tab.chat', text: 'landing.paths.chat.text', icon: chatIcon },
    { id: 'whiteboard', label: 'landing.try.tab.whiteboard', text: 'landing.paths.whiteboard.text', icon: whiteboardIcon },
  ];

  const loaders: Record<Exclude<Tab, 'send'>, () => Promise<{ default: any }>> = {
    chat: () => import('../tools/ChatCreate.svelte'),
    whiteboard: () => import('../tools/WhiteboardCreate.svelte'),
  };

  let active: Tab = 'send';
</script>

<div class="stack">
  <Tabs
    items={tabs.map((tab) => ({ id: tab.id, label: t(dict, tab.label), icon: tab.icon }))}
    bind:value={active}
    label={t(dict, 'landing.try.label')}
    idBase="home"
    variant="segmented"
  >
    {#snippet panel(id)}
      {@const tab = tabs.find((x) => x.id === id)!}
      <p class="hint">{t(dict, tab.text)}</p>
      {#if id === 'send'}
        <ShareForm {locale} {dict} />
      {:else}
        {#await loaders[id]()}
          <div class="home-quickstart-pending" role="status" aria-busy="true" aria-label={t(dict, 'common.working')}>
            <span class="home-quickstart-pending__line"></span>
            <span class="home-quickstart-pending__box"></span>
            <span class="home-quickstart-pending__line home-quickstart-pending__line--short"></span>
            <span class="home-quickstart-pending__btn"></span>
          </div>
        {:then mod}
          <svelte:component this={mod.default} {locale} {dict} />
        {/await}
      {/if}
    {/snippet}
  </Tabs>
</div>
