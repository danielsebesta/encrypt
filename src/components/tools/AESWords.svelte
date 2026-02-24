<script lang="ts">
  import dictionary from '../../lib/dictionary.json';
  import { encrypt, decrypt as decryptMsg, to14BitChunks, from14BitChunks } from '../../lib/crypto';
  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let inputText = '';
  let password = '';
  let result = '';
  let error = '';
  async function handleProcess() {
    error = '';
    result = '';
    if (!inputText || !password) {
      error = 'Please enter both text and a password.';
      return;
    }
    try {
      if (mode === 'encrypt') {
        const encryptedData = await encrypt(inputText, password);
        const chunks = to14BitChunks(encryptedData);
        const words = chunks.map(index => dictionary[index]);
        result = words.join(' ');
      } else {
        const words = inputText.trim().split(/\s+/);
        const chunks = words.map(word => {
          const index = dictionary.indexOf(word.toLowerCase());
          if (index === -1) throw new Error(`Word not found in dictionary: ${word}`);
          return index;
        });
        const encryptedData = from14BitChunks(chunks);
        result = await decryptMsg(encryptedData, password);
      }
    } catch (e: any) {
      error = e.message || 'An error occurred during processing. Check your password or input.';
    }
  }
  function toggleMode() {
    mode = mode === 'encrypt' ? 'decrypt' : 'encrypt';
    inputText = '';
    result = '';
    error = '';
  }
</script>

<div class="form space-y-5">
  <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
    <button
      on:click={toggleMode}
      class="pb-2.5 px-4 text-sm font-medium transition-colors {mode === 'encrypt' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}"
    >
      Encrypt
    </button>
    <button
      on:click={toggleMode}
      class="pb-2.5 px-4 text-sm font-medium transition-colors {mode === 'decrypt' ? 'text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}"
    >
      Decrypt
    </button>
  </div>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <label for="cipher-password" class="text-xs text-zinc-500 dark:text-zinc-400">Secret password</label>
      <input
        id="cipher-password"
        type="password"
        bind:value={password}
        placeholder="Enter your security password..."
        class="input"
        autocomplete="new-password"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        data-lpignore="true"
        data-1p-ignore
      />
    </div>
    <div class="grid gap-1.5">
      <label for="cipher-input" class="text-xs text-zinc-500 dark:text-zinc-400">
        {mode === 'encrypt' ? 'Input text' : 'Words to decrypt'}
      </label>
      <textarea
        id="cipher-input"
        bind:value={inputText}
        placeholder={mode === 'encrypt' ? 'Enter text to encrypt...' : 'Enter words to decrypt...'}
        class="input min-h-[140px] resize-none"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>
  </div>
  <button
    on:click={handleProcess}
    class="btn w-full"
  >
    {mode === 'encrypt' ? 'Generate words' : 'Recover text'}
  </button>
  {#if error}
    <div class="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm rounded-lg">
      {error}
    </div>
  {/if}
  {#if result}
    <div class="grid gap-1.5 pt-2">
      <label class="text-xs text-zinc-500 dark:text-zinc-400">
        {mode === 'encrypt' ? 'Ciphertext words' : 'Decrypted output'}
      </label>
      <div class="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-lg font-mono text-emerald-700 dark:text-emerald-400 break-words leading-relaxed select-all text-sm">
        {result}
      </div>
    </div>
  {/if}
</div>
