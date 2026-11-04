<script lang="ts">
  import { LUCIDE } from '../../lib/lucideIcons';

  type IconName =
    | 'chat'
    | 'settings'
    | 'plus'
    | 'lock'
    | 'pin'
    | 'check'
    | 'upload'
    | 'whiteboard'
    | 'trash'
    | 'shield'
    | 'install'
    | 'haptic'
    | 'globe'
    | 'key'
    | 'share'
    | 'call'
    | 'more';

  const MAP: Record<IconName, string> = {
    chat: 'message-square',
    settings: 'settings',
    plus: 'plus',
    lock: 'lock',
    pin: 'pin',
    check: 'check',
    upload: 'upload',
    whiteboard: 'pen-tool',
    trash: 'trash',
    shield: 'shield-check',
    install: 'download',
    haptic: 'vibrate',
    globe: 'globe',
    key: 'key',
    share: 'share',
    call: 'phone',
    more: 'ellipsis-vertical',
  };

  let {
    name,
    class: className = '',
    size = 20,
    strokeWidth = 2,
  }: {
    name: IconName;
    class?: string;
    size?: number;
    strokeWidth?: number;
  } = $props();
</script>

<svg class={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE[MAP[name]]}</svg>
