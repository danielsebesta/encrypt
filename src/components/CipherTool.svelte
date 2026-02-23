<script lang="ts">
  import dictionary from '../lib/dictionary.json';
  import { encrypt, decrypt, to14BitChunks, from14BitChunks } from '../lib/crypto';
  
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
        result = await decrypt(encryptedData, password);
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

<div class="space-y-6">
  <div class="flex border-b border-zinc-800">
    <button
      on:click={toggleMode}
      class="pb-2 px-4 transition-colors font-bold uppercase tracking-widest text-xs {mode === 'encrypt' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-300'}"
    >
      Encrypt
    </button>
    <button
      on:click={toggleMode}
      class="pb-2 px-4 transition-colors font-bold uppercase tracking-widest text-xs {mode === 'decrypt' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-300'}"
    >
      Decrypt
    </button>
  </div>

  <div class="space-y-4">
    <div class="space-y-2">
      <label for="password" class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Secret Password</label>
      <input
        id="password"
        type="password"
        bind:value={password}
        placeholder="Enter your security password..."
        class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono text-sm transition-colors"
        autocomplete="new-password"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        data-lpignore="true"
        data-1p-ignore
      />
    </div>

    <div class="space-y-2">
      <label for="input" class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
        {mode === 'encrypt' ? 'Input Text' : 'Words to Decrypt'}
      </label>
      <textarea
        id="input"
        bind:value={inputText}
        placeholder={mode === 'encrypt' ? 'Enter text to encrypt...' : 'Enter words to decrypt...'}
        class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono text-sm min-h-[160px] resize-none"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>
  </div>

  <button
    on:click={handleProcess}
    class="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold uppercase tracking-widest transition-colors shadow-lg shadow-emerald-900/10"
  >
    {mode === 'encrypt' ? 'Generate Words' : 'Recover Text'}
  </button>

  {#if error}
    <div class="p-4 bg-red-950/20 border border-red-900 text-red-400 text-xs font-mono">
      {error}
    </div>
  {/if}

  {#if result}
    <div class="space-y-2 pt-4">
      <label class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
        {mode === 'encrypt' ? 'Ciphertext Words' : 'Decrypted Output'}
      </label>
      <div class="p-4 bg-zinc-800/20 border border-zinc-800 font-mono text-emerald-400 break-words leading-relaxed select-all">
        {result}
      </div>
    </div>
  {/if}
</div>
