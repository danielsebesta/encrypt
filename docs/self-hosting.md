# Self-hosting encrypt.click

The code that runs encrypt.click on Cloudflare Workers also runs as one long-lived Node.js process. The Docker image bundles everything a public instance needs:

- the Node server: pages, APIs, ciphertext uploads and the chat and whiteboard rooms (WebSockets, state in SQLite),
- [Caddy](https://caddyserver.com) for automatic HTTPS when `DOMAIN` is set,
- [coturn](https://github.com/coturn/coturn) as the TURN relay for calls between browsers that cannot reach each other directly.

Browsers only expose Web Crypto on HTTPS pages (and on `localhost`), so a public instance needs a domain and a certificate.

## Quick start

On a Linux host with Docker whose DNS name already points at it:

```bash
git clone https://github.com/danielsebesta/encrypt.git && cd encrypt
docker build -t encrypt-click .
docker run -d --name encrypt --restart unless-stopped --network host \
  -e DOMAIN=encrypt.example.com -e ACME_EMAIL=admin@example.com \
  -v encrypt-data:/data encrypt-click
```

Open `https://encrypt.example.com`. Caddy fetches the certificate on the first request, secrets are generated into the volume on the first start, and coturn listens on port 3478.

To try it on your own machine without a domain:

```bash
docker run --rm -p 8080:8080 encrypt-click
```

`http://localhost:8080` works in the browser on that machine. Without `DOMAIN`, `PUBLIC_URL` or `TURN_HOST` the TURN relay stays off.

## Docker Compose

[`docker-compose.yml`](../docker-compose.yml) is the same setup. Set `DOMAIN`, then:

```bash
docker compose up -d --build
```

It uses host networking. If you cannot (Docker Desktop, or you prefer explicit port mappings), the file shows the `ports:` alternative; then also set `TURN_EXTERNAL_IP` to the server's public address so coturn advertises it instead of the container address.

## Configuration

Everything is set with environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOMAIN` | none | Public host name. Starts Caddy on ports 80 and 443 with a Let's Encrypt certificate, and sets `PUBLIC_URL=https://$DOMAIN`, `TRUST_PROXY=1` and `HOST=127.0.0.1`. |
| `ACME_EMAIL` | none | Contact address for Let's Encrypt. |
| `PUBLIC_URL` | `https://$DOMAIN` | Origin the site is reached at. Requests are treated as coming to this origin, which the same-origin checks and link handling rely on. Set it when your own proxy terminates TLS. |
| `PORT` | `8080` | Port of the Node server. |
| `HOST` | all interfaces | Address the Node server binds to. |
| `TRUST_PROXY` | off | Number of reverse proxies in front of Node whose `X-Forwarded-For` and `X-Forwarded-Proto` are believed (`true` means 1). Leave it off when Node is reachable directly, or clients can pick their own address for rate limits. |
| `DATA_DIR` | `/data` | Where rooms, uploads, rate-limit state, secrets and certificates live. |
| `ROOM_TURN_SECRET`, `RATE_LIMIT_SECRET`, `UPLOAD_PASS_SECRET`, `TURN_AUTH_SECRET` | generated | Random secrets (32 bytes or more). Values you do not pass are generated once into `$DATA_DIR/secrets`. |
| `TURN_ENABLED` | `auto` | `false` keeps the bundled coturn off. |
| `TURN_HOST` | `DOMAIN`, or the host of `PUBLIC_URL` | Name browsers use to reach the TURN relay. |
| `TURN_PORT` | `3478` | TURN listening port, UDP and TCP. |
| `TURN_MIN_PORT`, `TURN_MAX_PORT` | `49152`, `49251` | UDP relay port range. |
| `TURN_EXTERNAL_IP` | none | Public IP address, when coturn sits behind NAT (port mappings instead of host networking). |
| `TURN_REALM` | `TURN_HOST` | TURN realm. |
| `TURN_USER_QUOTA`, `TURN_TOTAL_QUOTA` | `12`, `1200` | Relay allocations per credential and in total. |
| `TURN_MAX_BPS` | `625000` | Bytes per second one relay session may carry, about 5 Mbit/s. |
| `TURN_LOG` | `false` | `true` sends coturn's log, with client addresses, to the container log. |
| `TURN_PROVIDER`, `TURN_URLS` | `coturn` | For another TURN service, set `TURN_ENABLED=false` and either `TURN_URLS` (comma-separated `turn:` URLs of a coturn that shares `TURN_AUTH_SECRET`) or `TURN_PROVIDER=cloudflare` with `CLOUDFLARE_TURN_TOKEN_ID` and `CLOUDFLARE_TURN_API_TOKEN`. |
| `UPLOAD_DAILY_GB` | `100` | Upload volume per day for everyone. Uploads are kept for 1 hour, 24 hours or 7 days, as the sender chooses, and every upload counts once for each day it is kept (a 7-day upload counts seven times its size), so this is roughly the disk space uploads can take. |
| `UPLOAD_CLIENT_DAILY_GB` | `5` | Upload volume per day for one client (IPv4 address or IPv6 /64), counted the same way. |
| `UPLOAD_MONTHLY_GB`, `UPLOAD_MONTHLY_FILES` | `1000`, `500000` | Monthly upload ceilings. |
| `SHORTENER_URL` | none | HTTPS endpoint of a Shlink-style shortener for receive links. Without it links stay long. |
| `STATUS_TOKEN` | none | When set, `/status` answers only requests with `Authorization: Bearer <token>`. Without it `/status` is public. |
| `BUILD_COMMIT_SHA` | from `build-integrity.json` | Commit `/status` reports. The Docker build records it from `--build-arg COMMIT_SHA`. |

## Ports

| Port | Protocol | Purpose |
| --- | --- | --- |
| 80 | TCP | Certificate challenges and the redirect to HTTPS (with `DOMAIN`). |
| 443 | TCP, UDP | HTTPS and HTTP/3 (with `DOMAIN`). |
| 8080 | TCP | The Node server, when there is no `DOMAIN`. With `DOMAIN` it only listens on `127.0.0.1`. |
| 3478 | UDP, TCP | TURN. |
| 49152-49251 | UDP | TURN relay range. |

Calls connect browsers directly. When both sides sit behind strict NATs or firewalls, the media goes through the relay instead, and every relayed participant holds one port from the range, so 100 ports carry about 50 relayed participants at once. Widen the range for bigger instances; with host networking that costs nothing. Media stays end-to-end encrypted: every audio and video frame is sealed in the browser with AES-256-GCM under keys only the call members hold, inside DTLS-SRTP, and the relay never reaches private, loopback or reserved addresses.

## HTTPS options

- **Bundled Caddy.** Set `DOMAIN` and open ports 80 and 443. Certificates and the ACME account are kept in `$DATA_DIR/caddy`.
- **Your own reverse proxy.** Leave `DOMAIN` unset and set `PUBLIC_URL=https://your.host`, `TRUST_PROXY=1` and `TURN_HOST=your.host`. Make sure only the proxy can reach port 8080. The proxy has to pass WebSocket upgrades (rooms live under `/parties/`), accept request bodies up to 100 MB, replace rather than append to `X-Forwarded-For`, and keep no access logs, because URLs can carry encrypted payloads. For nginx:

  ```nginx
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }

  server {
    # listen 443 ssl; server_name, certificates ...
    access_log off;
    client_max_body_size 100m;
    location / {
      proxy_pass http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_request_buffering off;
      proxy_set_header Host $host;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
  ```

The pages send `Strict-Transport-Security` with `includeSubDomains` like encrypt.click does, which covers subdomains of the host you serve it on.

## Status

`GET /status` returns aggregates for monitoring, as JSON with `Cache-Control: no-store`:

```json
{
  "status": "ok",
  "build": "fbe8858…",
  "uptimeSeconds": 86400,
  "turn": { "configured": true, "providers": ["coturn"] },
  "uploads": {
    "available": true,
    "today": { "bytes": 1200000000, "uploads": 41 },
    "month": { "bytes": 9100000000, "uploads": 380 },
    "limits": { "dailyBytes": 100000000000, "monthlyBytes": 1000000000000, "monthlyUploads": 500000, "clientDailyBytes": 5000000000, "maxFileBytes": 95420416 }
  }
}
```

`today` is the current UTC day. Upload bytes are counted the way the quotas count them, once per day an upload is kept. `status` is `degraded` and `uploads` is `null` when the accounting database cannot be reached. Nothing in the answer concerns a single client. It is public unless `STATUS_TOKEN` is set, and it shares the per-minute request limits of the other API routes (30 requests a minute per client):

```bash
curl -H "Authorization: Bearer $STATUS_TOKEN" https://your.host/status
```

## Data and backups

Everything lives in the `/data` volume:

| Path | Contents |
| --- | --- |
| `rooms.sqlite` | Saved chat rooms (encrypted history the server cannot read) and room settings and expiry times. |
| `uploads/` | Encrypted uploads. Each is refused from its expiry time on (1 hour, 24 hours or 7 days after it was stored, or right after its first download if the sender chose that), and an hourly sweep deletes the files. |
| `uploads.sqlite` | Expiry time and one-time flag of each upload. Files without an entry expire 24 hours after they were written. |
| `budget/` | Rate-limit and upload accounting. Safe to lose. |
| `secrets/` | Generated secrets. Losing them only invalidates short-lived grants and upload passes. |
| `caddy/` | Certificates and the ACME account. |

`rooms.sqlite` is the only file worth backing up. Take a consistent copy while the container runs:

```bash
docker exec encrypt node -e "new (require('node:sqlite').DatabaseSync)('/data/rooms.sqlite').exec(\"VACUUM INTO '/data/rooms-backup.sqlite'\")"
docker cp encrypt:/data/rooms-backup.sqlite . && docker exec encrypt rm /data/rooms-backup.sqlite
```

The server writes no request logs, Caddy keeps no access log, and coturn logs nothing unless `TURN_LOG=true`.

## Upgrading

```bash
git pull
docker compose up -d --build
```

On `docker stop` the server closes room connections cleanly and the browsers reconnect when it is back. Stored data carries over between versions.

## Verifying a build

`pnpm run build:node` and the Docker build write `dist/client/build-integrity.json` with the commit and the SHA-256 of every served file, and the server publishes it at `/build-integrity.json`. The same script that checks encrypt.click checks your instance, or a friend's, against the public source:

```bash
git clone https://github.com/danielsebesta/encrypt.git && cd encrypt
git checkout <commit from https://your.host/build-integrity.json>
corepack enable && pnpm install --frozen-lockfile
pnpm run build:node
node scripts/verify-deployment.mjs https://your.host
```

The script compares every listed file, the response headers from `_headers` (including the CSP script hashes) and the `_redirects` rules with what the host really serves, prints `OK` or each mismatch, and exits 1 on any mismatch. `--dist` points it at another build output, `--verbose` lists every file.

- **Same commit, same operating system.** The client files are byte-identical when built from the same commit with the same `pnpm-lock.yaml` on Linux (the official deployment is built on Ubuntu with the Node version in `.nvmrc`). On Windows the bundler lays the files out differently, so build in WSL or Docker: `docker run --rm -v "$PWD":/src -w /src node:24 sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm run build:node"`. Pass the commit and its date to `docker build` as `--build-arg COMMIT_SHA=$(git rev-parse HEAD) --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)` so the image records them.
- **Line endings.** The repository forces LF in `.gitattributes`, so a Windows checkout hashes like a Linux one.
- **Ignored on purpose.** The GitHub star count in the footer (fetched while building), Astro's island ids (derived from the build path) and the bot-detection script Cloudflare appends to pages, which the CSP keeps from running, differ between honest builds. The report names each such page; any other difference is a mismatch.
- **What it proves.** That the static files served right now are the ones this commit builds, and that the security headers are the committed ones. It cannot see the server code behind `/api` and `/parties`, or anything an intermediary adds to responses beyond the cases above.
- **Provenance.** On encrypt.click the deploy workflow signs the build with GitHub's build provenance. `gh attestation verify build-integrity.json --repo danielsebesta/encrypt` shows that a downloaded manifest, or the `encrypt-click-dist` and `encrypt-click-node-dist` archives from a workflow run, came out of this repository's workflow at a given commit. The Docker job in `node.yml` also attests the digest of the image it built; the image is not published anywhere, so that attestation names the CI build and cannot be checked against a registry.

## Differences from encrypt.click on Cloudflare

- **One instance.** All rooms live in one process. Run exactly one container per data volume; a second copy would split rooms between processes.
- **No jurisdiction pinning.** Saved rooms and uploads are stored where your server is. encrypt.click pins them to the EU.
- **No edge network.** No CDN, no DDoS protection in front, and rate limits count only what reaches this one server.
- **Uploads on local disk.** Size `UPLOAD_DAILY_GB` to the free space on the volume.

## Without Docker

You need Node.js 24 (it includes `node:sqlite`) and pnpm through corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build:node
DATA_DIR=./data PORT=8080 pnpm run start:node
```

`dist/` is self-contained: copy it to the server and start `node dist/node/server.mjs`, no `node_modules` needed. Put it behind a reverse proxy with HTTPS as described above, set the four secrets (for example from `openssl rand -hex 32`), and let your process manager send `SIGTERM` to stop it. For calls through a relay, run coturn with `use-auth-secret` and `static-auth-secret` set to `TURN_AUTH_SECRET`, and set `TURN_PROVIDER=coturn` and `TURN_HOST`.
