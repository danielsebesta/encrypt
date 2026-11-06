<script lang="ts">
  import { t } from '../../lib/t';
  import { gradientFor, type Alias } from '../../lib/alias';
  import { LUCIDE } from '../../lib/lucideIcons';

  type Member = {
    pk: string;
    name: string;
    alias?: Alias;
    trusted: boolean;
    safety: string;
    code: string;
  };

  let {
    dict,
    appMode = false,
    members,
    online,
    verified,
    self = '',
    ontrust,
    onverify,
  }: {
    dict: Record<string, string>;
    appMode?: boolean;
    members: Member[];
    online: Set<string>;
    verified: Set<string>;
    self?: string;
    ontrust: (pk: string) => void;
    onverify: (pk: string, ok: boolean) => void;
  } = $props();

  let openPk = $state('');
  let differs = $state<Record<string, boolean>>({});

  const others = $derived(members.filter((member) => member.pk !== self));
  const here = $derived(others.filter((member) => online.has(member.pk)));
  const earlier = $derived(others.filter((member) => !online.has(member.pk)));

  function toggle(pk: string) {
    openPk = openPk === pk ? '' : pk;
  }

  function mismatch(pk: string) {
    differs[pk] = true;
    onverify(pk, false);
  }

  function memberState(member: Member): 'warn' | 'verified' | 'plain' {
    if (!member.trusted || differs[member.pk]) return 'warn';
    return verified.has(member.pk) ? 'verified' : 'plain';
  }

  function status(member: Member): string {
    const s = memberState(member);
    if (s === 'warn') return differs[member.pk] ? t(dict, 'chat.verifyMismatchShort') : t(dict, 'chat.keyNew');
    if (s === 'verified') return t(dict, 'chat.verified');
    return t(dict, 'chat.notVerified');
  }

  const btn = (kind: 'primary' | 'tonal') => appMode
    ? (kind === 'primary' ? 'app-sheet-btn' : 'app-sheet-btn app-sheet-btn--tonal')
    : (kind === 'primary' ? 'btn btn-sm' : 'btn-secondary btn-sm');
</script>

