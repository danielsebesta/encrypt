<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import NewPassword from './NewPassword.svelte';
  import { t } from '../../lib/t';
  import { cardFromInput, cleanName, fingerprint, sameKeys, type Card } from '../../lib/identity';
  import {
    addContact, deleteContact, exportContacts, findContact, importContacts, listContacts, updateContact, type Contact,
  } from '../../lib/contacts';
  import { saveBytes, strongPassword } from './keysUi';

  export let dict: Record<string, string>;
  export let ownCard: Card | null = null;
  export let incoming = '';

  let contacts: Contact[] = [];
  let loaded = false;
  let error = '';
  let notice = '';
  let busy = '';

  let draft = '';
  let draftError = '';
  let opened: { card: Card; print: string; existing: Contact | null; clash: Contact | null } | null = null;
  let openedName = '';

  let editing = '';
  let editName = '';
  let confirmDeleteId = '';

  let transfer: 'none' | 'export' | 'import' = 'none';
  let exportPassword = '';
  let exportAttempted = false;
  let importInput: HTMLInputElement | undefined;
  let importFile: File | null = null;
  let importPassword = '';

  $: own = opened && ownCard ? sameKeys(opened.card, ownCard) : false;

  async function load() {
    contacts = await listContacts();
    loaded = true;
  }

  async function openCard(input: string): Promise<boolean> {
    const card = await cardFromInput(input);
    if (!card) return false;
    const existing = await findContact(card);
    opened = { card, print: await fingerprint(card), existing, clash: null };
    openedName = card.name;
    notice = '';
    error = '';
    await tick();
    document.getElementById('kc-opened')?.focus();
    return true;
  }

  onMount(load);

  $: if (loaded && incoming) void openIncoming(incoming);
  let lastIncoming = '';
  async function openIncoming(value: string) {
    if (value === lastIncoming) return;
    lastIncoming = value;
    await openCard(value);
  }

  async function submitDraft() {
    draftError = '';
    if (!(await openCard(draft))) {
      draftError = t(dict, 'keys.contacts.invalid');
      document.getElementById('kc-add')?.focus();
      return;
    }
    draft = '';
  }

  async function save(verified: boolean, allowSameName = false) {
    if (!opened || busy) return;
    busy = 'save';
    error = '';
    try {
      const result = await addContact(opened.card, openedName || opened.card.name, { verified, allowSameName });
      if (result.status === 'name-taken') {
        opened = { ...opened, clash: result.existing };
        return;
      }
      if (result.status === 'full') {
        error = t(dict, 'keys.contacts.full');
        return;
      }
      if (result.status === 'exists' && verified && !result.contact.verified) await updateContact(result.contact, { verified: true });
      opened = null;
      notice = t(dict, 'keys.saved');
      await load();
    } catch {
      error = t(dict, 'keys.error.failed');
    } finally {
      busy = '';
    }
  }

  async function setVerified(contact: Contact, verified: boolean) {
    await updateContact(contact, { verified });
    await load();
  }

  async function startEdit(contact: Contact) {
    editing = contact.id;
    editName = contact.name;
    await tick();
    document.getElementById(`kc-name-${contact.id}`)?.focus();
  }

  async function saveEdit(contact: Contact) {
    if (!cleanName(editName)) return;
    await updateContact(contact, { name: editName });
    editing = '';
    await load();
  }

  async function remove(contact: Contact) {
    await deleteContact(contact);
    confirmDeleteId = '';
    await load();
    await tick();
    document.getElementById('kc-add')?.focus();
  }

  async function runExport() {
    if (busy) return;
    exportAttempted = true;
    if (!strongPassword(exportPassword)) {
      document.getElementById('kc-export-password')?.focus();
      return;
    }
    busy = 'export';
    error = '';
    try {
      saveBytes(await exportContacts(exportPassword), 'encrypt-click-contacts.encryptcontacts');
      exportPassword = '';
      exportAttempted = false;
      transfer = 'none';
      notice = t(dict, 'keys.contacts.exported');
    } catch {
      error = t(dict, 'keys.error.failed');
    } finally {
      busy = '';
    }
  }

  async function runImport() {
    if (busy) return;
    if (!importFile || !importPassword) {
      error = t(dict, 'keys.contacts.badFile');
      return;
    }
    busy = 'import';
    error = '';
    try {
      const result = await importContacts(new Uint8Array(await importFile.arrayBuffer()), importPassword);
      if (!result) {
        error = t(dict, 'keys.contacts.badFile');
        return;
      }
      importPassword = '';
      importFile = null;
      transfer = 'none';
      notice = t(dict, 'keys.contacts.imported').replace('{added}', String(result.added)).replace('{skipped}', String(result.skipped));
      await load();
    } catch {
      error = t(dict, 'keys.error.failed');
    } finally {
      busy = '';
    }
  }
