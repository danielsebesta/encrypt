<script lang="ts">
  import { generateUUID, generateULID } from '../../lib/crypto';
  import { onMount } from 'svelte';

  let uuidResult = '';
  let ulidResult = '';

  function refresh() {
    uuidResult = generateUUID();
    ulidResult = generateULID();
  }

  onMount(refresh);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="grid gap-6">
    <div class="grid gap-2">
      <div class="flex justify-between items-end">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">UUID v4</label>
        <button on:click={() => copy(uuidResult)} class="text-[10px] text-emerald-600 font-bold hover:underline">COPY</button>
      </div>
      <div class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-sm md:text-base break-all flex justify-between items-center group">
        <span>{uuidResult}</span>
        <button on:click={() => uuidResult = generateUUID()} class="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>
      </div>
    </div>

    <div class="grid gap-2">
      <div class="flex justify-between items-end">
        <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">ULID (Universally Unique Lexicographically Sortable Identifier)</label>
        <button on:click={() => copy(ulidResult)} class="text-[10px] text-emerald-600 font-bold hover:underline">COPY</button>
      </div>
      <div class="p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl font-mono text-sm md:text-base break-all flex justify-between items-center group">
        <span>{ulidResult}</span>
        <button on:click={() => ulidResult = generateULID()} class="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>
      </div>
    </div>

    <button on:click={refresh} class="btn w-full py-4 uppercase tracking-widest text-xs font-black">Generate New Set</button>
  </div>
</div>
