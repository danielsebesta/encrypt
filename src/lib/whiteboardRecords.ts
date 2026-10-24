import { COLOR_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, GEO_IDS, FONTS } from '@quickdrawjs/core';
import type { ShapeRecord, ScribbleStroke } from '@quickdrawjs/core';
import { validPublicKey } from './chatCrypto';

export const SHAPE_TYPES = ['draw', 'highlight', 'geo', 'arrow', 'line', 'text', 'note'] as const;

const MAX_COORD = 1e7;
const MAX_TEXT = 20000;
const MAX_PTS = 90000;
const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;

const ENUMS: Record<string, readonly string[]> = {
  color: COLOR_IDS,
  size: SIZE_IDS,
  labelSize: SIZE_IDS,
  dash: DASH_IDS,
  fill: FILL_IDS,
  geo: GEO_IDS,
  font: Object.keys(FONTS),
  align: ['start', 'middle', 'end'],
};

const REQUIRED: Record<string, string[]> = {
  draw: ['pts', 'color', 'size'],
  highlight: ['pts', 'color', 'size'],
  geo: ['geo', 'w', 'h', 'color', 'size', 'dash', 'fill'],
  arrow: ['dx', 'dy', 'color', 'size', 'dash'],
  line: ['dx', 'dy', 'color', 'size', 'dash'],
  text: ['text', 'color', 'size'],
  note: ['text', 'color', 'size'],
};

const finite = (n: unknown, max = MAX_COORD): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Accepts only shape records the renderer can draw safely; images and assets are not synced. */
export function validShapeRecord(rec: unknown, key: string): rec is ShapeRecord {
  if (!isPlainObject(rec) || rec.id !== key || typeof key !== 'string' || !ID_RE.test(key)) return false;
  if (rec.typeName !== 'shape' || !SHAPE_TYPES.includes(rec.type as any)) return false;
  if (!finite(rec.x) || !finite(rec.y) || !finite(rec.z) || !finite(rec.rot, 100)) return false;
  const props = rec.props;
  if (!isPlainObject(props)) return false;
  for (const [k, v] of Object.entries(props)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
    if (k === 'pts') {
      if (!Array.isArray(v) || v.length < 3 || v.length > MAX_PTS || v.length % 3 !== 0) return false;
      for (const n of v) if (!finite(n)) return false;
      continue;
    }
    if (k === 'assetId') return false;
    if (ENUMS[k]) {
      if (typeof v !== 'string' || !ENUMS[k].includes(v)) return false;
      continue;
    }
    if (typeof v === 'string') { if (v.length > MAX_TEXT) return false; continue; }
    if (typeof v === 'boolean') continue;
    if (!finite(v)) return false;
  }
  for (const k of REQUIRED[rec.type as string]) if (!(k in props)) return false;
  if (rec.type === 'geo' && !((props.w as number) > 0 && (props.h as number) > 0)) return false;
  if ('w' in props && (props.w as number) < 0) return false;
  if ('scale' in props && !((props.scale as number) > 0)) return false;
  return true;
}

const MAX_SCRIBBLES = 4;
const MAX_SCRIBBLE_POINTS = 80;

/** Trims laser trails for the wire and validates them on receipt. */
export function sanitizeScribbles(list: unknown): ScribbleStroke[] {
  if (!Array.isArray(list)) return [];
  const out: ScribbleStroke[] = [];
  for (const s of list.slice(-MAX_SCRIBBLES)) {
    if (!isPlainObject(s) || !Array.isArray(s.points)) continue;
    const points: { x: number; y: number }[] = [];
    for (const p of s.points.slice(-MAX_SCRIBBLE_POINTS)) {
      if (isPlainObject(p) && finite(p.x) && finite(p.y)) points.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
    }
    if (!points.length) continue;
    const opacity = finite(s.opacity, 1) ? Math.max(0, s.opacity) : 1;
    out.push({ points, opacity: Math.round(opacity * 100) / 100 });
  }
  return out;
}

export const BOARD_CHAT_MAX_TEXT = 2000;
export const BOARD_CHAT_KEEP = 200;

export type BoardChatItem = { id: string; text: string; alias: [number, number, number]; at: number; ttl?: number; _pk: string; _sig: string };
export type UnsignedBoardChatItem = Omit<BoardChatItem, '_pk' | '_sig'>;

/** Board chat messages from peers: short ids, bounded text, a wire alias, a sane timestamp and the author's signature fields. */
export function validBoardChatItem(value: unknown): value is BoardChatItem {
  if (!isPlainObject(value)) return false;
  const { id, text, alias, at, ttl, _pk, _sig } = value;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return false;
  if (typeof text !== 'string' || !text.trim() || text.length > BOARD_CHAT_MAX_TEXT) return false;
  if (!Array.isArray(alias) || alias.length !== 3 || !alias.every((n) => Number.isInteger(n) && n >= 0 && n < 360)) return false;
  if (!finite(at, 1e13) || at <= 0) return false;
  if (ttl !== undefined && !(Number.isInteger(ttl) && (ttl as number) >= 1 && (ttl as number) <= 3600)) return false;
  return validPublicKey(_pk) && typeof _sig === 'string' && /^[A-Za-z0-9_-]{86}$/.test(_sig);
}
