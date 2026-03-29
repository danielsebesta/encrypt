<script lang="ts">
  import { generateRoomKey } from '../../lib/chatCrypto';

  let mode: 'auto' | 'password' = 'auto';
  let generatedLink = '';
  let copied = false;

  function genRoomId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }

  async function createRoom() {
    const roomId = genRoomId();
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';

    if (mode === 'auto') {
      const key = await generateRoomKey();
      generatedLink = `${origin}/chat/${roomId}#${key}`;
    } else {
      generatedLink = `${origin}/chat/${roomId}`;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(generatedLink);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {}
  }

  function openRoom() {
    if (generatedLink) window.location.href = generatedLink;
  }
</script>

<div class="space-y-5">
  {#if !generatedLink}
    <div class="flex gap-2 justify-center">
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {mode === 'auto' ? 'bg-emerald-500 text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}"
        on:click={() => mode = 'auto'}
      >
        Auto-key in link
      </button>
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {mode === 'password' ? 'bg-emerald-500 text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}"
        on:click={() => mode = 'password'}
      >
        Password protected
      </button>
    </div>

    <p class="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
      {#if mode === 'auto'}
        The encryption key is embedded in the link. Anyone with the link can read messages.
      {:else}
        Everyone who joins will need to enter the same password. Share the password separately from the link.
      {/if}
    </p>

    <button class="btn w-full" on:click={createRoom}>Create room</button>

  {:else}
    <div class="space-y-3">
      <div class="ue-passphrase-box">
        <input class="ue-passphrase-input flex-1" type="text" readonly value={generatedLink} />
        <button class="ue-passphrase-refresh" on:click={copyLink}>
          {#if copied}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {/if}
        </button>
      </div>

      {#if mode === 'password'}
        <p class="text-xs text-amber-500">Share a password separately — everyone entering this room will need it.</p>
      {:else}
        <p class="text-xs text-zinc-400 dark:text-zinc-500">The key is in the link. Share it carefully.</p>
      {/if}

      <button class="btn w-full" on:click={openRoom}>Enter room</button>
    </div>
  {/if}
</div>