</script>

<section class="stack" aria-labelledby="kc-title">
  <h2 class="section-title" id="kc-title">{t(dict, 'keys.contacts.title')}</h2>

  {#if opened}
    <div class="panel stack" id="kc-opened" tabindex="-1" aria-labelledby="kc-opened-title">
      <p class="status__title" id="kc-opened-title">{t(dict, 'keys.card.title')}</p>
      <dl class="review">
        <div class="review__row">
          <dt>{t(dict, 'keys.card.cardName')}</dt>
          <dd class="review__value">{opened.card.name || '–'}</dd>
        </div>
        <div class="review__row">
          <dt>{t(dict, 'keys.fingerprint')}</dt>
          <dd class="font-mono tabular-nums">{opened.print}</dd>
        </div>
      </dl>
      {#if own}
        <p class="status status--ok">{t(dict, 'keys.card.own')}</p>
        <div class="actions"><button type="button" class="btn-ghost" on:click={() => { opened = null; }}>{t(dict, 'common.close')}</button></div>
      {:else if opened.existing}
        <p class="status status--ok">{t(dict, 'keys.card.exists').replace('{name}', opened.existing.name)}</p>
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          {#if !opened.existing.verified}
            <button type="button" class="btn" disabled={!!busy} on:click={() => save(true)}><Icon name="shield-check" />{t(dict, 'keys.card.markVerified')}</button>
          {/if}
          <button type="button" class="btn-ghost" on:click={() => { opened = null; }}>{t(dict, 'common.close')}</button>
        </div>
      {:else}
        <p class="hint">{t(dict, 'keys.card.compare')}</p>
        {#if opened.clash}
          <div class="status status--warn" role="alert">
            <div>
              <p class="status__title">{t(dict, 'keys.card.nameTakenTitle').replace('{name}', opened.clash.name)}</p>
              <p>{t(dict, 'keys.card.nameTaken')}</p>
            </div>
          </div>
        {/if}
        <div class="field">
          <label class="label" for="kc-opened-name">{t(dict, 'keys.card.nameLabel')}</label>
          <input id="kc-opened-name" class="input" type="text" maxlength="40" bind:value={openedName} />
        </div>
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          {#if opened.clash}
            <button type="button" class="btn-secondary" aria-busy={busy === 'save'} disabled={!!busy} on:click={() => save(false, true)}>{t(dict, 'keys.card.saveAnyway')}</button>
          {:else}
            <button type="button" class="btn" aria-busy={busy === 'save'} disabled={!!busy} on:click={() => save(true)}><Icon name="shield-check" />{t(dict, 'keys.card.saveVerified')}</button>
            <button type="button" class="btn-secondary" disabled={!!busy} on:click={() => save(false)}>{t(dict, 'keys.card.save')}</button>
          {/if}
          <button type="button" class="btn-ghost" on:click={() => { opened = null; }}>{t(dict, 'common.close')}</button>
        </div>
      {/if}
    </div>
  {/if}

  <form class="stack" novalidate on:submit|preventDefault={submitDraft}>
    <div class="field">
      <label class="label" for="kc-add">{t(dict, 'keys.contacts.addLabel')}</label>
      <input
        id="kc-add"
        class="input input--mono"
        type="text"
        autocomplete="off"
        spellcheck="false"
        bind:value={draft}
        aria-invalid={draftError ? 'true' : undefined}
        aria-describedby={draftError ? 'kc-add-error' : undefined}
        on:input={() => { draftError = ''; }}
      />
      {#if draftError}
        <p id="kc-add-error" class="field-error" role="alert">{draftError}</p>
      {/if}
    </div>
    <button type="submit" class="btn-secondary justify-self-start"><Icon name="user-key" />{t(dict, 'keys.contacts.add')}</button>
  </form>

  {#if loaded && contacts.length === 0}
    <p class="hint">{t(dict, 'keys.contacts.empty')}</p>
  {:else if contacts.length}
    <ul class="review m-0 list-none p-0" aria-label={t(dict, 'keys.contacts.title')}>
      {#each contacts as contact (contact.id)}
        <li class="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
          {#if editing === contact.id}
            <form class="flex flex-wrap items-end gap-2" on:submit|preventDefault={() => saveEdit(contact)}>
              <div class="field min-w-0 flex-1">
                <label class="label" for="kc-name-{contact.id}">{t(dict, 'keys.card.nameLabel')}</label>
                <input id="kc-name-{contact.id}" class="input" type="text" maxlength="40" bind:value={editName} />
              </div>
              <button type="submit" class="btn btn-sm">{t(dict, 'keys.me.renameSave')}</button>
              <button type="button" class="btn-ghost btn-sm" on:click={() => { editing = ''; }}>{t(dict, 'common.back')}</button>
            </form>
          {:else}
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 truncate font-semibold text-text">{contact.name}</span>
              {#if contact.verified}
                <span class="badge badge--accent"><Icon name="shield-check" />{t(dict, 'keys.contact.verified')}</span>
              {:else}
                <span class="badge badge--warn">{t(dict, 'keys.contact.unverified')}</span>
              {/if}
            </div>
            <p class="m-0 font-mono text-sm tabular-nums text-muted"><span class="sr-only">{t(dict, 'keys.fingerprint')}: </span>{contact.fingerprint}</p>
            {#if confirmDeleteId === contact.id}
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm text-text">{t(dict, 'keys.contact.deleteConfirm').replace('{name}', contact.name)}</span>
                <button type="button" class="btn-danger btn-sm" on:click={() => remove(contact)}>{t(dict, 'keys.me.deleteYes')}</button>
                <button type="button" class="btn-ghost btn-sm" on:click={() => { confirmDeleteId = ''; }}>{t(dict, 'common.back')}</button>
              </div>
            {:else}
              <div class="flex flex-wrap gap-1">
                <button type="button" class="btn-ghost btn-sm" aria-pressed={contact.verified} on:click={() => setVerified(contact, !contact.verified)}>
                  <Icon name="shield-check" />{t(dict, 'keys.contact.verify')}<span class="sr-only">: {contact.name}</span>
                </button>
                <button type="button" class="btn-ghost btn-sm" on:click={() => startEdit(contact)}><Icon name="pencil" />{t(dict, 'keys.me.rename')}<span class="sr-only">: {contact.name}</span></button>
                <button type="button" class="btn-ghost btn-sm" on:click={() => { confirmDeleteId = contact.id; }}><Icon name="trash" />{t(dict, 'keys.contact.delete')}<span class="sr-only">: {contact.name}</span></button>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if transfer === 'export'}
    <form class="stack" novalidate on:submit|preventDefault={runExport}>
      <NewPassword {dict} id="kc-export-password" label={t(dict, 'keys.contacts.filePassword')} hint={t(dict, 'keys.contacts.exportHint')} bind:value={exportPassword} attempted={exportAttempted} />
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <button type="submit" class="btn" aria-busy={busy === 'export'} disabled={!!busy}><Icon name="download" />{t(dict, 'keys.contacts.export')}</button>
        <button type="button" class="btn-ghost" on:click={() => { transfer = 'none'; exportAttempted = false; }}>{t(dict, 'common.back')}</button>
      </div>
    </form>
  {:else if transfer === 'import'}
    <form class="stack" novalidate on:submit|preventDefault={runImport}>
      <div class="field">
        <label class="label" for="kc-import-file">{t(dict, 'keys.contacts.importFile')}</label>
        <input id="kc-import-file" class="input" type="file" accept=".encryptcontacts,application/octet-stream" bind:this={importInput} on:change={() => { importFile = importInput?.files?.[0] ?? null; }} />
      </div>
      <div class="field">
        <label class="label" for="kc-import-password">{t(dict, 'keys.contacts.filePassword')}</label>
        <input id="kc-import-password" class="input" type="password" autocomplete="off" bind:value={importPassword} />
      </div>
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <button type="submit" class="btn" aria-busy={busy === 'import'} disabled={!!busy}><Icon name="upload" />{t(dict, 'keys.contacts.import')}</button>
        <button type="button" class="btn-ghost" on:click={() => { transfer = 'none'; }}>{t(dict, 'common.back')}</button>
      </div>
    </form>
  {:else}
    <div class="actions max-sm:flex-col max-sm:items-stretch">
      {#if contacts.length}
        <button type="button" class="btn-ghost" on:click={() => { transfer = 'export'; error = ''; notice = ''; }}><Icon name="download" />{t(dict, 'keys.contacts.export')}</button>
      {/if}
      <button type="button" class="btn-ghost" on:click={() => { transfer = 'import'; error = ''; notice = ''; }}><Icon name="upload" />{t(dict, 'keys.contacts.import')}</button>
    </div>
  {/if}

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if notice}
    <p class="status status--ok" role="status">{notice}</p>
  {/if}
</section>
