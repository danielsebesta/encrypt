<script lang="ts">
  import ThemeToggle from './ThemeToggle.svelte';
  let mobileOpen = false;
  let activeCategory: string | null = null;

  const categories = [
    {
      name: 'Developer',
      tools: [
        { label: 'UUID & ULID', href: '/tools/uuid-ulid' },
        { label: 'Token Gen', href: '/tools/token' },
        { label: 'Bcrypt Hash', href: '/tools/bcrypt' },
        { label: 'HMAC Signer', href: '/tools/hmac' },
        { label: 'RSA Keys', href: '/tools/rsa' },
        { label: 'JWT Debug', href: '/tools/jwt' },
        { label: 'Base64', href: '/tools/base64' },
      ]
    },
    {
      name: 'Cryptography',
      tools: [
        { label: 'AES Words', href: '/tools/aes-words' },
        { label: 'Enigma M3', href: '/tools/enigma' },
        { label: 'Caesar Cipher', href: '/tools/caesar' },
        { label: 'Vigenere Square', href: '/tools/vigenere' },
        { label: 'Morse Codec', href: '/tools/morse' },
        { label: 'Time Capsule', href: '/tools/time-capsule' },
      ]
    },
    {
      name: 'Privacy',
      tools: [
        { label: 'Steganography', href: '/tools/steganography' },
        { label: 'EXIF Scrub', href: '/tools/exif-scrub' },
        { label: 'ID Watermarker', href: '/tools/watermark' },
        { label: 'Secure QR', href: '/tools/qr-gen' },
        { label: 'PDF Redact', href: '/tools/pdf-redact' },
        { label: 'PDF Unlock', href: '/tools/pdf-unlock' },
        { label: 'Dead Drop Link', href: '/drop' },
      ]
    }
  ];

  function toggleCategory(name: string) {
    activeCategory = activeCategory === name ? null : name;
  }
</script>

<nav class="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/90 backdrop-blur-lg sticky top-0 z-50 shadow-sm dark:shadow-none">
  <div class="max-w-7xl mx-auto px-5 flex items-center justify-between h-14">
    <a href="/" class="flex items-center gap-2.5 shrink-0">
      <img src="/encryptclick_icon.svg" alt="" class="h-7 w-auto" />
      <span class="text-base font-mono font-bold tracking-tight text-zinc-900 dark:text-zinc-100">encrypt.click</span>
    </a>

    <div class="hidden md:flex items-center gap-4">
      <div class="flex items-center gap-1">
        {#each categories as cat}
          <div class="relative group">
            <button class="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1 opacity-70 group-hover:opacity-100">
              {cat.name}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:rotate-180"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="absolute top-full left-0 pt-2 opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 z-[60]">
                <div class="w-48 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl shadow-2xl p-2 grid gap-0.5">
                    {#each cat.tools as tool}
                        <a href={tool.href} class="px-3 py-2 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-400/5 rounded-lg transition-all">{tool.label}</a>
                    {/each}
                </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-2"></div>
      
      <div class="flex items-center gap-1">
          <a href="https://github.com/danielsebesta/encrypt.click" target="_blank" rel="noopener noreferrer" class="btn-ghost btn-icon" aria-label="GitHub">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
          <ThemeToggle />
      </div>
    </div>

    <div class="flex md:hidden items-center gap-1">
      <ThemeToggle />
      <button on:click={() => mobileOpen = !mobileOpen} class="btn-ghost btn-icon" aria-label="Menu">
        {#if mobileOpen}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        {/if}
      </button>
    </div>
  </div>

  {#if mobileOpen}
    <div class="md:hidden border-t border-zinc-200 dark:border-zinc-800 max-h-[80vh] overflow-y-auto bg-white/95 dark:bg-zinc-950/95 backdrop-blur-lg">
      <div class="p-5 space-y-6">
        {#each categories as cat}
          <div class="space-y-3">
            <h3 class="text-[10px] font-black uppercase text-zinc-400 tracking-widest">{cat.name}</h3>
            <div class="grid grid-cols-2 gap-2">
                {#each cat.tools as tool}
                    <a href={tool.href} on:click={() => mobileOpen = false} class="block py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-emerald-500 transition-colors uppercase">{tool.label}</a>
                {/each}
            </div>
          </div>
        {/each}
        <div class="pt-4 border-t border-zinc-100 dark:border-zinc-900">
            <a href="https://github.com/danielsebesta/encrypt.click" target="_blank" rel="noopener noreferrer" class="block py-2 text-sm font-bold text-zinc-600 dark:text-zinc-300">GitHub Repository</a>
        </div>
      </div>
    </div>
  {/if}
</nav>
