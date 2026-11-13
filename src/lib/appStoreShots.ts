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

export const SHOT_CHAT_ROOM = 'weekend';
/** Separate Material store-shot room so Android marketing frames show a different thread. */
export const SHOT_CHAT_ROOM_MATERIAL = 'studio';
export const SHOT_BOARD_ROOM = 'sprint';

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
    room('chat', SHOT_CHAT_ROOM, 'Weekend trip', 'live', { pinned: true, ago: 2 * 60_000 }),
    room('chat', SHOT_CHAT_ROOM_MATERIAL, 'Design studio', 'live', { pinned: true, ago: 90_000 }),
    room('chat', 'family', 'Family', 'live', { ago: 3 * hour }),
    room('chat', 'book-club', 'Book club', '1d', { ago: 26 * hour }),
    room('chat', 'office', 'Office', 'live', { ago: 6 * hour }),
    room('chat', 'travel', 'Travel notes', 'live', { ago: 2 * 24 * hour }),
    room('chat', 'quiet', 'Quiet room', '1h', { ago: 4 * hour }),
    room('chat', 'neighbors', 'Neighbors', 'live', { ago: 8 * hour }),
    room('chat', 'hiking', 'Hiking plans', '2d', { ago: 3 * 24 * hour }),
    room('chat', 'project-sync', 'Project sync', 'live', { ago: 14 * hour }),
    room('whiteboard', SHOT_BOARD_ROOM, 'Sprint board', 'live', { pinned: true, ago: 15 * 60_000 }),
    room('whiteboard', 'floor-plan', 'Floor plan', 'live', { pinned: true, ago: 5 * hour }),
    room('whiteboard', 'mood-board', 'Mood board', 'live', { ago: 9 * hour }),
    room('whiteboard', 'roadmap', 'Roadmap', 'live', { ago: 30 * hour }),
    room('whiteboard', 'wireframes', 'Wireframes', 'live', { ago: 12 * hour }),
  ];
}

type ShotPerson = { alias: Alias; nick?: string; pk: string };

const ALEX: ShotPerson = { alias: { a: 3, n: 7, h: 142 }, nick: 'Alex', pk: 'shot-you' };
const MAYA: ShotPerson = { alias: { a: 11, n: 2, h: 28 }, nick: 'Maya', pk: 'shot-maya' };

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
    sender: who === ALEX ? (dict['chat.you'] || 'You') : name,
    initials: initialsOf(name),
    color: aliasColor(who.alias),
    alias: who.alias,
    nick: who.nick,
    mine: who === ALEX,
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

/** iOS thread: weekend trip — Dumpling Town stop and the stairwell. */
export function shotChatMessages(dict: Record<string, string>): ShotMessage[] {
  return [
    msg(dict, MAYA, 'm1', 'We are here — Dumpling Town is next door.', 38 * 60_000),
    photo(dict, MAYA, 'm2', SHOT_PHOTOS.broadway, 'broadway.jpg', 1_842_112, 36 * 60_000, 1200, 896),
    msg(dict, ALEX, 'm3', 'Perfect. Save a table for 7?', 32 * 60_000, { replyTo: 'm1' }),
    photo(dict, MAYA, 'm4', SHOT_PHOTOS.stairs, 'stairs.jpg', 2_104_320, 26 * 60_000, 1116, 2048),
    msg(dict, MAYA, 'm5', 'The stairwell in this building is unreal.', 22 * 60_000),
    msg(dict, ALEX, 'm6', 'Keep that one. Great light.', 18 * 60_000),
    photo(dict, ALEX, 'm7', SHOT_PHOTOS.rack, 'rack.jpg', 1_612_800, 12 * 60_000, 2000, 1116),
    msg(dict, MAYA, 'm8', 'And the data center tour from earlier.', 8 * 60_000),
  ];
}

/** Android thread: design studio — site photos after a visit. */
export function shotMaterialChatMessages(dict: Record<string, string>): ShotMessage[] {
  return [
    msg(dict, ALEX, 'a1', 'Site visit notes from today.', 36 * 60_000),
    photo(dict, ALEX, 'a2', SHOT_PHOTOS.rack, 'rack.jpg', 1_612_800, 34 * 60_000, 2000, 1116),
    msg(dict, MAYA, 'a3', 'Nice shot of the rack floor.', 28 * 60_000, { replyTo: 'a1' }),
    photo(dict, MAYA, 'a4', SHOT_PHOTOS.stairs, 'stairs.jpg', 2_104_320, 22 * 60_000, 1116, 2048),
    msg(dict, MAYA, 'a5', 'Stairwell color is strong — use it in the deck?', 18 * 60_000),
    msg(dict, ALEX, 'a6', 'Yes. Pair it with the street exit.', 14 * 60_000),
    photo(dict, MAYA, 'a7', SHOT_PHOTOS.broadway, 'broadway.jpg', 1_842_112, 10 * 60_000, 1200, 896),
    msg(dict, ALEX, 'a8', 'Done. Adding these to the shared folder.', 6 * 60_000),
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
    { id: 'r1', target: 'm2', emoji: '👍', remove: false, reactor: ALEX.pk, name: you, at: now - 34 * 60_000 },
    { id: 'r2', target: 'm4', emoji: '❤️', remove: false, reactor: ALEX.pk, name: you, at: now - 24 * 60_000 },
    { id: 'r3', target: 'm7', emoji: '😮', remove: false, reactor: MAYA.pk, name: 'Maya', at: now - 10 * 60_000 },
  ];
}

export function shotMaterialReactions(dict: Record<string, string>): ShotReaction[] {
  const you = dict['chat.you'] || 'You';
  return [
    { id: 'ar1', target: 'a2', emoji: '👍', remove: false, reactor: MAYA.pk, name: 'Maya', at: now - 32 * 60_000 },
    { id: 'ar2', target: 'a4', emoji: '🔥', remove: false, reactor: ALEX.pk, name: you, at: now - 20 * 60_000 },
    { id: 'ar3', target: 'a7', emoji: '❤️', remove: false, reactor: ALEX.pk, name: you, at: now - 8 * 60_000 },
  ];
}

export function shotMembers(dict: Record<string, string>) {
  return [ALEX, MAYA].map((who) => {
    const name = personLabel(dict, who);
    return {
      pk: who.pk,
      key: who.pk,
      name: who === ALEX ? (dict['chat.you'] || 'You') : name,
      initials: initialsOf(name),
      color: aliasColor(who.alias),
      alias: who.alias,
      trusted: true,
      safety: who.pk.slice(0, 8),
      code: who.pk.slice(5, 13).toUpperCase(),
    };
  });
}

export const SHOT_SIGNER = ALEX.pk;
