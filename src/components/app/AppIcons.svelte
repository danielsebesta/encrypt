<script lang="ts" module>
  export type IconName =
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
    | 'more'
    | 'dices'
    | 'eye'
    | 'eye-off'
    | 'history'
    | 'timer'
    | 'search'
    | 'pencil'
    | 'hash'
    | 'join'
    | 'list'
    | 'home'
    | 'refresh'
    | 'update'
    | 'palette'
    | 'sun'
    | 'moon'
    | 'monitor'
    | 'smartphone'
    | 'bell'
    | 'bell-off'
    | 'eraser'
    | 'database'
    | 'close'
    | 'more-h'
    | 'share-android'
    | 'pin-off';
</script>

<script lang="ts">
  import { LUCIDE } from '../../lib/lucideIcons';

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
    dices: 'dices',
    eye: 'eye',
    'eye-off': 'eye-off',
    history: 'rotate-ccw-clock',
    timer: 'timer',
    search: 'search',
    pencil: 'pencil',
    hash: 'hash',
    join: 'log-in',
    list: 'list',
    home: 'house',
    refresh: 'refresh-cw',
    update: 'cloud-download',
    palette: 'palette',
    sun: 'sun',
    moon: 'moon',
    monitor: 'monitor',
    smartphone: 'smartphone',
    bell: 'bell',
    'bell-off': 'bell-off',
    eraser: 'eraser',
    database: 'database-x',
    close: 'x',
    'more-h': 'ellipsis',
    'share-android': 'share-2',
    'pin-off': 'pin-off',
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
