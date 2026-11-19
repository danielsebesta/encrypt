export type PresenceState = { last: number; handled: Set<string> };

const MAX_HANDLED = 256;

export function newPresenceState(count = 0): PresenceState {
  return { last: count, handled: new Set() };
}

export function presenceDeparture(state: PresenceState, count: number, leftTag?: string): boolean {
  const previous = state.last;
  state.last = count;
  if (leftTag) {
    if (state.handled.has(leftTag)) return false;
    state.handled.add(leftTag);
    if (state.handled.size > MAX_HANDLED) state.handled.delete(state.handled.values().next().value as string);
    return true;
  }
  return count < previous;
}
