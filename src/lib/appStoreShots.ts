import type { RoomEntry } from './roomVault';
import { entryId } from './roomVault';
import type { Alias } from './alias';
import { aliasColor, aliasName } from './alias';
import type { ReactionEmoji } from './chatReactions';

/** Query flag that fills /app with store-screenshot fixtures. Never reaches crypto or the network. */
export const APP_SHOTS_PARAM = 'shots';

export function appShotsEnabled(search = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  try {
    return new URLSearchParams(search).get(APP_SHOTS_PARAM) === '1';
  } catch {
    return false;
  }
}

const now = Date.now();
const hour = 60 * 60 * 1000;

export const SHOT_CHAT_ROOM = 'fsociety';
/** Separate Material store-shot room so Android marketing frames show a different thread. */
export const SHOT_CHAT_ROOM_MATERIAL = 'allsafe';
export const SHOT_BOARD_ROOM = 'network-map';

/** Local shot photos (user-supplied stills under public/shots/). */
export const SHOT_PHOTOS = {
  rack: '/shots/rack.jpg',
  stairs: '/shots/stairs.jpg',
  broadway: '/shots/broadway.jpg',
} as const;

function room(
  kind: 'chat' | 'whiteboard',
  roomId: string,
  label: string,
  mode: string,
  opts: { pinned?: boolean; ago?: number } = {},
): RoomEntry {
  const lastSeen = now - (opts.ago ?? 0);
  const entry: RoomEntry = {
    id: entryId(kind, roomId),
    kind,
    roomId,
    mode,
    label,
    createdAt: lastSeen - hour,
    lastSeen,
  };
  if (opts.pinned) entry.pinned = true;
  return entry;
}

export function shotRooms(): RoomEntry[] {
  return [
    room('chat', SHOT_CHAT_ROOM, 'fsociety', 'live', { pinned: true, ago: 2 * 60_000 }),
    room('chat', SHOT_CHAT_ROOM_MATERIAL, 'Allsafe audit', 'live', { pinned: true, ago: 90_000 }),
    room('chat', 'darlene', 'Darlene', 'live', { ago: 3 * hour }),
    room('chat', 'ron', "Ron's Coffee", '1d', { ago: 26 * hour }),
    room('chat', 'ecorp', 'E Corp review', 'live', { ago: 6 * hour }),
    room('chat', 'coney', 'Coney Island', 'live', { ago: 2 * 24 * hour }),
    room('chat', 'quiet', 'Quiet room', '1h', { ago: 4 * hour }),
    room('chat', 'krista', 'Krista', 'live', { ago: 8 * hour }),
    room('chat', 'arcade', 'Arcade', '2d', { ago: 3 * 24 * hour }),
    room('chat', 'tyrell', 'Tyrell', 'live', { ago: 14 * hour }),
    room('whiteboard', SHOT_BOARD_ROOM, 'Network map', 'live', { pinned: true, ago: 15 * 60_000 }),
    room('whiteboard', 'floor-plan', 'Data center floor', 'live', { pinned: true, ago: 5 * hour }),
    room('whiteboard', 'threat-model', 'Threat model', 'live', { ago: 9 * hour }),
    room('whiteboard', 'timeline', 'Timeline', 'live', { ago: 30 * hour }),
    room('whiteboard', 'rack-layout', 'Rack layout', 'live', { ago: 12 * hour }),
  ];
}

type ShotPerson = { alias: Alias; nick?: string; pk: string };

const ELLIOT: ShotPerson = { alias: { a: 3, n: 7, h: 142 }, nick: 'Elliot', pk: 'shot-you' };
const DARLENE: ShotPerson = { alias: { a: 11, n: 2, h: 28 }, nick: 'Darlene', pk: 'shot-maya' };

export type ShotMessage = {
  id: string;
  text: string;
  sender: string;
  initials: string;
  color: string;
  alias?: Alias;
  nick?: string;
  mine: boolean;
  time: number;
  ttl: number;
  remaining: number;
  file?: { name: string; size: number; urls: string[]; key: string; voice?: true; duration?: number };
  preview?: { type: 'image' | 'text'; url?: string; text?: string; expanded?: boolean; width?: number; height?: number };
  previewState?: 'loading' | 'ready' | 'failed';
  revealed?: boolean;
  once?: boolean;
  pk?: string;
  replyTo?: string;
};

function personLabel(dict: Record<string, string>, who: ShotPerson): string {
  return who.nick || aliasName(dict, who.alias);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '??';
}

