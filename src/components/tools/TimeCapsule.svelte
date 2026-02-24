<script lang="ts">
  import { onMount } from 'svelte';
  import { timelockEncrypt, timelockDecrypt, mainnetClient, defaultChainInfo, Buffer } from 'tlock-js';

  const client = mainnetClient();

  let mode: 'encrypt' | 'decrypt' = 'encrypt';

  let message = '';
  let targetLocal = '';
  let ciphertext = '';

  let decryptInput = '';
  let decrypted = '';

  let error = '';
  let decryptError = '';
  let loading = false;
  let decryptLoading = false;

  let debugUtc = '';
  let debugUnix = '';
  let debugRound: number | null = null;

  let manualUnix = '';
  let useManualUnix = false;

  const nowIsoLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  function updateDerived() {
    debugUtc = '';
    debugUnix = '';
    debugRound = null;
    if (!targetLocal) return;
    const localDate = new Date(targetLocal);
    const timeMs = localDate.getTime();
    if (!Number.isFinite(timeMs)) return;
    const chain = defaultChainInfo as any;
    const genesisMs = chain.genesis_time * 1000;
    const periodMs = chain.period * 1000;
    const round = Math.floor((timeMs - genesisMs) / periodMs) + 1;
    debugUtc = new Date(timeMs).toISOString();
    debugUnix = String(Math.floor(timeMs / 1000));
    debugRound = round > 0 ? round : null;
  }

  onMount(() => {
    targetLocal = nowIsoLocal();
    updateDerived();
  });

  async function handleEncrypt() {
    error = '';
    ciphertext = '';
    decrypted = '';

    if (!message.trim()) {
      error = 'Please enter a message.';
      return;
    }

    let timeMs: number;

    if (useManualUnix && manualUnix.trim()) {
      const unix = Number(manualUnix.trim());
      if (!Number.isFinite(unix) || unix <= 0) {
        error = 'Invalid Unix timestamp.';
        return;
      }
      timeMs = unix * 1000;
    } else {
      if (!targetLocal) {
        error = 'Please choose an unlock time.';
        return;
      }
      const localDate = new Date(targetLocal);
      timeMs = localDate.getTime();
    }
    if (!Number.isFinite(timeMs)) {
      error = 'Invalid date.';
      return;
    }

    const now = Date.now();
    if (timeMs <= now) {
      error = 'Unlock time must be in the future.';
      return;
    }

    loading = true;
    try {
      const chain = defaultChainInfo as any;
      const genesisMs = chain.genesis_time * 1000;
      const periodMs = chain.period * 1000;

      if (!Number.isFinite(timeMs)) {
        throw new Error('Invalid beacon time.');
      }
      if (timeMs < genesisMs) {
        throw new Error('Unlock time must be after the drand network genesis.');
      }

      const round = Math.floor((timeMs - genesisMs) / periodMs) + 1;

      const payload = Buffer.from(message, 'utf8');
      const armored = await timelockEncrypt(round, payload, client);

      const meta = [
        'timecapsule:v1',
        `round=${round}`,
        `not_before=${new Date(timeMs).toISOString()}`
      ].join('\n');

      ciphertext = `${meta}\n\n${armored}`;
      updateDerived();
    } catch (e: any) {
      error = e?.message || 'Failed to encrypt.';
    } finally {
      loading = false;
    }
  }

  function parseMetadata(input: string) {
    const lines = input.trim().split('\n');
    if (!lines[0] || !lines[0].startsWith('timecapsule:v1')) {
      return { round: null, notBefore: null, armored: input.trim() };
    }
    let round: number | null = null;
    let notBefore: string | null = null;
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        break;
      }
      if (line.startsWith('round=')) {
        const v = Number(line.slice('round='.length));
        if (!isNaN(v)) round = v;
      } else if (line.startsWith('not_before=')) {
        notBefore = line.slice('not_before='.length);
      }
    }
    const armored = lines.slice(i).join('\n').trim();
    return { round, notBefore, armored };
  }

  async function handleDecrypt() {
    decryptError = '';
    decrypted = '';

    const input = decryptInput.trim();
    if (!input) {
      decryptError = 'Paste a ciphertext to decrypt.';
      return;
    }

    decryptLoading = true;
    try {
      const meta = parseMetadata(input);
      const buf = await timelockDecrypt(meta.armored, client);
      decrypted = new TextDecoder().decode(buf);
    } catch (e: any) {
      const meta = parseMetadata(decryptInput);
      const label = meta.notBefore || 'the unlock time (UTC)';
      decryptError = `Too early or invalid ciphertext. This message is locked until ${label}.`;
    } finally {
      decryptLoading = false;
    }
  }
