export class ToggleQueue {
  private flights = new Map<string, { sending: boolean; next?: boolean }>();

  async toggle(key: string, current: () => boolean, send: (on: boolean) => Promise<boolean>): Promise<void> {
    const flight = this.flights.get(key);
    if (flight) {
      flight.next = !(flight.next ?? flight.sending);
      return;
    }
    const state = { sending: !current(), next: undefined as boolean | undefined };
    this.flights.set(key, state);
    try {
      for (;;) {
        if (!(await send(state.sending))) return;
        const next = state.next;
        state.next = undefined;
        if (next === undefined || next === state.sending) return;
        state.sending = next;
      }
    } finally {
      this.flights.delete(key);
    }
  }
}
