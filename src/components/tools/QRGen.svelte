<script lang="ts">
  import QRCode from 'qrcode';
  import { onMount } from 'svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let text = '';
  let url = '';
  let color = '#10b981';
  let size = 400;

  onMount(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = new URL(window.location.href);
      const initial = u.searchParams.get('text');
      if (initial) {
        text = initial;
      }
    } catch {
      // ignore
    }
  });

  $: {
    if (text) {
      QRCode.toDataURL(text, { 
          width: size, 
          margin: 2, 
          color: { 
              dark: color, 
              light: '#00000000' 
          } 
      }).then(u => url = u);
    } else {
        url = '';
    }
  }

  function copy() {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qr-code.png';
    link.click();
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
    <div class="grid gap-6">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.qrGen.qrContent')}</label>
            <textarea bind:value={text} placeholder={t(dict, 'tools.qrGen.placeholder')} class="input min-h-[120px] font-mono"></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="grid gap-1.5">
                <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.qrGen.dotsColor')}</label>
                <div class="flex gap-2 items-center">
                    <input type="color" bind:value={color} class="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0" />
                    <input type="text" bind:value={color} class="input text-xs font-mono py-2" />
                </div>
            </div>
            <div class="grid gap-1.5">
                <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.qrGen.resolution')}</label>
                <input type="number" bind:value={size} min="100" max="2000" class="input py-2" />
            </div>
        </div>

        {#if url}
            <div class="flex flex-col items-center gap-8 py-8 animate-in zoom-in-95">
                <div class="p-6 bg-white dark:bg-zinc-200 rounded-[2.5rem] shadow-2xl relative group">
                    <img src={url} alt="QR Code" class="w-64 h-64 relative z-10" />
                    <div class="absolute inset-0 bg-emerald-500/10 blur-3xl rounded-full scale-75 group-hover:scale-110 transition-transform duration-700 pointer-events-none"></div>
                </div>
                
                <div class="flex gap-3 w-full max-w-sm">
                    <button on:click={copy} class="btn flex-1 py-4 uppercase font-black tracking-widest text-xs">{t(dict, 'tools.qrGen.downloadPng')}</button>
                    <button on:click={() => { text = ''; }} class="btn-outline px-6">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>
        {/if}
    </div>
</div>
