# encrypt.click

**Your privacy is just a click away.**

Browser-first privacy toolkit: encrypt and share files, chat ephemerally, and use crypto utilities without accounts. Crypto runs in the browser; servers relay ciphertext and supporting metadata when you share, chat, or call. Localized in 7 languages.

**Live:** [encrypt.click](https://encrypt.click)

## Why it matters

- **Encrypted share** — encrypt in the browser, send a link; storage/relays handle ciphertext only
- **Ephemeral chat** — no server message history; optional disappearing messages; calls over TURN-only WebRTC (no direct peer IP exchange)
- **Collaborative whiteboard** — E2E-encrypted shared canvas without an account; no server drawing history after the room empties
- **Time Capsule** — time-lock encryption via [drand](https://drand.love/)
- **Privacy tools** — steganography, photo/audio ciphers, AES-with-words, and more
- **Developer tools** — JWT, bcrypt, HMAC, RSA/SSH/PGP keys, tokens, UUID/ULID, Base64

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

Realtime features also need PartyKit (`pnpm partykit:dev`). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contributor notes.

## Stack

Astro 5 · Svelte 5 · Tailwind CSS v4 · Cloudflare · PartyKit

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE)
