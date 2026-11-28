<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { t } from '../../lib/t';
  import { listContacts, type Contact } from '../../lib/contacts';
  import { identityState, warmIdentity, type IdentityKind } from '../../lib/identityVault';
  import { RECIPIENT_SLOTS } from '../../lib/recipientEnvelope';
  import type { Card } from '../../lib/identity';

  export let dict: Record<string, string>;
  export let selected: string[] = [];
  export let includeSelf = true;
  export let sign = true;
  export let keyPassword = '';
  export let error = '';
  export let contacts: Contact[] = [];
  export let own: { kind: IdentityKind; card: Card } | null = null;

  let loaded = false;

  async function load() {
    await warmIdentity();
    const [state, list] = await Promise.all([identityState(), listContacts()]);
    own = state.state === 'ready' ? { kind: state.kind, card: state.card } : null;
    contacts = list;
    selected = selected.filter((id) => list.some((c) => c.id === id));
    loaded = true;
  }

  onMount(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  $: count = selected.length + (own && includeSelf ? 1 : 0);
  $: full = count >= RECIPIENT_SLOTS;
  $: unverified = contacts.filter((c) => selected.includes(c.id) && !c.verified);

  function toggle(id: string, on: boolean) {
    selected = on ? [...selected.filter((s) => s !== id), id] : selected.filter((s) => s !== id);
  }
</script>

<fieldset class="field" aria-describedby={error ? 'rp-error rp-count' : 'rp-count'}>
  <legend class="label">{t(dict, 'tools.shareForm.recipients.label')}<span class="label__required" aria-hidden="true">*</span></legend>
  {#if !loaded}
    <p class="hint" role="status">{t(dict, 'common.working')}</p>
  {:else}
    {#if !contacts.length && !own}
      <p class="hint">{t(dict, 'tools.shareForm.recipients.empty')}</p>
    {/if}
    <div class="grid gap-1">
      {#if own}
        <label class="check">
          <input type="checkbox" bind:checked={includeSelf} disabled={!includeSelf && full} />
          <span>{t(dict, 'tools.shareForm.recipients.self')}</span>
        </label>
      {/if}
      {#each contacts as contact (contact.id)}
        {@const on = selected.includes(contact.id)}
        <label class="check">
          <input type="checkbox" checked={on} disabled={!on && full} on:change={(event) => toggle(contact.id, event.currentTarget.checked)} />
          <span class="min-w-0 truncate">{contact.name}</span>
          {#if !contact.verified}<span class="badge badge--warn">{t(dict, 'keys.contact.unverified')}</span>{/if}
        </label>
      {/each}
    </div>
    <p id="rp-count" class="hint">{t(dict, 'tools.shareForm.recipients.count').replace('{count}', String(count)).replace('{max}', String(RECIPIENT_SLOTS))}</p>
    {#if error}
      <p id="rp-error" class="field-error" role="alert">{error}</p>
    {/if}
    {#if unverified.length}
      <p class="status status--warn">{t(dict, 'tools.shareForm.recipients.unverified').replace('{names}', unverified.map((c) => c.name).join(', '))}</p>
    {/if}

    {#if own}
      <label class="check">
        <input type="checkbox" bind:checked={sign} />
        <span>{t(dict, 'tools.shareForm.recipients.sign').replace('{name}', own.card.name || '–')}</span>
      </label>
      <p class="hint">{t(dict, sign ? 'tools.shareForm.recipients.signHint' : 'tools.shareForm.recipients.anonymousHint')}</p>
      {#if sign && own.kind === 'password'}
        <div class="field">
          <label class="label" for="rp-key-password">{t(dict, 'keys.me.passwordLabel')}</label>
          <input id="rp-key-password" class="input" type="password" autocomplete="off" bind:value={keyPassword} />
        </div>
      {/if}
    {:else}
      <p class="hint">{t(dict, 'tools.shareForm.recipients.noKey')}</p>
    {/if}
    <a href="/keys" class="btn-link justify-self-start"><Icon name="user-key" />{t(dict, 'tools.shareForm.recipients.manage')}</a>
  {/if}
</fieldset>
