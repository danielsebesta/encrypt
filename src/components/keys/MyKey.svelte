<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import LinkWithQr from '../share/LinkWithQr.svelte';
  import NewPassword from './NewPassword.svelte';
  import { t } from '../../lib/t';
  import { cardLink, cleanName, fingerprint, renameIdentity, type Card } from '../../lib/identity';
  import {
    createPasskeyIdentity, createPasswordIdentity, exportBackup, finishPasskeyIdentity, forgetIdentity, identityState, importBackup,
    passkeyMaybe, renameStoredIdentity, restorePasskeyIdentity, unlockIdentity, warmIdentity, type IdentityState,
  } from '../../lib/identityVault';
  import { keyErrorText, saveBytes, strongPassword } from './keysUi';

  export let dict: Record<string, string>;

  const dispatch = createEventDispatcher<{ change: Card | null }>();

  let current: IdentityState | null = null;
  let print = '';
  let link = '';
  let canPasskey = false;
  let busy = '';
  let error = '';
  let notice = '';

  let name = '';
  let nameAttempted = false;
  let setup: 'choose' | 'password' | 'import' = 'choose';
  let newPassword = '';
  let passwordAttempted = false;
  let importInput: HTMLInputElement | undefined;
  let importFile: File | null = null;
  let importPassword = '';

  let renaming = false;
  let renameValue = '';
  let unlockPassword = '';
  let backupOpen = false;
  let backupPassword = '';
  let backupAttempted = false;
  let confirmDelete = false;

  $: ready = current?.state === 'ready' ? current : null;
  $: nameError = nameAttempted && !cleanName(name) ? t(dict, 'keys.error.nameRequired') : '';

  async function refresh() {
    await warmIdentity();
    current = await identityState();
    const card = current.state === 'ready' ? current.card : null;
    print = card ? await fingerprint(card) : '';
    link = card ? cardLink(card, location.origin) : '';
    dispatch('change', card);
  }

  onMount(async () => {
    canPasskey = await passkeyMaybe();
    await refresh();
  });

  function begin(action: string) {
    busy = action;
    error = '';
    notice = '';
  }

  async function createWithPasskey() {
    if (busy) return;
    nameAttempted = true;
    if (!cleanName(name)) {
      document.getElementById('mk-name')?.focus();
      return;
    }
    begin('passkey');
    try {
      const label = t(dict, 'keys.passkeyAccount').replace('{name}', cleanName(name));
      const result = await createPasskeyIdentity(name, label);
      if (result === 'ok' || result === 'pending') await refresh();
      else error = keyErrorText(dict, result);
    } finally {
      busy = '';
    }
  }

  async function finishSetup() {
    if (busy) return;
    begin('finish');
    try {
      const result = await finishPasskeyIdentity();
      if (result === 'ok') await refresh();
      else error = keyErrorText(dict, result);
    } finally {
      busy = '';
    }
  }

  async function restore() {
    if (busy) return;
    begin('restore');
    try {
      const result = await restorePasskeyIdentity(cleanName(name));
      if (result === 'ok') await refresh();
      else error = keyErrorText(dict, result);
    } finally {
      busy = '';
    }
  }

  async function createWithPassword() {
    if (busy) return;
    nameAttempted = true;
    passwordAttempted = true;
    if (!cleanName(name)) {
      document.getElementById('mk-name')?.focus();
      return;
    }
    if (!strongPassword(newPassword)) {
      document.getElementById('mk-password')?.focus();
      return;
    }
    begin('password');
    try {
      await createPasswordIdentity(name, newPassword);
      newPassword = '';
      passwordAttempted = false;
      setup = 'choose';
      await refresh();
    } catch {
      error = keyErrorText(dict, 'failed');
    } finally {
      busy = '';
    }
  }

  async function importKey() {
    if (busy) return;
    if (!importFile || !importPassword) {
      error = t(dict, 'keys.error.badBackup');
      return;
    }
    begin('import');
    try {
      const card = await importBackup(new Uint8Array(await importFile.arrayBuffer()), importPassword);
      if (!card) {
        error = t(dict, 'keys.error.badBackup');
        return;
      }
      importPassword = '';
      importFile = null;
      setup = 'choose';
      await refresh();
    } catch {
      error = keyErrorText(dict, 'failed');
    } finally {
      busy = '';
    }
  }

  async function startRename() {
    renaming = true;
    renameValue = ready?.card.name ?? '';
    unlockPassword = '';
    error = '';
    await tick();
    document.getElementById('mk-rename')?.focus();
  }

  async function saveRename() {
    if (busy || !ready) return;
    if (!cleanName(renameValue)) {
      error = t(dict, 'keys.error.nameRequired');
      return;
    }
    begin('rename');
    try {
      const unlocked = await unlockIdentity(unlockPassword || undefined);
      if ('error' in unlocked) {
        error = keyErrorText(dict, unlocked.error);
        return;
      }
      const renamed = await renameIdentity(unlocked.identity, renameValue);
      unlocked.identity.kemSecret.fill(0);
      await renameStoredIdentity(renamed.card.bytes);
      renaming = false;
      unlockPassword = '';
      await refresh();
      notice = t(dict, 'keys.saved');
    } catch {
      error = keyErrorText(dict, 'failed');
    } finally {
      busy = '';
    }
  }

  async function downloadBackup() {
    if (busy || !ready) return;
    if (ready.kind === 'passkey') {
      backupAttempted = true;
      if (!strongPassword(backupPassword)) {
        document.getElementById('mk-backup-password')?.focus();
        return;
      }
    }
    begin('backup');
    try {
      const result = await exportBackup(ready.kind === 'passkey' ? backupPassword : undefined);
      if (!(result instanceof Uint8Array)) {
        error = keyErrorText(dict, result.error);
        return;
      }
      saveBytes(result, 'encrypt-click-key.encryptkey');
      backupPassword = '';
      backupAttempted = false;
      backupOpen = false;
      notice = t(dict, 'keys.me.backupSaved');
    } catch {
      error = keyErrorText(dict, 'failed');
    } finally {
      busy = '';
    }
  }

  async function deleteKey() {
    if (busy) return;
    begin('delete');
    try {
      await forgetIdentity();
      confirmDelete = false;
      renaming = false;
      backupOpen = false;
      await refresh();
    } catch {
      error = keyErrorText(dict, 'failed');
    } finally {
      busy = '';
    }
  }

  $: passwordKind = ready?.kind === 'password';
