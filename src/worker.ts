import { handle } from '@astrojs/cloudflare/handler';
import { ChatServer, WhiteboardServer } from '../party/server';
import { SecurityBudget, cloudflarePlatform, type CloudflareEnv } from './adapters/cloudflare/platform';
import { sweepExpiredUploads } from './adapters/cloudflare/sweep';
import { setRuntimeEnv } from './platform/env';
import { createApp } from './server/app';

export { ChatServer, WhiteboardServer, SecurityBudget };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    setRuntimeEnv(env);
    return createApp(cloudflarePlatform(env, ctx)).fetch(request, (req) => handle(req, env as any, ctx));
  },
  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(sweepExpiredUploads(env.BUCKET));
  },
};
