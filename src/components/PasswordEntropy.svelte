<script lang="ts">
  import dictionary from '../lib/dictionary.json';

  let password = '';
  let generatedPassword = '';
  let wordCount = 6;
  
  function calculateEntropy(pwd: string): number {
    if (!pwd) return 0;
    
    let poolSize = 0;
    if (/[a-z]/.test(pwd)) poolSize += 26;
    if (/[A-Z]/.test(pwd)) poolSize += 26;
    if (/[0-9]/.test(pwd)) poolSize += 10;
    if (/[^a-zA-Z0-9]/.test(pwd)) poolSize += 32;
    
    // Add Czech characters to pool if detected
    if (/[ěščřžýáíéóúůťňď]/.test(pwd)) poolSize += 15;

    return Math.floor(pwd.length * Math.log2(poolSize || 1));
  }

  function generateDiceware() {
    const words: string[] = [];
    const randomValues = new Uint32Array(wordCount);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < wordCount; i++) {
        // Use mod to map random value to dictionary index (16384 is 2^14, so it's clean)
        const index = randomValues[i] % dictionary.length;
        words.push(dictionary[index]);
    }
    generatedPassword = words.join('-');
  }

  $: entropy = calculateEntropy(password);
  
  function getStrengthColor(bits: number) {
    if (bits === 0) return 'bg-zinc-800';
    if (bits < 40) return 'bg-red-500';
    if (bits < 80) return 'bg-yellow-500';
    return 'bg-emerald-500';
  }

  function getStrengthLabel(bits: number) {
    if (bits === 0) return 'Waiting...';
    if (bits < 40) return 'Weak / Hackable';
    if (bits < 60) return 'Moderate';
    if (bits < 100) return 'Strong';
    return 'Very Strong / Paranoid';
  }
</script>

<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
  <div class="space-y-6">
    <div>
      <h3 class="text-zinc-400 uppercase font-bold text-[10px] tracking-widest mb-4">Entropy Analyzer</h3>
      <div class="space-y-4">
        <input
          type="text"
          bind:value={password}
          placeholder="Type a password to test..."
          class="w-full bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 outline-none focus:border-emerald-500 font-mono transition-colors"
          autocomplete="off"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          data-lpignore="true"
          data-1p-ignore
        />
        
        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <span class="text-[10px] uppercase font-bold text-zinc-600">{getStrengthLabel(entropy)}</span>
            <span class="text-sm font-mono text-emerald-500 font-bold">{entropy} bits</span>
          </div>
          <div class="h-1 bg-zinc-900 overflow-hidden">
            <div 
              class={`h-full transition-all duration-500 ${getStrengthColor(entropy)}`} 
              style={`width: ${Math.min(100, (entropy / 128) * 100)}%`}
            ></div>
          </div>
        </div>

        <p class="text-[10px] text-zinc-500 leading-relaxed italic border-l border-zinc-800 pl-3">
          Entropy is a measure of randomness. A password with >80 bits is generally considered secure against modern brute-force attacks.
        </p>
      </div>
    </div>
  </div>

  <div class="space-y-6">
    <div>
      <h3 class="text-zinc-400 uppercase font-bold text-[10px] tracking-widest mb-4">Diceware Generator</h3>
      <div class="space-y-6 p-6 border border-zinc-800/30 bg-zinc-950/20">
        <div class="flex items-center justify-between">
          <label class="text-[10px] text-zinc-500 uppercase font-bold">Word Count: {wordCount}</label>
          <input type="range" min="3" max="10" bind:value={wordCount} class="accent-emerald-500 h-1" />
        </div>
        
        <button 
          on:click={generateDiceware}
          class="w-full py-3 border border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 font-bold uppercase text-[11px] tracking-widest transition-all"
        >
          Generate Secret Phrase
        </button>

        {#if generatedPassword}
          <div class="space-y-2">
            <div class="p-4 bg-zinc-950 border border-emerald-500/20 text-emerald-400 font-mono text-sm break-words select-all text-center">
              {generatedPassword}
            </div>
            <div class="text-[9px] text-zinc-600 text-center uppercase tracking-tighter">
              Each word adds ~14 bits of entropy. Total: {wordCount * 14} bits.
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
