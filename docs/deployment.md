# Production deployment and verification

How encrypt.click itself is deployed and how a build can be verified. For running your own copy, see the [README](../README.md) and [self-hosting](self-hosting.md).

## encrypt.click

Production deploys from GitHub Actions on every push to `main` ([`deploy.yml`](.github/workflows/deploy.yml)), after tests, type check and build. `wrangler.toml` describes a fresh install; [`wrangler.production.json`](wrangler.production.json) adds what only encrypt.click has: the Worker name, the custom domains, the EU bucket and the variables for direct uploads to it, short links and the full Durable Object migration history. The build writes assets to `dist/client` and the Worker config to `dist/server/wrangler.json`; `scripts/merge-wrangler-routes.mjs` copies the `run_worker_first` patterns, the cron and the bucket from `wrangler.toml` into it and, given a file, lays that file over the result. The workflow passes `wrangler.production.json`, and `pnpm run deploy:production` does the same from a machine logged in with `wrangler login`; plain `pnpm run deploy` deploys a fresh install. Deploy assets and Worker together, because the CSP hashes in `_headers` are computed from the built scripts. A new Durable Object migration goes into both files, which `tests/r2-sweep.test.ts` checks.

Repository secrets for the workflow:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from the "Edit Cloudflare Workers" template, with R2 access for the upload bucket and Workers KV access for the shortener |
| `CLOUDFLARE_ACCOUNT_ID` | Account id |

Worker secrets:

| Secret | Purpose |
| --- | --- |
| `ROOM_TURN_SECRET` | Random, at least 32 bytes. Signs the short-lived TURN grants issued to room participants and keys the per-client request budget hashes. Never expose it as a `PUBLIC_` variable. |
| `TURN_PROVIDER` | `cloudflare` |
| `CLOUDFLARE_TURN_TOKEN_ID`, `CLOUDFLARE_TURN_API_TOKEN` | Cloudflare Realtime TURN key |
| `RATE_LIMIT_SECRET` | Optional, separate key for request budget hashing |
| `UPLOAD_PASS_SECRET` | Optional, separate key for upload passes and proof-of-work challenges; otherwise derived from the keys above |
| `SHORTENER_TOKEN` | Random, at least 32 bytes, the same value as on the shortener Worker. Authorizes `/api/shorten` to create short links. |
| `STATUS_TOKEN` | Optional. When set, `GET /status` (upload usage against the quotas, whether TURN is configured, build and uptime; aggregates only) requires `Authorization: Bearer <token>`; otherwise it is public. `BUILD_COMMIT_SHA`, as a plain variable, names the build it reports. |

Wrangler loads `.env` automatically, so do not name a local variable `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN` unless it is the account token.

Bindings: `SECURITY_BUDGET` (one Durable Object per budget scope: per-minute request ceilings, upload quotas, proof-of-work replay; the expensive routes fail closed if it is unreachable), `CHAT` and `WHITEBOARD` (rooms at `/parties/main|whiteboard/<room>`; they relay encrypted envelopes and keep at most a small room config, never a message), and `BUCKET`, the R2 bucket `encrypt-r2` in the EU jurisdiction (pass `--jurisdiction eu` to every `wrangler r2` command). Uploads are stored under one key prefix per retention class, `t1h/`, `t1d/` and `t7d/`, with the expiry time and the one-time flag in the object's custom metadata; the Worker refuses anything past its expiry, an hourly cron deletes it, and one lifecycle rule per prefix catches anything the cron missed. `SHORTENER_URL` in `wrangler.production.json` and the `SHORTENER_TOKEN` secret enable short links. The ceilings are in `src/server/app.ts`. `/api/*`, `/upload*`, `/dl/*` and `/parties/*` reject cross-site browser requests, and Worker logs are off.

Lifecycle rules for the upload bucket. R2 counts in whole days, so the 1-hour class is deleted after a day while the Worker already refuses it after an hour. Uploads from before the retention classes sit under their bare UUID; the rules for the prefixes `0` to `f` delete those after a day and can be removed two days after the deploy. Add the new rules first, then remove the old rule that covered the whole bucket (its name is in the `list` output), then deploy:

```bash
pnpm exec wrangler r2 bucket lifecycle list encrypt-r2 --jurisdiction eu
pnpm exec wrangler r2 bucket lifecycle add encrypt-r2 uploads-1h t1h/ --expire-days 1 --jurisdiction eu --force
pnpm exec wrangler r2 bucket lifecycle add encrypt-r2 uploads-1d t1d/ --expire-days 1 --jurisdiction eu --force
pnpm exec wrangler r2 bucket lifecycle add encrypt-r2 uploads-7d t7d/ --expire-days 7 --jurisdiction eu --force
for p in 0 1 2 3 4 5 6 7 8 9 a b c d e f; do pnpm exec wrangler r2 bucket lifecycle add encrypt-r2 uploads-legacy-$p $p --expire-days 1 --jurisdiction eu --force; done
pnpm exec wrangler r2 bucket lifecycle remove encrypt-r2 --name <old whole-bucket rule> --jurisdiction eu
```