</script>

<section class="stack" aria-labelledby="mk-title">
  <h2 class="section-title" id="mk-title">{t(dict, 'keys.me.title')}</h2>

  {#if current === null}
    <p class="hint" role="status">{t(dict, 'common.working')}</p>
  {:else if current.state === 'none'}
    <p class="hint">{t(dict, 'keys.me.empty')}</p>
    <div class="field">
      <label class="label" for="mk-name">{t(dict, 'keys.me.name')}<span class="label__required" aria-hidden="true">*</span></label>
      <input
        id="mk-name"
        class="input"
        type="text"
        maxlength="40"
        autocomplete="nickname"
        bind:value={name}
        aria-required="true"
        aria-invalid={nameError ? 'true' : undefined}
        aria-describedby={nameError ? 'mk-name-error mk-name-hint' : 'mk-name-hint'}
      />
      {#if nameError}
        <p id="mk-name-error" class="field-error" role="alert">{nameError}</p>
      {/if}
      <p id="mk-name-hint" class="hint">{t(dict, 'keys.me.nameHint')}</p>
    </div>

    {#if setup === 'choose'}
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        {#if canPasskey}
          <button type="button" class="btn" aria-busy={busy === 'passkey'} disabled={!!busy} on:click={createWithPasskey}><Icon name="fingerprint-pattern" />{t(dict, 'keys.me.createPasskey')}</button>
        {/if}
        <button type="button" class={canPasskey ? 'btn-secondary' : 'btn'} disabled={!!busy} on:click={() => { setup = 'password'; error = ''; }}><Icon name="key" />{t(dict, canPasskey ? 'keys.me.createPassword' : 'keys.me.createWithPassword')}</button>
      </div>
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        {#if canPasskey}
          <button type="button" class="btn-ghost" aria-busy={busy === 'restore'} disabled={!!busy} on:click={restore}><Icon name="rotate-ccw-key" />{t(dict, 'keys.me.restore')}</button>
        {/if}
        <button type="button" class="btn-ghost" disabled={!!busy} on:click={() => { setup = 'import'; error = ''; }}><Icon name="upload" />{t(dict, 'keys.me.import')}</button>
      </div>
      {#if canPasskey}
        <p class="hint">{t(dict, 'keys.me.passkeyHint')}</p>
      {/if}
    {:else if setup === 'password'}
      <form class="stack" novalidate on:submit|preventDefault={createWithPassword}>
        <NewPassword {dict} id="mk-password" label={t(dict, 'keys.me.passwordLabel')} hint={t(dict, 'keys.me.passwordHint')} bind:value={newPassword} attempted={passwordAttempted} />
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          <button type="submit" class="btn" aria-busy={busy === 'password'} disabled={!!busy}>{t(dict, 'keys.me.createWithPassword')}</button>
          <button type="button" class="btn-ghost" on:click={() => { setup = 'choose'; passwordAttempted = false; }}>{t(dict, 'common.back')}</button>
        </div>
      </form>
    {:else}
      <form class="stack" novalidate on:submit|preventDefault={importKey}>
        <div class="field">
          <label class="label" for="mk-import-file">{t(dict, 'keys.me.importFile')}</label>
          <input id="mk-import-file" class="input" type="file" accept=".encryptkey,application/octet-stream" bind:this={importInput} on:change={() => { importFile = importInput?.files?.[0] ?? null; }} />
        </div>
        <div class="field">
          <label class="label" for="mk-import-password">{t(dict, 'keys.me.importPassword')}</label>
          <input id="mk-import-password" class="input" type="password" autocomplete="off" bind:value={importPassword} />
        </div>
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          <button type="submit" class="btn" aria-busy={busy === 'import'} disabled={!!busy}>{t(dict, 'keys.me.importApply')}</button>
          <button type="button" class="btn-ghost" on:click={() => { setup = 'choose'; }}>{t(dict, 'common.back')}</button>
        </div>
      </form>
    {/if}
  {:else if current.state === 'pending'}
    <p class="status status--warn">{t(dict, 'keys.me.pending')}</p>
    <div class="actions max-sm:flex-col max-sm:items-stretch">
      <button type="button" class="btn" aria-busy={busy === 'finish'} disabled={!!busy} on:click={finishSetup}><Icon name="fingerprint-pattern" />{t(dict, 'keys.me.finish')}</button>
      <button type="button" class="btn-ghost" disabled={!!busy} on:click={deleteKey}>{t(dict, 'keys.me.startOver')}</button>
    </div>
  {:else if ready}
    <dl class="review">
      <div class="review__row">
        <dt>{t(dict, 'keys.me.name')}</dt>
        <dd class="review__value">{ready.card.name || '–'}</dd>
      </div>
      <div class="review__row">
        <dt>{t(dict, 'keys.fingerprint')}</dt>
        <dd class="font-mono tabular-nums">{print}</dd>
      </div>
      <div class="review__row">
        <dt>{t(dict, 'keys.me.protection')}</dt>
        <dd>{t(dict, ready.kind === 'passkey' ? 'keys.me.protectedPasskey' : 'keys.me.protectedPassword')}</dd>
      </div>
    </dl>

    <LinkWithQr
      id="mk-card"
      url={link}
      label={t(dict, 'keys.me.cardLink')}
      copyLabel={t(dict, 'common.copy')}
      copiedLabel={t(dict, 'common.copied')}
      qrLabel={t(dict, 'keys.qr')}
      qrAlt={t(dict, 'keys.qrAlt')}
      hint={t(dict, 'keys.me.cardHint')}
    />

    {#if renaming}
      <form class="stack" novalidate on:submit|preventDefault={saveRename}>
        <div class="field">
          <label class="label" for="mk-rename">{t(dict, 'keys.me.name')}</label>
          <input id="mk-rename" class="input" type="text" maxlength="40" bind:value={renameValue} />
        </div>
        {#if passwordKind}
          <div class="field">
            <label class="label" for="mk-unlock">{t(dict, 'keys.me.passwordLabel')}</label>
            <input id="mk-unlock" class="input" type="password" autocomplete="off" bind:value={unlockPassword} />
          </div>
        {/if}
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          <button type="submit" class="btn" aria-busy={busy === 'rename'} disabled={!!busy}>{t(dict, 'keys.me.renameSave')}</button>
          <button type="button" class="btn-ghost" on:click={() => { renaming = false; }}>{t(dict, 'common.back')}</button>
        </div>
      </form>
    {/if}

    {#if backupOpen}
      <form class="stack" novalidate on:submit|preventDefault={downloadBackup}>
        {#if ready.kind === 'passkey'}
          <NewPassword {dict} id="mk-backup-password" label={t(dict, 'keys.me.backupPassword')} hint={t(dict, 'keys.me.backupHint')} bind:value={backupPassword} attempted={backupAttempted} />
        {:else}
          <p class="hint">{t(dict, 'keys.me.backupSamePassword')}</p>
        {/if}
        <div class="actions max-sm:flex-col max-sm:items-stretch">
          <button type="submit" class="btn" aria-busy={busy === 'backup'} disabled={!!busy}><Icon name="download" />{t(dict, 'keys.me.backup')}</button>
          <button type="button" class="btn-ghost" on:click={() => { backupOpen = false; backupAttempted = false; }}>{t(dict, 'common.back')}</button>
        </div>
      </form>
    {/if}

    {#if confirmDelete}
      <div class="status status--warn">
        <div>
          <p class="status__title">{t(dict, 'keys.me.deleteConfirm')}</p>
          {#if ready.kind === 'passkey'}<p>{t(dict, 'keys.me.deletePasskeyNote')}</p>{/if}
        </div>
      </div>
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <button type="button" class="btn-danger" aria-busy={busy === 'delete'} disabled={!!busy} on:click={deleteKey}><Icon name="trash" />{t(dict, 'keys.me.deleteYes')}</button>
        <button type="button" class="btn-ghost" on:click={() => { confirmDelete = false; }}>{t(dict, 'common.back')}</button>
      </div>
    {/if}

    {#if !renaming && !backupOpen && !confirmDelete}
      <div class="actions max-sm:flex-col max-sm:items-stretch">
        <button type="button" class="btn-secondary" disabled={!!busy} on:click={() => { backupOpen = true; error = ''; notice = ''; }}><Icon name="download" />{t(dict, 'keys.me.backup')}</button>
        <button type="button" class="btn-ghost" disabled={!!busy} on:click={startRename}><Icon name="pencil" />{t(dict, 'keys.me.rename')}</button>
        <button type="button" class="btn-ghost" disabled={!!busy} on:click={() => { confirmDelete = true; error = ''; notice = ''; }}><Icon name="trash" />{t(dict, 'keys.me.delete')}</button>
      </div>
    {/if}
  {/if}

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if notice}
    <p class="status status--ok" role="status">{notice}</p>
  {/if}
</section>
