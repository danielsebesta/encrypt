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

export const SHOT_CHAT_ROOM = 'weekend-crew';
export const SHOT_BOARD_ROOM = 'trip-board';

/** Local copies downloaded by `pnpm capture:screenshots` (Wikimedia CC0). */
export const SHOT_PHOTOS = {
  dinner: '/shots/dinner.jpg',
  dog: '/shots/dog.jpg',
  street: '/shots/street.jpg',
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
    room('chat', SHOT_CHAT_ROOM, 'Weekend crew', 'live', { pinned: true, ago: 2 * 60_000 }),
    room('chat', 'parents', 'Parents', 'live', { ago: 40 * 60_000 }),
    room('chat', 'design-review', 'Design review', '1h', { ago: 3 * hour }),
    room('chat', 'ops-bridge', 'Ops bridge', 'live', { ago: 6 * hour }),
    room('chat', 'book-club', 'Book club', '1d', { ago: 26 * hour }),
    room('chat', 'secret-santa', 'Secret Santa', 'live', { ago: 2 * 24 * hour }),
    room('chat', 'flatmates', 'Flatmates', 'live', { ago: 4 * hour }),
    room('whiteboard', SHOT_BOARD_ROOM, 'Trip board', 'live', { pinned: true, ago: 15 * 60_000 }),
    room('whiteboard', 'sprint-sketch', 'Sprint sketch', 'live', { ago: 5 * hour }),
    room('whiteboard', 'logo-drafts', 'Logo drafts', 'live', { ago: 30 * hour }),
    room('whiteboard', 'kitchen-plan', 'Kitchen plan', 'live', { ago: 8 * hour }),
    room('whiteboard', 'road-map', 'Road map', 'live', { ago: 12 * hour }),
  ];
}

type ShotPerson = { alias: Alias; nick?: string; pk: string };

const YOU: ShotPerson = { alias: { a: 3, n: 7, h: 142 }, nick: 'Alex', pk: 'shot-you' };
const MAYA: ShotPerson = { alias: { a: 11, n: 2, h: 28 }, nick: 'Maya', pk: 'shot-maya' };
const JON: ShotPerson = { alias: { a: 5, n: 14, h: 210 }, nick: 'Jon', pk: 'shot-jon' };
const RINA: ShotPerson = { alias: { a: 16, n: 9, h: 310 }, nick: 'Rina', pk: 'shot-rina' };

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
    sender: who === YOU ? (dict['chat.you'] || 'You') : name,
    initials: initialsOf(name),
    color: aliasColor(who.alias),
    alias: who.alias,
    nick: who.nick,
    mine: who === YOU,
    time: now - agoMs,
    ttl: 0,
    remaining: 0,
    revealed: true,
    pk: who.pk,
    ...extra,
  };
}

const FAKE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Compact thread so text, reply, reactions, photo, voice and a file fit one phone viewport. */
export function shotChatMessages(dict: Record<string, string>): ShotMessage[] {
  return [
    msg(dict, MAYA, 'm1', 'We still on for dinner?', 40 * 60_000),
    msg(dict, JON, 'm2', 'Yes — 19:30 by the station.', 36 * 60_000, { replyTo: 'm1' }),
    msg(dict, YOU, 'm3', 'Booked a table for four.', 32 * 60_000),
    msg(dict, MAYA, 'm4', '', 28 * 60_000, {
      preview: { type: 'image', url: SHOT_PHOTOS.dinner, width: 1200, height: 900 },
      previewState: 'ready',
      file: { name: 'IMG_2841.jpg', size: 1_842_112, urls: ['#'], key: FAKE_KEY },
    }),
    msg(dict, JON, 'm5', '', 22 * 60_000, {
      file: {
        name: 'voice.webm',
        size: 48_000,
        urls: ['#'],
        key: FAKE_KEY,
        voice: true,
        duration: 9,
      },
    }),
    msg(dict, RINA, 'm6', 'Bringing the pup 🐶', 16 * 60_000),
    msg(dict, RINA, 'm7', '', 14 * 60_000, {
      preview: { type: 'image', url: SHOT_PHOTOS.dog, width: 1200, height: 900 },
      previewState: 'ready',
      file: { name: 'IMG_2847.jpg', size: 2_104_320, urls: ['#'], key: FAKE_KEY },
    }),
    msg(dict, YOU, 'm8', '', 8 * 60_000, {
      file: { name: 'booking.pdf', size: 96_240, urls: ['#'], key: FAKE_KEY },
    }),
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
    { id: 'r1', target: 'm3', emoji: '👍', remove: false, reactor: MAYA.pk, name: 'Maya', at: now - 30 * 60_000 },
    { id: 'r2', target: 'm3', emoji: '🔥', remove: false, reactor: JON.pk, name: 'Jon', at: now - 29 * 60_000 },
    { id: 'r3', target: 'm4', emoji: '😮', remove: false, reactor: YOU.pk, name: you, at: now - 26 * 60_000 },
    { id: 'r4', target: 'm7', emoji: '❤️', remove: false, reactor: YOU.pk, name: you, at: now - 12 * 60_000 },
    { id: 'r5', target: 'm7', emoji: '😂', remove: false, reactor: JON.pk, name: 'Jon', at: now - 11 * 60_000 },
  ];
}

export function shotMembers(dict: Record<string, string>) {
  return [YOU, MAYA, JON, RINA].map((who) => {
    const name = personLabel(dict, who);
    return {
      pk: who.pk,
      key: who.pk,
      name: who === YOU ? (dict['chat.you'] || 'You') : name,
      initials: initialsOf(name),
      color: aliasColor(who.alias),
      alias: who.alias,
      trusted: true,
      safety: who.pk.slice(0, 8),
      code: who.pk.slice(5, 13).toUpperCase(),
    };
  });
}

export const SHOT_SIGNER = YOU.pk;
