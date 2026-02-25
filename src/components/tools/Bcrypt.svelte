<script lang="ts">
  import { bcryptHash, bcryptVerify } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);
  let input = '';
  let salt = 10;
  let hashResult = '';
  
  let verifyHash = '';
  let verifyResult: boolean | null = null;
  let isVerifying = false;

  async function handleHash() {
    if (!input) return;
    hashResult = await bcryptHash(input, salt);
  }

  async function handleVerify() {
    if (!input || !verifyHash) return;
    isVerifying = true;
    try {
      verifyResult = await bcryptVerify(input, verifyHash);
    } finally {
      isVerifying = false;
    }
  }
</script>

<div class="space-y-10 animate-in fade-in duration-500">
  <!-- Hash Section -->
  <div class="space-y-4">
    <div class="flex items-center gap-2 mb-2">
        <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
        <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-500">{t(dict, 'tools.bcrypt.generateHash')}</h3>
    </div>
    <div class="grid gap-4">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-medium">{t(dict, 'tools.bcrypt.cleartextInput')}</label>
            <input bind:value={input} placeholder={t(dict, 'tools.bcrypt.hashPlaceholder')} class="input" />
        </div>
        <div class="flex gap-3">
            <button on:click={handleHash} class="btn flex-1">{t(dict, 'tools.bcrypt.generateBtn')}</button>
            <div class="grid gap-1.5">
                <input type="number" bind:value={salt} min="4" max="15" class="input w-20 text-center" title={t(dict, 'tools.bcrypt.costRounds')} />
            </div>
        </div>
        {#if hashResult}
            <div class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-xs break-all select-all shadow-sm">
                {hashResult}
            </div>
        {/if}
    </div>
  </div>

  <!-- Verify Section -->
  <div class="space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
    <div class="flex items-center gap-2 mb-2">
        <div class="w-2 h-2 rounded-full bg-blue-500"></div>
        <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-500">{t(dict, 'tools.bcrypt.verifyHashTitle')}</h3>
    </div>
    <div class="grid gap-4">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-medium">{t(dict, 'tools.bcrypt.hashToCompare')}</label>
            <input bind:value={verifyHash} placeholder={t(dict, 'tools.bcrypt.pasteHash')} class="input font-mono text-xs" />
        </div>
        <button on:click={handleVerify} class="btn-secondary w-full" disabled={isVerifying}>
            {isVerifying ? t(dict, 'tools.bcrypt.computing') : t(dict, 'tools.bcrypt.verifyMatch')}
        </button>
        
        {#if verifyResult !== null}
            <div class="p-6 rounded-2xl text-center border-2 {verifyResult ? 'bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-900/50' : 'bg-red-50 border-red-100 text-red-600 dark:bg-red-950/20 dark:border-red-900/50'} animate-in zoom-in-95">
                {#if verifyResult}
                    <div class="text-xl font-black italic tracking-tighter">{t(dict, 'tools.bcrypt.matchConfirmed')}</div>
                    <div class="text-xs opacity-80 uppercase tracking-widest mt-1">{t(dict, 'tools.bcrypt.matchText')}</div>
                {:else}
                    <div class="text-xl font-black italic tracking-tighter text-red-600">{t(dict, 'tools.bcrypt.invalidMatch')}</div>
                    <div class="text-xs opacity-80 uppercase tracking-widest mt-1">{t(dict, 'tools.bcrypt.invalidText')}</div>
                {/if}
            </div>
        {/if}
    </div>
  </div>
</div>
