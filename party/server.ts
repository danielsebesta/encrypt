import { Server, getServerByName, type Connection } from 'partyserver';
import ChatRoom from './chat';
import WhiteboardRoom from './whiteboard';
import { ROOM_ROUTE_RE, connectionRequest, type Room, type RoomHost } from './access';

export type RealtimeEnv = {
  CHAT: DurableObjectNamespace<RoomServer>;
  CHAT_PERSISTENT: DurableObjectNamespace<RoomServer>;
  WHITEBOARD: DurableObjectNamespace<RoomServer>;
  WHITEBOARD_SAVED: DurableObjectNamespace<RoomServer>;
  ROOM_TURN_SECRET?: string;
};

export abstract class RoomServer extends Server<RealtimeEnv> {
  static options = { hibernate: false };
  protected abstract readonly room: Room;

  protected host(): RoomHost {
    const server = this;
    return {
      get name() { return server.name; },
      env: this.env as Record<string, unknown>,
      storage: this.ctx.storage,
      getConnections: () => this.getConnections(),
    };
  }

  onStart(): Promise<void> | void { return this.room.onStart?.(); }
  onConnect(conn: Connection): void { this.room.onConnect(conn); }
  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView): Promise<void> | void {
    if (typeof message === 'string') return this.room.onMessage(message, conn);
  }
  onClose(conn: Connection): void { this.room.onClose(conn); }
  onAlarm(): Promise<void> | void { return this.room.onAlarm?.(); }
}

export class ChatServer extends RoomServer {
  protected readonly room: ChatRoom = new ChatRoom(this.host());
}

// Saved rooms and boards get their own classes so live ones keep their storage-free code path and stored history can be pinned to one jurisdiction.
export class PersistentChatServer extends RoomServer {
  protected readonly room: ChatRoom = new ChatRoom(this.host(), { persistent: true });
}

export class WhiteboardServer extends RoomServer {
  protected readonly room: WhiteboardRoom = new WhiteboardRoom(this.host());
}

export class SavedWhiteboardServer extends RoomServer {
  protected readonly room: WhiteboardRoom = new WhiteboardRoom(this.host(), { saved: true });
}

// Stored history stays in the EU; local workerd has no jurisdictions, so development falls back to the plain namespace.
function pinnedToEu(namespace: DurableObjectNamespace<RoomServer>): DurableObjectNamespace<RoomServer> {
  try {
    return namespace.jurisdiction('eu');
  } catch {
    return namespace;
  }
}

export async function routeRealtimeRequest(request: Request, env: RealtimeEnv): Promise<Response | null> {
  const match = ROOM_ROUTE_RE.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  const namespaces: Record<string, () => DurableObjectNamespace<RoomServer>> = {
    main: () => env.CHAT,
    persistent: () => pinnedToEu(env.CHAT_PERSISTENT),
    whiteboard: () => env.WHITEBOARD,
    'whiteboard-saved': () => pinnedToEu(env.WHITEBOARD_SAVED),
  };
  const namespace = namespaces[match[1]]();
  const stub = await getServerByName(namespace, match[2]);
  return stub.fetch(connectionRequest(request));
}
