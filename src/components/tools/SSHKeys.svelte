<script lang="ts">
  import { generateSSHKeyPair } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let bits = 4096;
  let isGenerating = false;
  let keyPair: { publicKey: string; privateKey: string } | null = null;

  async function generate() {
    isGenerating = true;
    try {
      keyPair = await generateSSHKeyPair(bits);
    } catch (e) {
      console.error(e);
      keyPair = null;
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
    <div class="grid gap-1.5">
      <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.sshKeys.keyType')}</label>
      <div class="text-xs text-zinc-500 dark:text-zinc-400">
        RSA (OpenSSH <code class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900/60">ssh-rsa</code> format)
      </div>
    </div>

    <div class="grid gap-1.5">
      <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.sshKeys.keyBitLength')}</label>
      <select bind:value={bits} class="input">
        <option value={2048}>{t(dict, 'tools.sshKeys.bit2048')}</option>
        <option value={4096}>{t(dict, 'tools.sshKeys.bit4096')}</option>
      </select>
    </div>

    <button
      on:click={generate}
      disabled={isGenerating}
      class="btn w-full py-4 uppercase tracking-widest text-xs font-black"
    >
      {isGenerating ? t(dict, 'tools.sshKeys.generatingKeys') : t(dict, 'tools.sshKeys.generateBtn')}
    </button>

    {#if keyPair}
      <div class="space-y-6 animate-in slide-in-from-bottom-2">
        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
              {t(dict, 'tools.sshKeys.publicKey')}
            </label>
            <button
              type="button"
              on:click={() => copy(keyPair!.publicKey)}
              class="text-[10px] text-emerald-600 font-bold hover:underline"
            >
              {t(dict, 'tools.sshKeys.copy')}
            </button>
          </div>
          <pre
            class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-[10px] max-h-40 whitespace-pre-wrap break-all select-all"
          >{keyPair.publicKey}</pre>
        </div>

        <div class="space-y-2">
          <div class="flex justify-between items-end">
            <label
              class="text-[10px] text-zinc-400 font-bold uppercase tracking-widest text-amber-600"
            >
              {t(dict, 'tools.sshKeys.privateKey')}
            </label>
            <button
              type="button"
              on:click={() => copy(keyPair!.privateKey)}
              class="text-[10px] text-emerald-600 font-bold hover:underline"
            >
              {t(dict, 'tools.sshKeys.copy')}
            </button>
          </div>
          <pre
            class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-[10px] overflow-x-auto overflow-y-auto max-h-40 whitespace-pre select-all text-amber-700 dark:text-amber-500"
          >{keyPair.privateKey}</pre>
        </div>
      </div>
    {/if}
  </div>
</div>

