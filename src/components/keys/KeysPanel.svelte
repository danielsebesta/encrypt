<script lang="ts">
  import { onMount } from 'svelte';
  import MyKey from './MyKey.svelte';
  import Contacts from './Contacts.svelte';
  import { t } from '../../lib/t';
  import type { Card } from '../../lib/identity';

  export let dict: Record<string, string>;

  let ownCard: Card | null = null;
  let incoming = '';

  function takeHash() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    incoming = hash;
    history.replaceState(null, '', location.pathname + location.search);
  }

  onMount(() => {
    takeHash();
    window.addEventListener('hashchange', takeHash);
    return () => window.removeEventListener('hashchange', takeHash);
  });
</script>

<div class="stack gap-8">
  <MyKey {dict} on:change={(event) => { ownCard = event.detail; }} />
  <Contacts {dict} {ownCard} {incoming} />
  <p class="hint">{t(dict, 'keys.storageNote')}</p>
</div>
