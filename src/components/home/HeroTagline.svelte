<script lang="ts">
  import { asciiKit } from '../../lib/asciiKit';

  export let lines: string[];
</script>

<p class="home-hero__tagline">
  <span class="sr-only">{lines[0]}</span>
  <span
    aria-hidden="true"
    use:asciiKit={(kit, node) => {
      if (lines.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
      return kit.decode(node, { text: undefined, cycle: lines, hold: 4800, duration: 900, scramble: true, settle: 'text', replayOnHover: false });
    }}
  >{lines[0]}</span>
</p>