## Short links

[`workers/shortener`](workers/shortener/src/index.ts) is the Worker behind `l.encrypt.click`, deployed by the same workflow right after the site (`wrangler deploy --config workers/shortener/wrangler.toml`). It only accepts receive links (`https://encrypt.click/u?p=…`) and only from encrypt.click's `/api/shorten`, which sends `SHORTENER_TOKEN`, so nobody can fill its KV namespace directly. Slugs are eight pronounceable letters (`badokemu`, about 41 million combinations) drawn without bias from `crypto.getRandomValues`. Each link is stored in KV with an expiry: until the upload expires, or 7 days for a message carried in the link (7 days after it unlocks when time-locked), computed in `src/server/shortLink.ts`. Opening a link is rate limited to 30 a minute per client and location, so slugs cannot be walked, and the redirect is a `302` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Set the same random `SHORTENER_TOKEN` on both Workers:

```bash
openssl rand -hex 32   # copy the value
pnpm exec wrangler secret put SHORTENER_TOKEN --name lencrypt
pnpm exec wrangler secret put SHORTENER_TOKEN --name encrypt-click
```

For your own instance, change `name`, the domain, the KV namespace id and `TARGET_ORIGIN` in [`workers/shortener/wrangler.toml`](workers/shortener/wrangler.toml), and point `SHORTENER_URL` at `https://<your short domain>/api/shorten`.

## Verify what is served

Every build publishes `/build-integrity.json`: the commit it was built from and the SHA-256 of every file. `scripts/verify-deployment.mjs` rebuilds nothing; it compares a build you made yourself with what a site serves, file by file, plus the response headers (CSP included) and redirects.

```bash
git clone https://github.com/danielsebesta/encrypt.git && cd encrypt
git checkout "$(curl -s https://encrypt.click/build-integrity.json | jq -r .commitSha)"
corepack enable && pnpm install --frozen-lockfile && pnpm build
node scripts/verify-deployment.mjs https://encrypt.click
```

It prints `OK` and exits 0, or lists every mismatch and exits 1. Use the Node version from `.nvmrc` and build on Linux (WSL or Docker on Windows): the same commit gives the same client files there, in any directory, apart from three harmless differences that the report names and ignores: the GitHub star count in the footer, Astro's island ids (they depend on the build path) and the bot-detection script Cloudflare appends to pages, which the CSP keeps from running.

`.github/workflows/verify-live.yml` runs the same check from a fresh GitHub runner after every deploy and every six hours: it rebuilds the deployed commit from source and fails if the site serves anything else. It also fails when Cloudflare refuses the runner, because then nothing was compared, so a passing run always means a real comparison.

The deploy workflow also signs the build. The manifest a site serves was produced by this repository's workflow if this succeeds:

```bash
curl -sO https://encrypt.click/build-integrity.json
gh attestation verify build-integrity.json --repo danielsebesta/encrypt
```

The same goes for the `encrypt-click-dist` artifact of a deploy run (client files and Worker bundle) and for the Docker build in `node.yml`. The check covers every static file the site serves. It cannot cover API responses or what Cloudflare itself serves under `/cdn-cgi/`. See [`self-hosting.md`](self-hosting.md#verifying-a-build) for self-hosted instances.

## Operational notes

- Room passwords derive an authorization capability that the relay receives, so it could try to guess a weak password offline. Room creation therefore requires a password of at least 16 characters that passes a strength check. Every room works this way; a room URL carries no secret, so links can be shared through anything.
- TURN credentials are valid for one hour and are only issued against a signed grant. Set bandwidth quotas and billing alerts at the TURN provider; a request budget cannot cap traffic on an already allocated relay.
- The deployment manifest checked by `integrity-check.js` is a same-origin consistency check, not proof against a compromised host; `scripts/verify-deployment.mjs` and the attestations above are the independent check. Pages never contact GitHub from a visitor's browser; the star count is fetched at build time.
- Empty chat rooms delete their stored configuration — the only thing a chat room ever stores — after seven days. A whiteboard room writes nothing to server storage: connected members relay encrypted updates, and each browser that has opened the board keeps a sealed local snapshot so the drawing survives leave/rejoin on that device.
