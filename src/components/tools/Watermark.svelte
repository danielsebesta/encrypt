<script lang="ts">
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let file: File | null = null;
  let text = 'FOR IDENTITY VERIFICATION ONLY';
  let resultUrl: string | null = null;
  let processing = false;

  function handleFile(e: Event) {
      const target = e.target as HTMLInputElement;
      file = target.files?.[0] || null;
      if (file) apply();
  }

  function apply() {
    if (!file) return;
    processing = true;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(img, 0, 0);
      
      const diagonal = Math.sqrt(canvas.width ** 2 + canvas.height ** 2);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.translate(-diagonal / 2, -diagonal / 2);
      
      const fontSize = Math.floor(canvas.width / 25);
      ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.textAlign = 'center';
      
      const stepX = canvas.width / 3;
      const stepY = canvas.height / 8;
      
      for (let x = -diagonal; x < diagonal * 2; x += stepX) {
        for (let y = -diagonal; y < diagonal * 2; y += stepY) {
          ctx.fillText(text, x, y);
        }
      }
      ctx.restore();
      
      resultUrl = canvas.toDataURL('image/jpeg', 0.9);
      processing = false;
    };
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <div class="grid gap-6">
      <div class="grid gap-1.5">
          <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.watermark.sourceDocument')}</label>
          <div class="relative">
              <input type="file" accept="image/*" on:change={handleFile} class="input cursor-pointer" />
              {#if file}
                  <div class="absolute right-3 top-2 text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded font-bold">{t(dict, 'tools.watermark.loaded')}</div>
              {/if}
          </div>
      </div>

      <div class="grid gap-1.5">
          <label class="text-xs text-zinc-500 font-bold uppercase tracking-wider">{t(dict, 'tools.watermark.protectionText')}</label>
          <input bind:value={text} placeholder={t(dict, 'tools.watermark.placeholder')} class="input" on:input={apply} />
      </div>

      {#if resultUrl}
        <div class="space-y-6 animate-in zoom-in-95">
            <div class="relative rounded-3xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-2xl bg-zinc-100 dark:bg-zinc-900">
                <img src={resultUrl} alt="Watermarked" class="w-full h-auto max-h-[500px] object-contain mx-auto" />
                <div class="absolute inset-0 ring-1 ring-inset ring-black/10 rounded-3xl pointer-events-none"></div>
            </div>
            
            <a href={resultUrl} download="protected-identity.jpg" class="btn w-full py-5 text-base font-black uppercase tracking-widest shadow-emerald-500/20 shadow-lg">
                {t(dict, 'tools.watermark.saveSecure')}
            </a>
            
            <p class="text-[10px] text-zinc-400 text-center font-medium uppercase tracking-widest">
                {t(dict, 'tools.watermark.verificationNote')}
            </p>
        </div>
      {/if}
  </div>
</div>
