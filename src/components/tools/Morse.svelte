<script lang="ts">
  import { toMorse, fromMorse } from '../../lib/crypto';

  let input = '';
  let output = '';
  let textToMorse = true;
  $: {
    if (textToMorse) {
        output = toMorse(input);
    } else {
        output = fromMorse(input);
    }
  }

  function playMorse() {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      
      let time = ctx.currentTime;
      const dot = 0.1;
      const dash = 0.3;
      
      output.split('').forEach(char => {
          if (char === '.') {
              gain.gain.setValueAtTime(0.2, time);
              gain.gain.setValueAtTime(0, time + dot);
              time += dot + dot;
          } else if (char === '-') {
              gain.gain.setValueAtTime(0.2, time);
              gain.gain.setValueAtTime(0, time + dash);
              time += dash + dot;
          } else if (char === ' ' || char === '/') {
              time += dot * 2;
          }
      });
      
      osc.start();
      osc.stop(time + 0.1);
  }

  function copy() {
    navigator.clipboard.writeText(output);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
    <div class="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
        <button on:click={() => textToMorse = true} class="flex-1 py-2 text-xs font-bold rounded-md transition-all {textToMorse ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">TEXT TO MORSE</button>
        <button on:click={() => textToMorse = false} class="flex-1 py-2 text-xs font-bold rounded-md transition-all {!textToMorse ? 'bg-white dark:bg-zinc-800 text-emerald-500 shadow-sm' : 'text-zinc-500'}">MORSE TO TEXT</button>
    </div>
    
    <div class="grid gap-6">
        <div class="grid gap-1.5">
            <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Source Input</label>
            <textarea bind:value={input} placeholder={textToMorse ? "Type text to translate..." : "Type morse (... --- ...)"} class="input h-32 font-mono"></textarea>
        </div>
        
        <div class="grid gap-2">
            <div class="flex justify-between items-end">
                <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Translated Output</label>
                <div class="flex gap-4">
                    <button on:click={playMorse} class="text-[10px] text-emerald-600 font-bold hover:underline flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                        PLAY AUDIO
                    </button>
                    <button on:click={copy} class="text-[10px] text-emerald-600 font-bold hover:underline">COPY</button>
                </div>
            </div>
            <div class="p-8 bg-emerald-50/20 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl min-h-[120px] text-2xl tracking-[0.3em] font-mono break-all text-emerald-800 dark:text-emerald-400 flex items-center justify-center text-center">
                {output || '...'}
            </div>
        </div>
    </div>
</div>
