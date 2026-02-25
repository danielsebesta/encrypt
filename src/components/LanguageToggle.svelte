<script lang="ts">
  export let currentLocale: 'en' | 'cs' = 'en';
  export let hrefEn: string = '/';
  export let hrefCs: string = '/cs/';
</script>

<div class="flex items-center gap-1 rounded-full bg-zinc-100/80 dark:bg-zinc-800/60 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
  <a
    href={hrefEn}
    class="px-2 py-0.5 rounded-full transition-colors"
    class:bg-zinc-900={currentLocale === 'en'}
    class:text-white={currentLocale === 'en'}
  >
    EN
  </a>
  <a
    href={hrefCs}
    class="px-2 py-0.5 rounded-full transition-colors"
    class:bg-zinc-900={currentLocale === 'cs'}
    class:text-white={currentLocale === 'cs'}
  >
    CS
  </a>
</div>

