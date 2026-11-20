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
    | 'haptic'
    | 'globe'
    | 'key'
    | 'share'
    | 'call'
    | 'more'
    | 'dices'
    | 'copy'
    | 'eye'
    | 'eye-off'
    | 'history'
    | 'timer'
    | 'search'
    | 'pencil'
    | 'hash'
    | 'join'
    | 'refresh'
    | 'update'
    | 'palette'
    | 'sun'
    | 'moon'
    | 'monitor'
    | 'smartphone'
    | 'bell'
    | 'bell-off'
    | 'database'
    | 'close'
    | 'more-h'
    | 'share-android'
    | 'pin-off'
    | 'accessible'
    | 'contrast'
    | 'lightbulb';
</script>

<script lang="ts">
  import { TABLER } from '../../lib/icons';
  import type { IconName as ManifestName } from '../../lib/iconManifest';

  const MAP: Record<IconName, ManifestName> = {
    chat: 'message-square',
    settings: 'settings',
    plus: 'plus',
    lock: 'lock',
    pin: 'pin',
    check: 'check',
    upload: 'upload',
    whiteboard: 'pen-tool',
    trash: 'trash',
    haptic: 'vibrate',
    globe: 'globe',
    key: 'key',
    share: 'share',
    call: 'phone',
    more: 'ellipsis-vertical',
    dices: 'dices',
    copy: 'copy',
    eye: 'eye',
    'eye-off': 'eye-off',
    history: 'rotate-ccw-clock',
    timer: 'timer',
    search: 'search',
    pencil: 'pencil',
    hash: 'hash',
    join: 'log-in',
    refresh: 'refresh-cw',
    update: 'cloud-download',
    palette: 'palette',
    sun: 'sun',
    moon: 'moon',
    monitor: 'monitor',
    smartphone: 'smartphone',
    bell: 'bell',
    'bell-off': 'bell-off',
    database: 'database-x',
    close: 'x',
    'more-h': 'ellipsis',
    'share-android': 'share-2',
    'pin-off': 'pin-off',
    accessible: 'accessibility',
    contrast: 'contrast',
    lightbulb: 'lightbulb',
  };

  let {
    name,
    class: className = '',
    size = 20,
  }: {
    name: IconName;
    class?: string;
    size?: number;
  } = $props();
</script>

<svg class={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{@html TABLER[MAP[name]]}</svg>
