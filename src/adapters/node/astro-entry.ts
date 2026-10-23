// Server entry Astro builds for the Node target (dist/server/entry.mjs): a Fetch-level renderer the Node server calls.
import { createApp } from 'astro/app/entrypoint';

const app = createApp({ streaming: true });

export function render(request: Request, clientAddress: string, errorPage: (url: string) => Promise<Response>): Promise<Response> {
  return app.render(request, { routeData: app.match(request), addCookieHeader: true, clientAddress, prerenderedErrorPageFetch: errorPage });
}
