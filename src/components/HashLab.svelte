<script lang="ts">
  import { getTranslations, t } from '../lib/i18n';
  export let locale = 'en';
  let file: File | null = null;
  let hash256 = '';
  let hash512 = '';
  let isLoading = false;
  let compareHash = '';
  let match: boolean | null = null;
  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      file = target.files[0];
      await calculateHashes();
    }
  }
  async function calculateHashes() {
    if (!file) return;
    isLoading = true;
    hash256 = '';
    hash512 = '';
    try {
      const buffer = await file.arrayBuffer();
      const digest256 = await crypto.subtle.digest('SHA-256', buffer);
      hash256 = Array.from(new Uint8Array(digest256))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const digest512 = await crypto.subtle.digest('SHA-512', buffer);
      hash512 = Array.from(new Uint8Array(digest512))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      console.error('Hashing failed', e);
    } finally {
      isLoading = false;
      checkMatch();
    }
  }
  function checkMatch() {
    if (!compareHash || (!hash256 && !hash512)) {
      match = null;
      return;
    }
    const cleanCompare = compareHash.trim().toLowerCase();
    match = cleanCompare === hash256 || cleanCompare === hash512;
  }
  $: if (compareHash) checkMatch();
  $: dict = getTranslations(locale);
</script>

<div class="form space-y-5">
  <div class="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors relative group bg-white dark:bg-zinc-900/40">
    <input
      type="file"
      on:change={handleFileChange}
      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
    />
    <div class="space-y-1.5 pointer-events-none">
      <div class="text-zinc-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors text-sm">
        {#if file}
          <span class="text-emerald-600 dark:text-emerald-400 font-semibold">{file.name}</span>
        {:else}
          {t(dict, 'tools.hashLab.dropFile')}
        {/if}
      </div>
      <div class="text-xs text-zinc-400 dark:text-zinc-600">
        {t(dict, 'tools.hashLab.noDataLeaves')}
      </div>
    </div>
  </div>
  {#if isLoading}
    <div class="animate-pulse text-emerald-600 dark:text-emerald-400 text-sm italic">
      {t(dict, 'tools.hashLab.calculating')}
    </div>
  {/if}
  {#if hash256}
    <div class="space-y-4 text-[11px] md:text-xs">
      <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 dark:text-zinc-400">SHA-256</label>
        <div class="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg break-all text-zinc-700 dark:text-zinc-300 select-all font-mono">
          {hash256}
        </div>
      </div>
      <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 dark:text-zinc-400">SHA-512</label>
        <div class="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg break-all text-zinc-700 dark:text-zinc-300 select-all font-mono">
          {hash512}
        </div>
      </div>
      <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800">
        <label for="compare" class="text-xs text-zinc-500 dark:text-zinc-400 block mb-1.5">{t(dict, 'tools.hashLab.compareHash')}</label>
        <div class="relative">
          <input
            id="compare"
            type="text"
            bind:value={compareHash}
            placeholder={t(dict, 'tools.hashLab.pastePlaceholder')}
            class="input"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
          />
          {#if match !== null}
            <div class="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-xs">
              {#if match}
                <span class="text-emerald-600 dark:text-emerald-400">✓ {t(dict, 'tools.hashLab.match')}</span>
              {:else}
                <span class="text-red-500">✗ {t(dict, 'tools.hashLab.mismatch')}</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
