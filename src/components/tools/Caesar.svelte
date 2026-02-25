<script lang="ts">
  import { rot13 } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);
  let shift = 13;
  let input = '';
  let output = '';
  $: output = rot13(input, shift);
</script>

<div class="space-y-10 animate-in fade-in duration-500">
    <div class="flex flex-col items-center gap-8">
        <div class="relative w-48 h-48 rounded-full border-4 border-zinc-50 dark:border-zinc-900 flex items-center justify-center bg-zinc-50/20 dark:bg-zinc-900/20 shadow-inner group">
            <div class="absolute inset-2 rounded-full border border-emerald-500/10 group-hover:border-emerald-500/30 transition-all scale-100 group-hover:scale-110"></div>
            <div class="text-6xl font-black text-emerald-500 tabular-nums">{shift}</div>
            <div class="absolute -bottom-1 w-full max-w-[140px]">
                 <input 
                    type="range" 
                    min="1" max="25" 
                    bind:value={shift}
                    class="w-full accent-emerald-500"
                />
            </div>
            <div class="absolute -top-6 text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t(dict, 'tools.caesar.rotationOffset')}</div>
        </div>
    </div>

    <div class="grid gap-6">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.caesar.originalText')}</label>
            <textarea bind:value={input} placeholder={t(dict, 'tools.caesar.placeholder')} class="input h-24"></textarea>
        </div>
        
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.caesar.cipheredResult')}</label>
            <div class="p-8 bg-zinc-50 dark:bg-zinc-900 rounded-3xl border-2 border-dashed border-zinc-100 dark:border-zinc-800 font-mono text-3xl text-center text-zinc-800 dark:text-zinc-100 break-all">
                {output || '...'}
            </div>
        </div>
    </div>
</div>
