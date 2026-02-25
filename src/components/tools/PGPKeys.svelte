<script lang="ts">
  import { generatePGPKeyPair } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let name = '';
  let email = '';
  let passphrase = '';
  let rsaBits = 4096;
  let isGenerating = false;
  let keyPair: { publicKey: string; privateKey: string } | null = null;
  let error = '';

  async function generate() {
    error = '';
    keyPair = null;
    if (!name.trim() || !email.trim()) {
      error = t(dict, 'tools.pgpKeys.nameEmailRequired');
      return;
    }
    isGenerating = true;
    try {
      keyPair = await generatePGPKeyPair({ name: name.trim(), email: email.trim(), passphrase, rsaBits });
    } catch (e: any) {
      console.error(e);
      error = e?.message || t(dict, 'tools.pgpKeys.failedToGenerate');
    } finally {
      isGenerating = false;
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid md:grid-cols-2 gap-4">
      <div class="space-y-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider" for="pgp-name">
          {t(dict, 'tools.pgpKeys.name')}
        </label>
        <input
          id="pgp-name"
          class="input"
          bind:value={name}
          placeholder={t(dict, 'tools.pgpKeys.namePlaceholder')}
          autocomplete="name"
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider" for="pgp-email">
          {t(dict, 'tools.pgpKeys.email')}
        </label>
        <input
          id="pgp-email"
          class="input"
          type="email"
          bind:value={email}
          placeholder={t(dict, 'tools.pgpKeys.emailPlaceholder')}
          autocomplete="email"
        />
      </div>
    </div>

    <div class="grid md:grid-cols-2 gap-4">
      <div class="space-y-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider" for="pgp-pass">
          {t(dict, 'tools.pgpKeys.keyPassphrase')}
        </label>
        <input
          id="pgp-pass"
          class="input"
          type="password"
          bind:value={passphrase}
          autocomplete="new-password"
          placeholder={t(dict, 'tools.pgpKeys.passphrasePlaceholder')}
        />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider" for="pgp-bits">
          {t(dict, 'tools.pgpKeys.rsaStrength')}
        </label>
        <select id="pgp-bits" bind:value={rsaBits} class="input">
          <option value={2048}>{t(dict, 'tools.pgpKeys.bit2048')}</option>
          <option value={4096}>{t(dict, 'tools.pgpKeys.bit4096')}</option>
        </select>
      </div>
    </div>

    <button
      on:click={generate}
      disabled={isGenerating}
      class="btn w-full py-4 uppercase tracking-widest text-xs font-black"
    >
      {isGenerating ? t(dict, 'tools.pgpKeys.generatingKeys') : t(dict, 'tools.pgpKeys.generateBtn')}
    </button>

    {#if error}
      <p class="text-xs text-red-500">{error}</p>
    {/if}

    {#if keyPair}
      <div class="space-y-6 animate-in slide-in-from-bottom-2">
        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
              {t(dict, 'tools.pgpKeys.publicKey')}
            </label>
            <button
              type="button"
              on:click={() => copy(keyPair!.publicKey)}
              class="text-[10px] text-emerald-600 font-bold hover:underline"
            >
              {t(dict, 'tools.pgpKeys.copy')}
            </button>
          </div>
          <pre
            class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-[10px] overflow-auto max-h-52 break-all select-all"
          >{keyPair.publicKey}</pre>
        </div>

        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <label
              class="text-[10px] text-zinc-400 font-bold uppercase tracking-widest text-amber-600"
            >
              {t(dict, 'tools.pgpKeys.privateKey')}
            </label>
            <button
              type="button"
              on:click={() => copy(keyPair!.privateKey)}
              class="text-[10px] text-emerald-600 font-bold hover:underline"
            >
              {t(dict, 'tools.pgpKeys.copy')}
            </button>
          </div>
          <pre
            class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-[10px] overflow-auto max-h-52 break-all select-all text-amber-700 dark:text-amber-500"
          >{keyPair.privateKey}</pre>
        </div>
      </div>
    {/if}
  </div>
</div>

