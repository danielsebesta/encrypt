<script lang="ts">
  import { getTranslations, t } from '../lib/i18n';

  export let compact = false;
  export let locale = 'en';
  $: dict = getTranslations(locale);

  const badges = [
    {
      label: "Mozilla",
      value: "125/100",
      url: "https://developer.mozilla.org/en-US/observatory/analyze?host=encrypt.click"
    },
    {
      label: "SSL Labs",
      value: "A+",
      url: "https://www.ssllabs.com/ssltest/analyze.html?d=encrypt.click"
    },
    {
      label: "SecurityHeaders",
      value: "A+",
      url: "https://securityheaders.com/?q=encrypt.click&followRedirects=on"
    },
    {
      label: "Internet.nl",
      value: "98%",
      url: "https://internet.nl/site/encrypt.click/"
    },
    {
      label: "IPv6",
      valueKey: "securityShield.value.enabled",
      url: "https://internet.nl/site/encrypt.click/"
    },
    {
      label: "HTTPS",
      valueKey: "securityShield.value.https",
      url: "https://www.ssllabs.com/ssltest/analyze.html?d=encrypt.click"
    },
    {
      label: "Website Carbon",
      value: "A+ · 0.03 g CO₂",
      url: "https://www.websitecarbon.com/website/encrypt-click/"
    },
    {
      label: "Blacklight",
      valueKey: "securityShield.value.trackers",
      url: "https://themarkup.org/blacklight?url=encrypt.click&device=desktop&location=eu"
    },
    {
      label: "VirusTotal",
      valueKey: "securityShield.value.clean",
      url: "https://www.virustotal.com/gui/url/944f987ea48525e22521aafe660fe63203bc044507e3e323d64f1f602bc6b105"
    },
    {
      label: "HSTS",
      valueKey: "securityShield.value.oneYear",
      url: "https://hstspreload.org/?domain=encrypt.click"
    },
    {
      label: "DNSSEC",
      valueKey: "securityShield.value.verified",
      url: "https://dnsviz.net/d/encrypt.click/dnssec/"
    },
    {
      label: "Yellow Lab Tools",
      value: "A · 99/100",
      url: "https://yellowlab.tools/result/hg3l6q8ai2"
    },
    {
      label: "Webbkoll",
      valueKey: "securityShield.value.cookies",
      url: "https://webbkoll.5july.net/en/results?url=http%3A%2F%2Fencrypt.click"
    },
    {
      label: "ImmuniWeb",
      value: "A · WebSec",
      url: "https://www.immuniweb.com/websec/encrypt.click/h3AMt8Mv/"
    },
    {
      label: "HTTP/3 Check",
      value: "QUIC + HTTP/3",
      url: "https://http3check.net/?host=encrypt.click"
    },
    {
      label: "Zonemaster",
      value: "DNSSEC OK",
      url: "https://zonemaster.net/en/result/2a3c2789231a4695/"
    }
  ];

  const compactBadges = [
    "Mozilla",
    "SecurityHeaders",
    "Blacklight",
    "SSL Labs",
    "Website Carbon",
    "VirusTotal",
  ];

  $: visibleBadges = compact
    ? badges.filter((badge) => compactBadges.includes(badge.label))
    : badges;
</script>

<div class={`flex flex-wrap ${compact ? 'gap-2.5 justify-start' : 'gap-3 justify-center'}`}>
  {#each visibleBadges as badge}
    <a
      href={badge.url}
      target="_blank"
      rel="noopener noreferrer"
      class={`badge-outline hover:border-emerald-500/50 transition-all active:scale-95 gap-1.5 ${compact ? 'py-1.5 px-3 bg-white/70 dark:bg-zinc-950/30' : 'py-1.5 px-3'}`}
    >
      <span class="text-zinc-500 dark:text-zinc-400">{badge.label}</span>
      <span class="text-emerald-600 dark:text-emerald-400 font-semibold">{badge.valueKey ? t(dict, badge.valueKey) : badge.value}</span>
    </a>
  {/each}
</div>
