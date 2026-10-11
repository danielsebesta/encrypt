# encrypt.click

**Your privacy is just a click away.**

Browser-first privacy toolkit: encrypt and share files, chat ephemerally, and use crypto utilities without accounts. Crypto runs in the browser; servers relay ciphertext and supporting metadata when you share, chat, or call. Localized in 7 languages.

**Live:** [encrypt.click](https://encrypt.click)

## Why it matters

- **Encrypted share** - encrypt in the browser, send a link; storage/relays handle ciphertext only
- **Ephemeral chat** - no server message history; optional disappearing messages; calls over TURN-only WebRTC (no direct peer IP exchange)
- **Collaborative whiteboard** - E2E-encrypted shared canvas without an account; no server drawing history after the room empties
- **Time Capsule** - time-lock encryption via [drand](https://drand.love/)
- **Privacy tools** - steganography, photo/audio ciphers, AES-with-words, and more
- **Developer tools** - JWT, bcrypt, HMAC, RSA/SSH/PGP keys, tokens, UUID/ULID, Base64

## Privacy model (short)

| Runs in the browser | Server is involved |
| --- | --- |
| Encryption / decryption, key generation, most standalone tools | Short links, ciphertext upload (R2 + server-side fallbacks), drand proxy, realtime rooms (chat / whiteboard), TURN credentials for calls |

Chat does not keep a server-side message history. Default mode keeps encrypted envelopes in participant browsers; disappearing modes skip local history. Details: [/security](https://encrypt.click/security).

## Quick start

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

Dev server: `http://localhost:4321`

Realtime rooms (chat, whiteboard) run as Durable Objects inside the same Worker,
so `astro dev` serves everything except rooms. For rooms run `pnpm dev:worker`,
which builds and starts `wrangler dev`. See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for contributor notes.

## Stack

Astro 7 · Svelte 5 · Tailwind CSS v4 · Cloudflare Workers · PartyServer

## Security upgrade and deployment

Use Node 24.21+ and the pinned pnpm version. Run `pnpm test`, `pnpm check`,
`pnpm build`, and `pnpm audit` before publishing. TypeScript stays on 6.0.3
because the current Astro/Svelte checker integrations do not support TypeScript 7.

This version targets **Workers, not Pages**. The build writes public assets to
`dist/client` and worker configuration to `dist/server/wrangler.json`.
Production deploys run from GitHub Actions (`.github/workflows/deploy.yml`) on every
push to `main`, so the build log and the deployed commit are public. The workflow needs
the repository secrets `CLOUDFLARE_API_TOKEN` (an API token from the "Edit Cloudflare
Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. `pnpm run deploy` does the same from a
machine logged in with `wrangler login`.
Worker secrets: `ROOM_TURN_SECRET` (random, at least 32 characters; signs TURN grants
issued to joined chat participants), `TURN_PROVIDER=cloudflare`,
`CLOUDFLARE_TURN_TOKEN_ID` and `CLOUDFLARE_TURN_API_TOKEN` (a Realtime TURN key).
Optional: `RATE_LIMIT_SECRET` for request-budget IP hashing and `FREEIMAGE_API_KEY`
for one of the image upload hosts. Wrangler loads `.env` automatically, so never
name a local variable `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN` unless it is the
account token.
Three Durable Object migrations are required: `SECURITY_BUDGET` (shared request
budgets; expensive APIs fail closed if it cannot be reached), `CHAT` and
`WHITEBOARD` (PartyServer rooms, reached at `/parties/main/<room>` and
`/parties/whiteboard/<room>` on the site origin). The hosted PartyKit platform is
no longer used; delete the old `encrypt-click` PartyKit project after cutover.
Per-client and global per-minute request ceilings live in `src/worker.ts`;
review them against expected traffic before deployment. `/api/*` and `/parties/*`
reject cross-site browser requests (`Sec-Fetch-Site` / `Origin`), so other
websites cannot drive visitors' browsers through the relays.

New rooms use a separate password-derived authorization capability and channel
identifier. The relay receives that capability, so it could attempt an offline
guess of a weak typed password; room creation therefore requires at least 12
characters or the generated passphrase. Old clients and old room-name-only links
are intentionally incompatible; create and share a new room. Without a chosen
password, the full `#k=...` link carries a random 256-bit secret. Do not send
that full link to a shortener. Existing encrypted files and text remain
readable; long legacy file metadata is recovered after authentication. Old Photo
Cipher images retain their original password weakness: decrypt and re-encode
them to use the new public permutation format. Empty chat rooms delete their
stored configuration after seven days.

Set a random **at least 32-byte** `ROOM_TURN_SECRET` Worker secret. Never use a
`PUBLIC_` environment variable for it. It also keys the per-client request
budget hashes (override with `RATE_LIMIT_SECRET`). TURN issuance requires a
short-lived signed room grant and issues credentials valid for at most five
minutes. Configure Cloudflare TURN or coturn as before; reusable Metered
credentials are disabled. TURN provider bandwidth/allocation quotas and billing
alerts must also be configured at the provider: a web request budget cannot cap
traffic on an already allocated TURN connection. Without a valid grant secret,
calls cannot obtain relay credentials.

Rebuild and deploy assets together so CSP hashes match. Fixed script URLs now
revalidate and use a new cache key; the service worker retires old application
caches. The deployment manifest is a same-origin consistency check, not
independent proof that browser code or a compromised host is authentic; pages
no longer contact GitHub from visitors' browsers (the star count is fetched at
build time or by the Worker). Link ciphertext remains in the URL fragment and is
never sent to shorteners.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE)
