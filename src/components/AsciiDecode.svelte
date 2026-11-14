<script lang="ts">
  import { asciiKit } from '../lib/asciiKit';

  export let text: string;
  export let duration = 800;
  export let scramble = false;
  let className = '';
  export { className as class };
</script>

<span
  class={className}
  use:asciiKit={(kit, node) => kit.decode(node, { duration, scramble, settle: 'text', replayOnHover: false })}
>{text}</span>
