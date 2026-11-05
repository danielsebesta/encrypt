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
    myKeyCode,
    ontrust,
    onverify,
  }: {
    dict: Record<string, string>;
    appMode?: boolean;
    members: Member[];
    online: Set<string>;
    verified: Set<string>;
    myKeyCode: string;
    ontrust: (pk: string) => void;
    onverify: (pk: string, ok: boolean) => void;
  } = $props();

  let openPk = $state('');
  let differs = $state<Record<string, boolean>>({});

  const here = $derived(members.filter((member) => online.has(member.pk)));
  const earlier = $derived(members.filter((member) => !online.has(member.pk)));

  function toggle(pk: string) {
    openPk = openPk === pk ? '' : pk;
  }

  function mismatch(pk: string) {
    differs[pk] = true;
    onverify(pk, false);
  }
</script>

{#snippet row(member: Member)}
  <div class="chat-member chat-member--col" class:chat-member--warn={!member.trusted || differs[member.pk]}>
    <button type="button" class="chat-member__head" aria-expanded={openPk === member.pk} onclick={() => toggle(member.pk)}>
      <span class="chat-avatar chat-avatar--sm" style="background: {gradientFor(member.alias, member.name)}" aria-hidden="true"></span>
      <span class="chat-member__name">{member.name}</span>
      {#if !member.trusted}
        <span class="chat-key-warn">{t(dict, 'chat.keyNew')}</span>
      {:else if verified.has(member.pk)}
        <span class="chat-member__verified">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
          {t(dict, 'chat.verified')}
        </span>
      {/if}
      <svg class="chat-member__chevron" class:chat-member__chevron--open={openPk === member.pk} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['chevron-down']}</svg>
    </button>
    {#if openPk === member.pk}
      <div class="chat-member__panel">
        {#if !member.trusted}
          <p class="hint">{t(dict, 'chat.keyNewHint')}</p>
          <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal' : 'btn-outline btn-sm'} onclick={() => ontrust(member.pk)}>{t(dict, 'chat.keyTrust')}</button>
        {:else}
          <p class="hint">{t(dict, 'chat.verifyHint')}</p>
          <p class="chat-member__emoji chat-member__safety" aria-label={member.safety}>
            {#each member.safety.split(' ') as group}<span>{group}</span>{/each}
          </p>
          {#if differs[member.pk]}
            <p class="status status--error" role="alert">{t(dict, 'chat.verifyMismatchWarn')}</p>
          {:else if verified.has(member.pk)}
            <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal' : 'btn-ghost btn-sm'} onclick={() => onverify(member.pk, false)}>{t(dict, 'chat.verifyReset')}</button>
          {:else}
            <div class="chat-member__actions">
              <button type="button" class={appMode ? 'app-sheet-btn' : 'btn btn-sm'} onclick={() => onverify(member.pk, true)}>{t(dict, 'chat.verifyMatch')}</button>
              <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal' : 'btn-outline btn-sm'} onclick={() => mismatch(member.pk)}>{t(dict, 'chat.verifyMismatch')}</button>
            </div>
          {/if}
          <details class="chat-member__details">
            <summary>{t(dict, 'chat.memberDetails')}</summary>
            <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')}</span><span class="chat-member__emoji" aria-label={member.code}>{member.code}</span></p>
          </details>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if members.length === 0}
  <p class="hint">{t(dict, 'chat.noMembersYet')}</p>
{/if}
{#if here.length > 0}
  <p class="chat-members__heading">{t(dict, 'chat.membersOnline')}</p>
  {#each here as member (member.pk)}{@render row(member)}{/each}
{/if}
{#if earlier.length > 0}
  <p class="chat-members__heading">{t(dict, 'chat.membersEarlier')}</p>
  <div class="chat-members__earlier">
    {#each earlier as member (member.pk)}{@render row(member)}{/each}
  </div>
{/if}
{#if myKeyCode}
  <details class="chat-member__details chat-member__mine">
    <summary>{t(dict, 'chat.memberDetails')}</summary>
    <p class="chat-member__line"><span class="hint">{t(dict, 'chat.keyCode')} · {t(dict, 'chat.you')}</span><span class="chat-member__emoji" aria-label={myKeyCode}>{myKeyCode}</span></p>
    <p class="hint">{t(dict, 'chat.safetyNumberHint')}</p>
  </details>
{/if}

<style>
  .chat-member { display: flex; align-items: flex-start; gap: 0.6rem; }
  .chat-member--warn { padding: 0.5rem; border-radius: 0.6rem; background: rgba(240, 178, 50, 0.12); }
  .chat-member__name { font-size: 0.85rem; font-weight: 700; color: var(--text); }
  .chat-member__line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem; }
  .chat-member__emoji { display: inline-flex; flex-wrap: wrap; gap: 0.2rem; font-size: 1.15rem; line-height: 1.3; letter-spacing: 0.05em; color: var(--text); }
  .chat-member__safety { gap: 0.3rem; font-size: 1.5rem; margin: 0; }
  .chat-key-warn {
    display: inline-flex; align-items: center; padding: 0 0.4rem; border-radius: 999px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
    color: rgb(122, 75, 0); background: rgb(253, 230, 138);
  }
  :global(.dark) .chat-key-warn { color: rgb(253, 230, 138); background: rgba(240, 178, 50, 0.22); }
  .chat-member--col { display: flex; flex-direction: column; align-items: stretch; gap: 0.25rem; }
  .chat-member__head {
    display: flex; align-items: center; gap: 0.6rem; width: 100%;
    background: none; border: 0; padding: 0.15rem 0; color: inherit; text-align: start; cursor: pointer;
  }
  .chat-member__head .chat-member__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-member__verified {
    display: inline-flex; align-items: center; gap: 0.2rem;
    font-size: 0.75rem; font-weight: 600; color: #2e9e4d;
  }
  .chat-member__chevron { flex-shrink: 0; opacity: 0.55; transition: transform 0.15s ease; }
  .chat-member__chevron--open { transform: rotate(180deg); }
  .chat-member__panel { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.25rem 0 0.5rem 2.6rem; align-items: flex-start; }
  .chat-member__actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .chat-member__details summary { cursor: pointer; font-size: 0.8125rem; opacity: 0.7; }
  .chat-member__mine { margin-top: 0.75rem; }
  .chat-members__heading { margin: 0.75rem 0 0.15rem; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.6; }
  .chat-members__earlier { opacity: 0.78; }
</style>
