# encrypt.click

**Your privacy is just a click away.**

Free, open-source privacy tools that run in your browser. Share an encrypted file or message with a link and a password, talk in encrypted chat rooms with calls and screen sharing, draw on an encrypted whiteboard, and use fourteen developer and privacy utilities. No account, no trackers, seven languages.

**Live:** [encrypt.click](https://encrypt.click)

## What it does

- **Share** a file or message. It is encrypted in your browser with AES-256-GCM, the ciphertext goes to temporary storage, and the recipient opens the link and types the password. Files up to 50 MB, kept for 24 hours.
- **Chat** in a room with a name and an optional password. Messages, calls, screen sharing and file drops are end-to-end encrypted. The server relays ciphertext and keeps no message history. Calls run over a TURN relay only, so participants never see each other's IP address.
- **Whiteboard** on a shared canvas, synced live and end-to-end encrypted. Drawings live only in the participants' browsers.
- **Privacy tools:** AES words, time capsule (time-lock encryption with [drand](https://drand.love/)), steganography, photo cipher, spectral cipher.
- **Developer tools:** UUID and ULID, token generator, bcrypt, HMAC, RSA, SSH and PGP keys, JWT decoder, Base64.

## Privacy model

| Runs in your browser | The server is involved |
| --- | --- |
| Encryption and decryption, key generation, every standalone tool | Ciphertext upload, short links, the drand proxy, realtime rooms, TURN credentials for calls |

Chat has no server-side history. The default mode keeps encrypted envelopes in participant browsers; disappearing modes keep nothing. Participant names are random aliases rendered in each viewer's language, so a name never reveals the language someone uses. The full write-up is at [encrypt.click/security](https://encrypt.click/security). Security reports: [security.txt](https://encrypt.click/.well-known/security.txt).

## Run it locally

Node 24.21 (`.nvmrc`) and pnpm 10 through corepack.

```bash
pnpm install
pnpm dev       # the site at http://localhost:4321, without chat and whiteboard rooms
pnpm build
pnpm preview   # the built Worker at http://localhost:4321, rooms included
pnpm test      # unit tests
pnpm check     # astro check
```

## How it is built

Astro 7 pages, Svelte 5 for the interactive tools, Tailwind CSS 4, one Cloudflare Worker with Durable Objects for the rooms (PartyServer).

- **Design system.** Tokens and component classes live in `src/styles/global.css`. Every page uses only those.
- **Languages.** English without a prefix, `cs`, `de`, `es`, `fr`, `sk` and `pl` under a path prefix. The Worker picks the language from `Accept-Language` on the first visit and from the `ec-lang` cookie once you choose one in the menu, so it works without JavaScript. Shared links keep their language. All strings live in `src/locales/*.json`.
- **Crypto.** `src/lib/crypto.ts`, `src/lib/chatCrypto.ts`, `src/lib/ghost/` and the room code in `party/`. Tests in `tests/`.

## Deploy

Production deploys from GitHub Actions on every push to `main` ([`deploy.yml`](.github/workflows/deploy.yml)), after tests, type check and build. `pnpm run deploy` does the same from a machine logged in with `wrangler login`. The build writes assets to `dist/client` and the Worker config to `dist/server/wrangler.json`; `scripts/merge-wrangler-routes.mjs` copies the custom domains and the `run_worker_first` patterns from `wrangler.toml` into it. Deploy assets and Worker together, because the CSP hashes in `_headers` are computed from the built scripts.

Repository secrets for the workflow:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Account id |

Worker secrets:

| Secret | Purpose |
| --- | --- |
| `ROOM_TURN_SECRET` | Random, at least 32 bytes. Signs the short-lived TURN grants issued to room participants and keys the per-client request budget hashes. Never expose it as a `PUBLIC_` variable. |
| `TURN_PROVIDER` | `cloudflare` |
| `CLOUDFLARE_TURN_TOKEN_ID`, `CLOUDFLARE_TURN_API_TOKEN` | Cloudflare Realtime TURN key |
| `RATE_LIMIT_SECRET` | Optional, separate key for request budget hashing |
| `FREEIMAGE_API_KEY` | Optional, one of the image upload hosts |

Wrangler loads `.env` automatically, so do not name a local variable `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN` unless it is the account token.

Durable Object classes: `SECURITY_BUDGET` (shared per-minute request budgets; the expensive APIs fail closed if it is unreachable), `CHAT` and `WHITEBOARD` (rooms at `/parties/main/<room>` and `/parties/whiteboard/<room>`). The per-client and global ceilings are in `src/worker.ts`. `/api/*` and `/parties/*` reject cross-site browser requests.

## Operational notes

- Room passwords derive an authorization capability that the relay receives, so it could try to guess a weak password offline. Room creation therefore requires at least 12 characters or the generated passphrase. Without a password the full `#k=…` link carries a random 256-bit secret; never send that link through a shortener.
- TURN credentials are valid for five minutes and are only issued against a signed grant. Set bandwidth quotas and billing alerts at the TURN provider; a request budget cannot cap traffic on an already allocated relay.
- The deployment manifest checked by `integrity-check.js` is a same-origin consistency check, not proof against a compromised host. Pages never contact GitHub from a visitor's browser; the star count is fetched at build time.
- Empty chat rooms delete their stored configuration after seven days.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE)