</script>

<div class="space-y-8">
  <div class="inline-flex rounded-full bg-zinc-100 dark:bg-zinc-900/70 p-1 text-xs font-semibold">
    <button
      type="button"
      class="px-4 py-1.5 rounded-full transition-colors"
      class:bg-white={mode === 'encrypt'}
      class:text-zinc-900={mode === 'encrypt'}
      class:text-zinc-500={mode !== 'encrypt'}
      on:click={() => (mode = 'encrypt')}
    >
      Create capsule
    </button>
    <button
      type="button"
      class="px-4 py-1.5 rounded-full transition-colors"
      class:bg-white={mode === 'decrypt'}
      class:text-zinc-900={mode === 'decrypt'}
      class:text-zinc-500={mode !== 'decrypt'}
      on:click={() => (mode = 'decrypt')}
    >
      Open capsule
    </button>
  </div>

  {#if mode === 'encrypt'}
    <div class="space-y-6">
      <div class="space-y-2">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="tc-message">
          Message
        </label>
        <textarea
          id="tc-message"
          class="input min-h-[140px] resize-vertical font-mono text-xs"
          bind:value={message}
          placeholder="Write something your future self (or someone else) can only read later..."
        />
      </div>

      <div class="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end">
        <div class="space-y-2">
          <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="tc-date">
            Unlock after
          </label>
          <input
            id="tc-date"
            type="datetime-local"
            class="input"
            bind:value={targetLocal}
            on:change={updateDerived}
          />
        </div>
        <button class="btn w-full md:w-auto" type="button" on:click={handleEncrypt} disabled={loading}>
          {#if loading}
            Encrypting...
          {:else}
            Lock message
          {/if}
        </button>
      </div>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}

      <details class="text-xs text-zinc-500">
        <summary class="cursor-pointer select-none">Advanced timing details</summary>
        <div class="mt-2 space-y-1">
          <p>
            <span class="font-semibold">Local time:</span>
            <span class="ml-1">{targetLocal || '—'}</span>
          </p>
          {#if debugUtc}
            <p>
              <span class="font-semibold">UTC:</span>
              <span class="ml-1">{debugUtc}</span>
            </p>
            <p>
              <span class="font-semibold">Unix timestamp (s):</span>
              <span class="ml-1">{debugUnix}</span>
            </p>
            {#if debugRound}
              <p>
                <span class="font-semibold">Drand round:</span>
                <span class="ml-1">{debugRound}</span>
              </p>
            {/if}
          {/if}
          <div class="mt-2 space-y-1">
            <label class="block font-semibold" for="tc-manual-unix">
              Manual Unix timestamp (seconds, optional)
            </label>
            <input
              id="tc-manual-unix"
              type="number"
              class="input"
              bind:value={manualUnix}
              placeholder="Override using a Unix timestamp"
            />
            <label class="inline-flex items-center gap-2 mt-1 text-[11px]">
              <input type="checkbox" bind:checked={useManualUnix} />
              <span>Use manual Unix timestamp instead of the picker</span>
            </label>
          </div>
        </div>
      </details>

      {#if ciphertext}
        <div class="space-y-2">
          <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="tc-output">
            Ciphertext
          </label>
          <textarea
            id="tc-output"
            class="input min-h-[180px] resize-vertical font-mono text-[11px]"
            readonly
            value={ciphertext}
          />
        </div>
      {/if}
    </div>
  {:else}
    <div class="space-y-6">
      <div class="space-y-2">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="tc-cipher">
          Ciphertext
        </label>
        <textarea
          id="tc-cipher"
          class="input min-h-[160px] resize-vertical font-mono text-[11px]"
          bind:value={decryptInput}
          placeholder="Paste a Time Capsule ciphertext block here..."
        />
      </div>

      <button class="btn w-full md:w-auto" type="button" on:click={handleDecrypt} disabled={decryptLoading}>
        {#if decryptLoading}
          Decrypting...
        {:else}
          Open capsule
        {/if}
      </button>

      {#if decryptError}
        <p class="text-xs text-red-500">{decryptError}</p>
      {/if}

      {#if decrypted}
        <div class="space-y-2">
          <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500">Message</h3>
          <div class="card p-4 text-left text-sm font-mono whitespace-pre-wrap break-words">
            {decrypted}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

