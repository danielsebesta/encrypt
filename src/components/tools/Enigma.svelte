<script lang="ts">
  import { Enigma } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let enigmaRotors = ['I', 'II', 'III'];
  let enigmaPositions = ['A', 'A', 'A'];
  let enigmaRings = [0, 0, 0];
  let enigmaReflector = 'B';
  let enigmaPlugs = '';
  let enigmaInput = '';
  let enigmaOutput = '';

  function handleEnigma() {
    const machine = new Enigma(enigmaRotors, enigmaPositions.join(''), enigmaRings, enigmaReflector, enigmaPlugs);
    enigmaOutput = machine.process(enigmaInput);
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <div class="flex justify-center gap-6 md:gap-12 py-4">
      {#each [0, 1, 2] as i}
          <div class="relative group">
              <div class="text-[10px] text-zinc-400 mb-2 text-center uppercase font-bold tracking-tight">{t(dict, 'tools.enigma.rotor')} {enigmaRotors[i]}</div>
              <div class="w-16 h-20 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-center shadow-sm">
                   <input 
                       type="text" 
                       maxlength="1" 
                       bind:value={enigmaPositions[i]}
                       on:input={() => {
                           enigmaPositions[i] = enigmaPositions[i].toUpperCase();
                           handleEnigma();
                       }}
                       class="bg-transparent text-zinc-800 dark:text-zinc-100 text-3xl font-bold w-full text-center outline-none"
                   />
              </div>
          </div>
      {/each}
  </div>

  <div class="grid gap-6">
      <div class="grid gap-1.5">
          <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.enigma.inputStream')}</label>
          <textarea 
              bind:value={enigmaInput} 
              on:input={handleEnigma}
              placeholder={t(dict, 'tools.enigma.streamPlaceholder')} 
              class="input min-h-[120px] font-mono text-sm uppercase"
          ></textarea>
      </div>
      
      <div class="grid gap-1.5">
          <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.enigma.scrambledOutput')}</label>
          <div class="p-6 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl min-h-[120px] break-all font-mono text-xl text-emerald-800 dark:text-emerald-400 flex items-center justify-center text-center">
              {enigmaOutput}
          </div>
      </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
      <div class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 text-[10px] space-y-1">
          <div class="text-zinc-400 uppercase font-black">{t(dict, 'tools.enigma.reflector')}</div>
          <div class="font-bold text-zinc-700 dark:text-zinc-300">{t(dict, 'tools.enigma.reflectorValue')}</div>
      </div>
      <div class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 text-[10px] space-y-1">
          <div class="text-zinc-400 uppercase font-black">{t(dict, 'tools.enigma.model')}</div>
          <div class="font-bold text-zinc-700 dark:text-zinc-300">{t(dict, 'tools.enigma.modelValue')}</div>
      </div>
  </div>
</div>
