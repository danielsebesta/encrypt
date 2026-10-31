import { handle } from '@astrojs/cloudflare/handler';
import { ChatServer, PersistentChatServer, SavedWhiteboardServer, WhiteboardServer } from '../party/server';
import { SecurityBudget, cloudflarePlatform, type CloudflareEnv } from './adapters/cloudflare/platform';
import { setRuntimeEnv } from './platform/env';
import { createApp } from './server/app';

export { ChatServer, PersistentChatServer, WhiteboardServer, SavedWhiteboardServer, SecurityBudget };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    setRuntimeEnv(env);
    return createApp(cloudflarePlatform(env)).fetch(request, (req) => handle(req, env as any, ctx));
  },
};