{#snippet row(member: Member)}
  {@const s = memberState(member)}
  <li class="chat-member" class:chat-member--open={openPk === member.pk}>
    <button type="button" class="chat-member__head" aria-expanded={openPk === member.pk} onclick={() => toggle(member.pk)}>
      <span class="chat-avatar chat-member__avatar" style="background: {gradientFor(member.alias, member.name)}" aria-hidden="true">
        {#if online.has(member.pk)}<span class="chat-member__dot"></span>{/if}
      </span>
      <span class="chat-member__text">
        <span class="chat-member__name">{member.name}</span>
        <span class="chat-member__status chat-member__status--{s}">{status(member)}</span>
      </span>
      {#if s === 'verified'}
        <svg class="chat-member__shield chat-member__shield--ok" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['shield-check']}</svg>
      {:else if s === 'warn'}
        <svg class="chat-member__shield chat-member__shield--warn" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['shield']}<path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      {/if}
      <svg class="chat-member__chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['chevron-down']}</svg>
    </button>
    {#if openPk === member.pk}
      <div class="chat-member__panel">
        {#if !member.trusted}
          <p class="chat-member__hint">{t(dict, 'chat.keyNewHint')}</p>
          <button type="button" class={btn('tonal')} onclick={() => ontrust(member.pk)}>{t(dict, 'chat.keyTrust')}</button>
        {:else}
          <p class="chat-member__hint">{t(dict, 'chat.verifyHint')}</p>
          <p class="chat-member__safety" aria-label={member.safety}>
            {#each member.safety.split(' ') as group}<span>{group}</span>{/each}
          </p>
          {#if differs[member.pk]}
            <p class="status status--error" role="alert">{t(dict, 'chat.verifyMismatchWarn')}</p>
          {:else if verified.has(member.pk)}
            <button type="button" class={btn('tonal')} onclick={() => onverify(member.pk, false)}>{t(dict, 'chat.verifyReset')}</button>
          {:else}
            <div class="chat-member__actions">
              <button type="button" class={btn('primary')} onclick={() => onverify(member.pk, true)}>{t(dict, 'chat.verifyMatch')}</button>
              <button type="button" class={btn('tonal')} onclick={() => mismatch(member.pk)}>{t(dict, 'chat.verifyMismatch')}</button>
            </div>
          {/if}
          <p class="chat-member__code"><span>{t(dict, 'chat.keyCode')}</span><span class="chat-member__code-value" aria-label={member.code}>{member.code}</span></p>
        {/if}
      </div>
    {/if}
  </li>
{/snippet}

{#if others.length === 0}
  <p class="chat-members__empty">{t(dict, 'chat.noMembersYet')}</p>
{/if}
{#if here.length > 0}
  <p class="chat-members__heading">{t(dict, 'chat.membersOnline')} · {here.length}</p>
  <ul class="chat-members__list">{#each here as member (member.pk)}{@render row(member)}{/each}</ul>
{/if}
{#if earlier.length > 0}
  <p class="chat-members__heading">{t(dict, 'chat.membersEarlier')}</p>
  <ul class="chat-members__list">{#each earlier as member (member.pk)}{@render row(member)}{/each}</ul>
{/if}

<style>
  .chat-members__heading {
    margin: 0.5rem 0 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--muted);
  }
  .chat-members__empty { margin: 0.25rem 0; font-size: 0.875rem; color: var(--muted); }
  .chat-members__list {
    list-style: none; margin: 0; padding: 0;
    border-radius: 0.875rem; background: var(--surface-2); overflow: hidden;
  }
  .chat-member + .chat-member { border-top: 1px solid var(--line-soft); }
  .chat-member__head {
    display: flex; align-items: center; gap: 0.75rem; width: 100%; min-height: 3.25rem;
    background: none; border: 0; padding: 0.5rem 0.75rem; color: inherit; text-align: start; cursor: pointer;
  }
  .chat-member__head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 0.875rem; }
  .chat-member__avatar { width: 36px; height: 36px; flex: none; position: relative; box-shadow: none; }
  .chat-member__dot {
    position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%;
    background: #34c759; box-shadow: 0 0 0 2px var(--surface-2);
  }
  .chat-member__text { flex: 1; min-width: 0; display: grid; }
  .chat-member__name { font-size: 0.9375rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-member__status { font-size: 0.8125rem; color: var(--muted); }
  .chat-member__status--verified { color: var(--accent); }
  .chat-member__status--warn { color: #b26b00; }
  :global(.dark) .chat-member__status--warn, :global(:root[data-app-scheme="dark"]) .chat-member__status--warn { color: #f0b232; }
  .chat-member__shield { flex: none; }
  .chat-member__shield--ok { color: var(--accent); }
  .chat-member__shield--warn { color: #b26b00; }
  :global(.dark) .chat-member__shield--warn, :global(:root[data-app-scheme="dark"]) .chat-member__shield--warn { color: #f0b232; }
  .chat-member__chevron { flex: none; color: var(--muted); transition: transform 0.18s ease; }
  .chat-member--open .chat-member__chevron { transform: rotate(180deg); }
  .chat-member__panel {
    display: grid; gap: 0.75rem; padding: 0.25rem 0.75rem 0.875rem calc(0.75rem + 36px + 0.75rem); justify-items: start;
  }
  .chat-member__hint { margin: 0; font-size: 0.8125rem; line-height: 1.4; color: var(--muted); }
  .chat-member__safety {
    margin: 0; width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem 0.75rem;
    padding: 0.75rem; border-radius: 0.75rem; background: var(--surface);
    font-size: 1.75rem; line-height: 1.2;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  }
  .chat-member__actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .chat-member__code { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--muted); }
  .chat-member__code-value { font-size: 1rem; letter-spacing: 0.08em; }
  @media (prefers-reduced-motion: reduce) { .chat-member__chevron { transition: none; } }
</style>
