import { Server, getServerByName, type Connection } from 'partyserver';
import ChatRoom from './chat';
import WhiteboardRoom from './whiteboard';
import { connectionRequest, type RoomConnection, type RoomHost } from './access';

export type RealtimeEnv = {
  CHAT: DurableObjectNamespace<RoomServer>;
  WHITEBOARD: DurableObjectNamespace<RoomServer>;
  ROOM_TURN_SECRET?: string;
};

type Room = {
  onStart?(): Promise<void> | void;
  onConnect(conn: RoomConnection): void;
  onMessage(message: string, conn: RoomConnection): Promise<void> | void;
  onClose(conn: RoomConnection): void;
  onAlarm?(): Promise<void> | void;
};

const ROUTE_RE = /^\/parties\/(main|whiteboard)\/([0-9a-f]{64})$/;

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

export class WhiteboardServer extends RoomServer {
  protected readonly room: WhiteboardRoom = new WhiteboardRoom(this.host());
}

export async function routeRealtimeRequest(request: Request, env: RealtimeEnv): Promise<Response | null> {
  const match = ROUTE_RE.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  const namespace = match[1] === 'main' ? env.CHAT : env.WHITEBOARD;
  const stub = await getServerByName(namespace, match[2]);
  return stub.fetch(connectionRequest(request));
}
