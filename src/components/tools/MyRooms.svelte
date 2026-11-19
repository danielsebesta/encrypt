<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import PasskeyExplain from './PasskeyExplain.svelte';
  import {
    LABEL_MAX, compareRooms, forgetEverything, forgetRoom, listRooms, openRoom, relativeTime, renameRoom, setRoomPinned, unlockVault, vaultState,
    type RoomEntry, type VaultState,
  } from '../../lib/roomVault';
  import Icon from '../Icon.svelte';

  let { dict, locale = 'en' }: { dict: Record<string, string>; locale?: string } = $props();

  let rooms = $state<RoomEntry[]>([]);
  let vault = $state<VaultState>('names');
  let loaded = $state(false);
  let busy = $state(false);
  let opening = $state<string | null>(null);
  let error = $state('');
  let notice = $state('');
  let query = $state('');
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let confirming = $state<string | null>(null);
  let confirmAll = $state(false);
  let now = $state(Date.now());
  let headingEl = $state<HTMLHeadingElement>();

  const locked = $derived(vault === 'locked' && rooms.some((room) => room.secret));
  const relative = $derived(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  const needle = $derived(query.trim().toLocaleLowerCase(locale));
  const filtered = $derived(
    needle
      ? rooms.filter((room) => room.label.toLocaleLowerCase(locale).includes(needle))
      : rooms,
  );

  async function refresh() {
    rooms = await listRooms();
    vault = await vaultState();
    now = Date.now();
    loaded = true;
  }

  onMount(() => {
    void refresh();
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  });

  function modeLabel(room: RoomEntry): string {
    if (room.kind === 'whiteboard') return t(dict, 'rooms.mode.board');
    return t(dict, room.mode === 'live' ? 'rooms.mode.live' : 'rooms.mode.ttl');
  }

  function secretLabel(room: RoomEntry): string {
    return t(dict, room.secret ? 'rooms.passwordSaved' : 'rooms.needsPassword');
  }

  function visited(room: RoomEntry): string {
    const { value, unit } = relativeTime(room.lastSeen, now);
    return t(dict, 'rooms.lastVisit').replace('{time}', relative.format(value, unit));
  }

  async function unlock() {
    if (busy) return;
    error = '';
    busy = true;
    const ok = await unlockVault();
    busy = false;
    if (ok) vault = 'unlocked';
    else error = t(dict, 'rooms.unlockFailed');
  }

  async function open(room: RoomEntry) {
    if (busy) return;
    error = '';
    busy = true;
    opening = room.id;
    const ok = await openRoom(room, locale);
    busy = false;
    opening = null;
    if (!ok) error = t(dict, 'rooms.unlockFailed');
  }

  async function togglePin(room: RoomEntry) {
    error = '';
    try {
      const next = await setRoomPinned(room, !room.pinned);
      rooms = rooms.map((r) => (r.id === next.id ? next : r)).sort(compareRooms);
    } catch {
      error = t(dict, 'rooms.saveFailed');
    }
  }

  async function startRename(room: RoomEntry, index: number) {
    confirming = null;
    renaming = room.id;
    renameValue = room.label;
    await tick();
    document.getElementById(`my-room-${index}-input`)?.focus();
  }

  async function finishRename(room: RoomEntry, index: number, save: boolean) {
    if (save) {
      try {
        const next = await renameRoom(room, renameValue);
        rooms = rooms.map((r) => (r.id === next.id ? next : r));
      } catch {
        error = t(dict, 'rooms.saveFailed');
      }
    }
    renaming = null;
    await tick();
    document.getElementById(`my-room-${index}-rename`)?.focus();
  }

  async function forget(room: RoomEntry) {
    try {
      await forgetRoom(room);
      rooms = rooms.filter((r) => r.id !== room.id);
      notice = t(dict, 'rooms.forgotten');
    } catch {
      error = t(dict, 'rooms.saveFailed');
    }
    confirming = null;
    await tick();
    headingEl?.focus();
  }

  async function forgetAll() {
    try {
      await forgetEverything();
      rooms = [];
      query = '';
      notice = t(dict, 'rooms.forgotAll');
      vault = await vaultState();
    } catch {
      error = t(dict, 'rooms.saveFailed');
    }
    confirmAll = false;
    await tick();
    headingEl?.focus();
  }
</script>

{#if loaded}
  <section class="stack border-t border-line-soft pt-5" aria-labelledby="my-rooms-title">
    <div>
      <h2 id="my-rooms-title" class="section-title" tabindex="-1" bind:this={headingEl}>{t(dict, 'rooms.title')}</h2>
      <p class="hint mt-1">{t(dict, 'rooms.intro')}</p>
      <div class="grid gap-3" class:mt-4={Boolean(notice || error)} aria-live="polite">
        {#if notice}
          <p class="status status--ok">{notice}</p>
        {/if}
        {#if error}
          <p class="status status--error">{error}</p>
        {/if}
      </div>
    </div>

    {#if rooms.length === 0}
      <div class="empty">
        <Icon name="bookmark" size={20} class="empty__icon" />
        <p class="empty__title">{t(dict, 'rooms.empty')}</p>
        <p>{t(dict, 'rooms.emptyHint')}</p>
      </div>
    {:else}
      {#if vault === 'names'}
        <p class="status status--warn">{t(dict, 'rooms.namesOnly')}</p>
      {:else if locked}
        <div class="status items-center justify-between gap-3">
          <p class="flex items-center gap-2 font-semibold">
            <Icon name="lock" size={20} class="shrink-0 text-accent-strong" />
            {t(dict, 'rooms.locked')}
          </p>
          <button type="button" class="btn btn-sm shrink-0" onclick={unlock} aria-busy={busy && !opening ? 'true' : undefined}>{t(dict, 'rooms.unlock')}</button>
        </div>
      {/if}

      <div class="field">
        <label class="label" for="my-rooms-search">{t(dict, 'rooms.search')}</label>
        <input
          id="my-rooms-search"
          class="input"
          type="search"
          bind:value={query}
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="search"
        />
      </div>

      {#if filtered.length === 0}
        <div class="empty" role="status">
          <Icon name="search" size={20} class="empty__icon" />
          <p class="empty__title">{t(dict, 'rooms.searchEmpty')}</p>
          <p>{t(dict, 'rooms.searchEmptyHint')}</p>
        </div>
      {:else}
        <ul class="grid gap-2">
          {#each filtered as room, i (room.id)}
            <li class="panel grid gap-3">
              {#if renaming === room.id}
                <form class="field" onsubmit={(event) => { event.preventDefault(); void finishRename(room, i, true); }}>
                  <label class="label" for="my-room-{i}-input">{t(dict, 'rooms.renameLabel')}</label>
                  <input id="my-room-{i}-input" class="input" type="text" maxlength={LABEL_MAX} bind:value={renameValue} autocomplete="off" spellcheck="false" onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); void finishRename(room, i, false); } }} />
                  <div class="actions mt-1">
                    <button type="submit" class="btn btn-sm">{t(dict, 'rooms.save')}</button>
                    <button type="button" class="btn-ghost btn-sm" onclick={() => finishRename(room, i, false)}>{t(dict, 'rooms.cancel')}</button>
                  </div>
                </form>
              {:else}
                <div class="min-w-0">
                  <p id="my-room-{i}-label" class="font-semibold text-text break-words">
                    {#if room.pinned}
                      <span class="mr-1.5 inline-flex align-middle text-accent-strong" title={t(dict, 'rooms.pinned')}>
                        <Icon name="pin" />
                        <span class="sr-only">{t(dict, 'rooms.pinned')}</span>
                      </span>
                    {/if}
                    {room.label}
                  </p>
                  <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <span class="badge">{t(dict, `rooms.kind.${room.kind}`)}</span>
                    <span>{modeLabel(room)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{visited(room)}</span>
                  </p>
                  <p class="mt-1 flex items-center gap-1.5 text-sm" class:text-accent-strong={Boolean(room.secret)} class:text-muted={!room.secret}>
                    <Icon name={room.secret ? 'check' : 'x'} />
                    {secretLabel(room)}
                  </p>
                </div>
                {#if confirming === room.id}
                  <div class="grid gap-2">
                    <p class="text-sm text-text">{t(dict, 'rooms.forgetConfirm').replace('{name}', room.label)}</p>
                    <div class="actions">
                      <button type="button" class="btn-secondary btn-sm text-danger" onclick={() => forget(room)}>{t(dict, 'rooms.forget')}</button>
                      <button type="button" class="btn-ghost btn-sm" onclick={() => { confirming = null; }}>{t(dict, 'rooms.cancel')}</button>
                    </div>
                  </div>
                {:else}
                  <div class="actions gap-2">
                    <button type="button" class="btn btn-sm" aria-describedby="my-room-{i}-label" onclick={() => open(room)} disabled={busy && opening !== room.id} aria-busy={opening === room.id ? 'true' : undefined}>{t(dict, 'rooms.open')}</button>
                    <button
                      type="button"
                      class="btn-ghost btn-sm"
                      aria-describedby="my-room-{i}-label"
                      aria-pressed={Boolean(room.pinned)}
                      onclick={() => togglePin(room)}
                    >{t(dict, room.pinned ? 'rooms.unpin' : 'rooms.pin')}</button>
                    <button type="button" id="my-room-{i}-rename" class="btn-ghost btn-sm" aria-describedby="my-room-{i}-label" onclick={() => startRename(room, i)}>{t(dict, 'rooms.rename')}</button>
                    <button type="button" class="btn-ghost btn-sm text-danger" aria-describedby="my-room-{i}-label" onclick={() => { renaming = null; confirming = room.id; }}>{t(dict, 'rooms.forget')}</button>
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <details class="more">
        <summary>{t(dict, 'rooms.aboutTitle')}</summary>
        <div class="more__body">
          {#if vault !== 'names'}
            <PasskeyExplain {dict} />
          {/if}
          <ul class="grid gap-2 text-sm text-muted">
            <li>{t(dict, 'rooms.about1')}</li>
            <li>{t(dict, 'rooms.about2')}</li>
          </ul>
          {#if confirmAll}
            <div class="grid gap-2">
              <p class="text-sm text-text">{t(dict, 'rooms.forgetAllConfirm')}</p>
              <div class="actions">
                <button type="button" class="btn-secondary btn-sm text-danger" onclick={forgetAll}>{t(dict, 'rooms.forgetAll')}</button>
                <button type="button" class="btn-ghost btn-sm" onclick={() => { confirmAll = false; }}>{t(dict, 'rooms.cancel')}</button>
              </div>
            </div>
          {:else}
            <button type="button" class="btn-ghost btn-sm justify-self-start text-danger" onclick={() => { confirmAll = true; }}>{t(dict, 'rooms.forgetAll')}</button>
          {/if}
        </div>
      </details>
    {/if}
  </section>
{/if}
