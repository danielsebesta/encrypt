# encrypt.click

A privacy-first, client-side-only security toolkit.

## Features

- **Text-to-Words**: Encrypt text into human-readable Czech words using AES-GCM-256 and a 16,384-word dictionary.
- **Hash Lab**: Verify file integrity with SHA-256 and SHA-512 browser-based hashing.
- **Password Entropy**: Real-time password strength analysis and Diceware passphrase generation.
- **Steganography**: Encrypt and hide messages within image pixels using LSB encoding and AES-GCM-256.

## Architecture

- **Zero-Knowledge**: No servers, no logs, and no database. All operations happen strictly in the browser.
- **Security**: Strict Content Security Policy (CSP), HSTS, and anti-translation measures.
- **Tech Stack**: Astro, Svelte, and Tailwind CSS.

## Development

1. Install dependencies: `yarn`
2. Start dev server: `yarn dev`
3. Build for production: `yarn build`

## Deployment

Optimized for Cloudflare Pages. Includes `wrangler.toml` and `public/_headers` for security and deployment configuration.
