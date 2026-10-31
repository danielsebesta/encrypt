<script lang="ts">
  import { t } from '../../lib/t';
  import {
    LABEL_MAX, forgetRoom, saveRoom, touchRoom, validMode, validRoomId, validSecret, vaultState, getRoom,
    type RoomEntry, type RoomKind, type RoomSecret, type SaveResult, type VaultState,
  } from '../../lib/roomVault';

  let {
    dict,
    kind,
    roomId,
    mode,
    password = '',
    linkKey = null,
    ready = false,
    variant = 'icon',
  }: {
    dict: Record<string, string>;
    kind: RoomKind;
    roomId: string;
    mode: string;
    password?: string;
    linkKey?: string | null;
    ready?: boolean;
    variant?: 'icon' | 'menu';
  } = $props();

  let entry = $state<RoomEntry | null>(null);
  let vault = $state<VaultState>('names');
  let label = $state('');
  let busy = $state(false);
  let message = $state('');
  let tone = $state<'ok' | 'warn' | 'error'>('ok');
  let dialog = $state<HTMLDialogElement>();
  let host = $state('');
  let checked = false;

  const usable = $derived(validRoomId(roomId) && validMode(kind, mode));
  const secret = $derived.by((): RoomSecret | null => {
    const candidate: RoomSecret = linkKey ? { type: 'key', value: linkKey } : { type: 'password', value: password.trim() };
    return validSecret(candidate, mode) ? candidate : null;
  });
  const withPasskey = $derived(vault !== 'names' && Boolean(secret));
  const title = $derived(t(dict, entry ? 'rooms.savedButton' : 'rooms.saveTitle'));

  $effect(() => {
    if (!ready || !usable || checked) return;
    checked = true;
    void touchRoom(kind, roomId).then((found) => { entry = found; });
  });

  const MESSAGES: Record<SaveResult, [string, 'ok' | 'warn' | 'error']> = {
    saved: ['rooms.savedWithSecret', 'ok'],
    'saved-name': ['rooms.savedName', 'ok'],
    'no-prf': ['rooms.savedNoPrf', 'warn'],
    cancelled: ['rooms.saveCancelled', 'warn'],
    failed: ['rooms.saveFailed', 'error'],
  };

  async function openDialog() {
    message = '';
    host = location.hostname;
    label = entry?.label ?? roomId;
    vault = await vaultState();
    dialog?.showModal();
  }

  async function save(includeSecret: boolean) {
    if (busy) return;
    busy = true;
    message = '';
    const result = await saveRoom(
      { kind, roomId, mode, label },
      secret,
      { withSecret: includeSecret, passkeyName: t(dict, 'rooms.passkeyName').replace('{host}', host) },
    );
    entry = await getRoom(kind, roomId);
    vault = await vaultState();
    [message, tone] = [t(dict, MESSAGES[result][0]), MESSAGES[result][1]];
    busy = false;
  }

  async function forget() {
    if (!entry || busy) return;
    try {
      await forgetRoom(entry);
      entry = null;
      [message, tone] = [t(dict, 'rooms.forgotten'), 'ok'];
    } catch {
      [message, tone] = [t(dict, 'rooms.saveFailed'), 'error'];
    }
  }
</script>

{#if ready && usable}
  {#if variant === 'menu'}
    <button type="button" class="menu__item" aria-haspopup="dialog" onclick={openDialog}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={entry ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>{title}
    </button>
  {:else}
    <button type="button" class="btn-ghost btn-sm btn-icon" class:text-accent={Boolean(entry)} title={title} aria-label={title} aria-haspopup="dialog" onclick={openDialog}>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill={entry ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
    </button>
  {/if}

  <dialog bind:this={dialog} class="save-room card" aria-labelledby="save-room-title" aria-describedby="save-room-intro">
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void save(withPasskey); }}>
      <div>
        <h2 id="save-room-title" class="section-title">{title}</h2>
        <p id="save-room-intro" class="hint mt-1">{t(dict, withPasskey ? 'rooms.saveIntro' : 'rooms.saveNamesOnly')}</p>
        {#if withPasskey && vault === 'new'}
          <p class="hint mt-2">{t(dict, 'rooms.saveNewPasskey').replace('{host}', host)}</p>
        {/if}
      </div>
      <div class="field">
        <label class="label" for="save-room-label">{t(dict, 'rooms.renameLabel')}</label>
        <input id="save-room-label" class="input" type="text" maxlength={LABEL_MAX} bind:value={label} autocomplete="off" spellcheck="false" />
        <div class:mt-3={Boolean(message)} aria-live="polite">
          {#if message}
            <p class="status status--{tone}">{message}</p>
          {/if}
        </div>
      </div>
      <div class="actions">
        <button type="submit" class="btn" disabled={busy}>
          {t(dict, !withPasskey ? 'rooms.saveNameOnly' : vault === 'new' ? 'rooms.createAndSave' : 'rooms.saveWithPasskey')}
        </button>
        {#if withPasskey}
          <button type="button" class="btn-secondary" disabled={busy} onclick={() => save(false)}>{t(dict, 'rooms.saveNameOnly')}</button>
        {/if}
      </div>
      <div class="actions justify-between">
        {#if entry}
          <button type="button" class="btn-ghost btn-sm text-danger" disabled={busy} onclick={forget}>{t(dict, 'rooms.forget')}</button>
        {/if}
        <button type="button" class="btn-ghost btn-sm ml-auto" onclick={() => dialog?.close()}>{t(dict, 'rooms.close')}</button>
      </div>
    </form>
  </dialog>
{/if}

<style>
  .save-room {
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    margin: auto;
    color: var(--text);
    text-align: left;
    visibility: visible;
    box-shadow: var(--shadow-float);
    animation: save-room-in var(--duration-dialog) var(--ease-out);
  }
  .save-room::backdrop {
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(2px);
  }
  @keyframes save-room-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .save-room {
      animation: none;
    }
  }
</style>
