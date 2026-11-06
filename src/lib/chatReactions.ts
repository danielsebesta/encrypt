import { isEmoji } from './emoji';

export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;
export type ReactionEmoji = string;

const MESSAGE_REF_RE = /^[A-Za-z0-9_:-]{1,64}$/;
const MAX_TARGETS = 2000;
const MAX_EMOJI_PER_TARGET = 20;

export function validMessageRef(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_REF_RE.test(value);
}

export function validReactionEmoji(value: unknown): value is ReactionEmoji {
  return isEmoji(value);
}

export type ReactionEvent = {
  id: string;
  target: string;
  emoji: ReactionEmoji;
  remove: boolean;
  reactor: string;
  name: string;
  at: number;
};

type Mark = { on: boolean; at: number; id: string; name: string };

export type ReactionSummary = { emoji: ReactionEmoji; count: number; mine: boolean; names: string[] };

/**
 * Reactions folded per message, emoji and reactor. The latest event of a reactor wins, so applying the same events again or
 * in another order, as history replay and live delivery do, always ends in the same state.
 */
export class ReactionBook {
  private targets = new Map<string, Map<ReactionEmoji, Map<string, Mark>>>();

  apply(event: ReactionEvent): boolean {
    if (!validMessageRef(event.target) || !validReactionEmoji(event.emoji) || !event.reactor) return false;
    let byEmoji = this.targets.get(event.target);
    if (!byEmoji) {
      if (this.targets.size >= MAX_TARGETS) this.targets.delete(this.targets.keys().next().value as string);
      byEmoji = new Map();
      this.targets.set(event.target, byEmoji);
    }
    let marks = byEmoji.get(event.emoji);
    if (!marks) {
      if (byEmoji.size >= MAX_EMOJI_PER_TARGET) return false;
      marks = new Map();
      byEmoji.set(event.emoji, marks);
    }
    const current = marks.get(event.reactor);
    if (current && (current.at > event.at || (current.at === event.at && current.id >= event.id))) return false;
    marks.set(event.reactor, { on: !event.remove, at: event.at, id: event.id, name: event.name });
    return true;
  }

  has(target: string, emoji: ReactionEmoji, reactor: string): boolean {
    return Boolean(this.targets.get(target)?.get(emoji)?.get(reactor)?.on);
  }

  mine(target: string, reactor: string): string[] {
    const byEmoji = this.targets.get(target);
    if (!byEmoji) return [];
    return [...byEmoji].filter(([, marks]) => marks.get(reactor)?.on).map(([emoji]) => emoji);
  }

  summary(target: string, me: string, meLabel?: string): ReactionSummary[] {
    const byEmoji = this.targets.get(target);
    if (!byEmoji) return [];
    const out: (ReactionSummary & { first: number })[] = [];
    for (const [emoji, marks] of byEmoji) {
      const on = [...marks.entries()].filter(([, mark]) => mark.on);
      if (!on.length) continue;
      const first = Math.min(...on.map(([, mark]) => mark.at));
      out.push({ emoji, first, count: on.length, mine: on.some(([reactor]) => reactor === me), names: on.map(([reactor, mark]) => reactor === me && meLabel ? meLabel : mark.name) });
    }
    return out
      .sort((a, b) => a.first - b.first || (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0))
      .map(({ first: _first, ...rest }) => rest);
  }

  forget(target: string) {
    this.targets.delete(target);
  }

  clear() {
    this.targets.clear();
  }
}