function msg(
  dict: Record<string, string>,
  who: ShotPerson,
  id: string,
  text: string,
  agoMs: number,
  extra: Partial<ShotMessage> = {},
): ShotMessage {
  const name = personLabel(dict, who);
  return {
    id,
    text,
    sender: who === ELLIOT ? (dict['chat.you'] || 'You') : name,
    initials: initialsOf(name),
    color: aliasColor(who.alias),
    alias: who.alias,
    nick: who.nick,
    mine: who === ELLIOT,
    time: now - agoMs,
    ttl: 0,
    remaining: 0,
    revealed: true,
    pk: who.pk,
    ...extra,
  };
}

const FAKE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function photo(
  dict: Record<string, string>,
  who: ShotPerson,
  id: string,
  url: string,
  name: string,
  size: number,
  agoMs: number,
  width: number,
  height: number,
): ShotMessage {
  return msg(dict, who, id, '', agoMs, {
    preview: { type: 'image', url, width, height },
    previewState: 'ready',
    file: { name, size, urls: ['#'], key: FAKE_KEY },
  });
}

/** iOS thread: fsociety, up the stairwell to the rack. */
export function shotChatMessages(dict: Record<string, string>): ShotMessage[] {
  return [
    msg(dict, DARLENE, 'm1', 'Going up now. No cameras since the last audit.', 30 * 60_000),
    photo(dict, DARLENE, 'm2', SHOT_PHOTOS.stairs, 'stairs.jpg', 2_104_320, 26 * 60_000, 1116, 2048),
    msg(dict, ELLIOT, 'm3', 'Good. The rack is on the sub-level.', 18 * 60_000, { replyTo: 'm1' }),
    photo(dict, ELLIOT, 'm4', SHOT_PHOTOS.rack, 'rack.jpg', 1_612_800, 12 * 60_000, 2000, 1116),
    msg(dict, DARLENE, 'm5', 'That is the machine. Leave it running until I am out.', 8 * 60_000),
  ];
}

/** Android thread: Allsafe audit, site photos after a visit. */
export function shotMaterialChatMessages(dict: Record<string, string>): ShotMessage[] {
  return [
    msg(dict, ELLIOT, 'a1', 'Allsafe audit notes from today.', 36 * 60_000),
    msg(dict, DARLENE, 'a2', 'The server room is clean. Nothing changed since last quarter.', 28 * 60_000, { replyTo: 'a1' }),
    photo(dict, DARLENE, 'a3', SHOT_PHOTOS.stairs, 'stairs.jpg', 2_104_320, 22 * 60_000, 1116, 2048),
    msg(dict, DARLENE, 'a4', 'The stairwell colour is strong. Keep it for the report?', 18 * 60_000),
    msg(dict, ELLIOT, 'a5', 'Yes. Pair it with the street entrance.', 14 * 60_000),
    photo(dict, DARLENE, 'a6', SHOT_PHOTOS.broadway, 'broadway.jpg', 1_842_112, 10 * 60_000, 1200, 896),
    msg(dict, ELLIOT, 'a7', 'Done. Adding these to the shared folder.', 6 * 60_000),
  ];
}

export type ShotReaction = {
  id: string;
  target: string;
  emoji: ReactionEmoji;
  remove: boolean;
  reactor: string;
  name: string;
  at: number;
};

export function shotReactions(dict: Record<string, string>): ShotReaction[] {
  const you = dict['chat.you'] || 'You';
  return [
    { id: 'r1', target: 'm2', emoji: '❤️', remove: false, reactor: ELLIOT.pk, name: you, at: now - 22 * 60_000 },
    { id: 'r2', target: 'm4', emoji: '😮', remove: false, reactor: DARLENE.pk, name: 'Darlene', at: now - 10 * 60_000 },
  ];
}

export function shotMaterialReactions(dict: Record<string, string>): ShotReaction[] {
  const you = dict['chat.you'] || 'You';
  return [
    { id: 'ar1', target: 'a2', emoji: '👍', remove: false, reactor: ELLIOT.pk, name: you, at: now - 26 * 60_000 },
    { id: 'ar2', target: 'a3', emoji: '🔥', remove: false, reactor: ELLIOT.pk, name: you, at: now - 20 * 60_000 },
    { id: 'ar3', target: 'a6', emoji: '❤️', remove: false, reactor: ELLIOT.pk, name: you, at: now - 8 * 60_000 },
  ];
}

export function shotMembers(dict: Record<string, string>) {
  return [ELLIOT, DARLENE].map((who) => {
    const name = personLabel(dict, who);
    return {
      pk: who.pk,
      key: who.pk,
      name: who === ELLIOT ? (dict['chat.you'] || 'You') : name,
      initials: initialsOf(name),
      color: aliasColor(who.alias),
      alias: who.alias,
      trusted: true,
      safety: who.pk.slice(0, 8),
      code: who.pk.slice(5, 13).toUpperCase(),
    };
  });
}

export const SHOT_SIGNER = ELLIOT.pk;
