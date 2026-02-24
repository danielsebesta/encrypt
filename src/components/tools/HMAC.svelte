<script lang="ts">
  import { hmac } from '../../lib/crypto';

  let message = '';
  let secret = '';
  let result = '';

  async function generate() {
    if (!message || !secret) return;
    result = await hmac(message, secret);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Message Data</label>
        <textarea bind:value={message} placeholder="Payload to sign..." class="input min-h-[100px]"></textarea>
    </div>
    
    <div class="grid gap-1.5">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Secret Key</label>
        <input bind:value={secret} type="password" placeholder="HMAC Secret..." class="input" />
    </div>

    <button on:click={generate} class="btn w-full py-4 uppercase tracking-widest text-xs font-black">Generate SHA-256 HMAC</button>

    {#if result}
        <div class="space-y-2">
            <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">MAC Signature (Hex)</label>
            <div class="p-6 bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl font-mono text-sm break-all text-center text-emerald-700 dark:text-emerald-400 select-all shadow-inner">
                {result}
            </div>
        </div>
    {/if}
  </div>
</div>
