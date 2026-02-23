<script lang="ts">
  const badges = [
    {
      label: "SSL Labs",
      value: "A+",
      color: "emerald",
      url: "https://www.ssllabs.com/ssltest/analyze.html?d=encrypt.click"
    },
    {
      label: "SecurityHeaders",
      value: "A+",
      color: "emerald",
      url: "https://securityheaders.com/?q=encrypt.click&followRedirects=on"
    },
    {
      label: "Internet.nl",
      value: "98%",
      color: "emerald",
      url: "https://internet.nl/site/encrypt.click/"
    },
    {
      label: "VirusTotal",
      value: "0/96 Clean",
      color: "emerald",
      url: "https://www.virustotal.com/gui/url/944f987ea48525e22521aafe660fe63203bc044507e3e323d64f1f602bc6b105"
    },
    {
      label: "HSTS",
      value: "1 Year",
      color: "emerald",
      url: "https://hstspreload.org/?domain=encrypt.click"
    },
    {
      label: "DNSSEC",
      value: "Verified",
      color: "emerald",
      url: "https://dnsviz.net/d/encrypt.click/dnssec/"
    }
  ];
</script>

<div class="mt-12 py-8 border-t border-zinc-900">
  <div class="flex flex-wrap gap-4 justify-center md:justify-start">
    {#each badges as badge}
      <a 
        href={badge.url} 
        target="_blank" 
        rel="noopener noreferrer"
        class="group flex flex-col items-center p-3 border border-zinc-800 bg-zinc-950 hover:border-emerald-500/50 transition-all active:scale-95"
      >
        <span class="text-[9px] uppercase tracking-widest text-zinc-500 font-black mb-1">{badge.label}</span>
        <span class="text-sm font-bold text-emerald-500 group-hover:text-emerald-400 transition-colors">
          {badge.value}
        </span>
      </a>
    {/each}
  </div>
  
  <p class="text-[10px] text-zinc-600 mt-6 max-w-2xl italic leading-relaxed">
    <span class="text-emerald-500 font-bold not-italic">BULLETPROOF INFRASTRUCTURE:</span> 
    End-to-end encryption, HSTS Preloaded, DNSSEC Signed, and Privacy-Hardened. 
    Click any badge to verify live security audit reports.
  </p>
</div>
