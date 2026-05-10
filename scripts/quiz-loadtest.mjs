#!/usr/bin/env node
/**
 * Quiz E2E load test.
 *
 *   Open `/quiz` in browser, create a quiz, share the 6-digit PIN.
 *   Then run:
 *     node scripts/quiz-loadtest.mjs --pin=482195 --players=100
 *
 *   Players will appear in your lobby. Hit "Start game" in browser;
 *   bots auto-answer randomly with a small per-bot delay. Final stats
 *   print at the end.
 */

import { webcrypto } from 'node:crypto';
const subtle = webcrypto.subtle;

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const PIN = String(args.pin || '');
const N = Number(args.players || 50);
const PARTY_HOST = String(args.host || 'encrypt-chat.danielsebesta.partykit.dev');
const ANSWER_DELAY_MAX_MS = Number(args['answer-delay'] || 5000);
const STAGGER_MS = Number(args.stagger || 30);
const TIMEOUT_MS = Number(args.timeout || 600_000);

if (!/^\d{6}$/.test(PIN)) {
  console.error('Usage: node scripts/quiz-loadtest.mjs --pin=<6-digit PIN> [--players=100]');
  process.exit(1);
}

console.log(`Loadtest: ${N} players → wss://${PARTY_HOST}/parties/quiz/${PIN}`);
console.log(`Stagger: ${STAGGER_MS}ms · Random answer delay: 0-${ANSWER_DELAY_MAX_MS}ms`);
console.log('');

// ── Crypto helpers (matching src/lib/quizCrypto.ts) ─────────────────────────

function arrayToB64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToArray(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function generateEphemeralKeypair() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}
async function exportPublicKey(key) {
  const raw = await subtle.exportKey('raw', key);
  return arrayToB64url(new Uint8Array(raw));
}
async function importPublicKey(b64) {
  return subtle.importKey('raw', b64urlToArray(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}
async function deriveSharedKey(priv, pub) {
  return subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function importRoomKey(b64) {
  return subtle.importKey('raw', b64urlToArray(b64), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptMessage(key, plaintext) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  return arrayToB64url(combined);
}
async function decryptMessage(key, payload) {
  const data = b64urlToArray(payload);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ── Bot ─────────────────────────────────────────────────────────────────────

class Bot {
  constructor(idx) {
    this.idx = idx;
    this.nick = `Bot${String(idx).padStart(3, '0')}`;
    this.token = arrayToB64url(webcrypto.getRandomValues(new Uint8Array(16))).slice(0, 32);
    this.connId = null;
    this.hostConnId = null;
    this.keypair = null;
    this.roomKey = null;
    this.ws = null;
    this.t0 = 0;
    this.tConnect = 0;
    this.tHandshake = 0;
    this.tJoin = 0;
    this.answersAttempted = 0;
    this.answersAcked = 0;
    this.errors = 0;
    this.alive = true;
    this.gameFinished = false;
    this.lastRound = -1;
  }

  async start() {
    this.t0 = Date.now();
    this.keypair = await generateEphemeralKeypair();
    this.ws = new WebSocket(`wss://${PARTY_HOST}/parties/quiz/${PIN}`);

    this.ws.addEventListener('open', () => { this.tConnect = Date.now() - this.t0; });
    this.ws.addEventListener('error', () => { this.errors++; });
    this.ws.addEventListener('close', () => { this.alive = false; });
    this.ws.addEventListener('message', (ev) => this.onMessage(ev.data).catch(() => { this.errors++; }));
  }

  send(payload, to) {
    if (this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'envelope', to, payload }));
  }

  async sendEncrypted(payload, to) {
    if (!this.roomKey) return;
    const ciphertext = await encryptMessage(this.roomKey, JSON.stringify(payload));
    this.send({ type: 'enc', ciphertext }, to);
  }

  async onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'init': {
        this.connId = msg.connId;
        const pubKey = await exportPublicKey(this.keypair.publicKey);
        this.send({ type: 'dh-hello', pubKey });
        return;
      }
      case 'envelope': {
        const from = msg.from;
        const payload = msg.payload;
        if (!payload || typeof payload.type !== 'string') return;

        if (payload.type === 'host-online') {
          this.hostConnId = from;
          if (!this.roomKey) {
            const pubKey = await exportPublicKey(this.keypair.publicKey);
            this.send({ type: 'dh-hello', pubKey });
          }
          return;
        }
        if (payload.type === 'dh-welcome' && !this.roomKey) {
          try {
            const hostPub = await importPublicKey(payload.pubKey);
            const sharedKey = await deriveSharedKey(this.keypair.privateKey, hostPub);
            const roomKeyB64 = await decryptMessage(sharedKey, payload.encryptedRoomKey);
            this.roomKey = await importRoomKey(roomKeyB64);
            this.hostConnId = from;
            this.tHandshake = Date.now() - this.t0;
            await this.sendEncrypted({ type: 'p-join', nick: this.nick, token: this.token }, from);
          } catch {
            this.errors++;
          }
          return;
        }
        if (payload.type === 'enc') {
          if (!this.roomKey || from !== this.hostConnId) return;
          let inner;
          try { inner = JSON.parse(await decryptMessage(this.roomKey, payload.ciphertext)); } catch { return; }
          await this.handleHostMessage(inner);
        }
        return;
      }
    }
  }

  async handleHostMessage(payload) {
    switch (payload.type) {
      case 'h-join-ok':
        if (!this.tJoin) this.tJoin = Date.now() - this.t0;
        return;
      case 'h-state': {
        if (payload.phase === 'question' && payload.question && payload.currentIndex !== this.lastRound) {
          this.lastRound = payload.currentIndex;
          // schedule random answer
          const startedAt = payload.question.startedAt;
          const duration = payload.question.duration;
          const window = Math.min(ANSWER_DELAY_MAX_MS, duration);
          const delay = Math.max(0, startedAt - Date.now()) + Math.random() * window;
          setTimeout(() => this.submitRandomAnswer(payload.currentIndex), delay);
        } else if (payload.phase === 'finished') {
          this.gameFinished = true;
        }
        return;
      }
      case 'h-ack':
        this.answersAcked++;
        return;
    }
  }

  async submitRandomAnswer(index) {
    if (!this.alive || !this.roomKey) return;
    if (this.lastRound !== index) return;
    const choice = Math.floor(Math.random() * 4);
    this.answersAttempted++;
    await this.sendEncrypted({ type: 'p-answer', index, choice }, this.hostConnId);
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const bots = Array.from({ length: N }, (_, i) => new Bot(i));
const startTime = Date.now();

let progressInterval = setInterval(() => {
  const connected = bots.filter(b => b.tConnect > 0).length;
  const handshaked = bots.filter(b => b.tHandshake > 0).length;
  const joined = bots.filter(b => b.tJoin > 0).length;
  const finished = bots.filter(b => b.gameFinished).length;
  const dead = bots.filter(b => !b.alive).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r[${elapsed}s] connect:${connected}/${N} hs:${handshaked} join:${joined} finished:${finished} dead:${dead}      `);
}, 250);

for (let i = 0; i < N; i++) {
  await bots[i].start();
  await new Promise(r => setTimeout(r, STAGGER_MS));
}

console.log(`\n\nAll ${N} bots launched. Hit 'Start game' in your browser. Ctrl-C to stop.\n`);

process.on('SIGINT', () => printReport());
setTimeout(() => printReport(), TIMEOUT_MS);

async function printReport() {
  clearInterval(progressInterval);
  console.log('\n\n=== Loadtest report ===\n');

  const stats = (key) => {
    const arr = bots.map(b => b[key]).filter(v => v > 0).sort((a, b) => a - b);
    if (!arr.length) return null;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { n: arr.length, min: arr[0], avg: Math.round(avg), p50: arr[Math.floor(arr.length / 2)], p95: arr[Math.floor(arr.length * 0.95)], max: arr[arr.length - 1] };
  };

  const fmt = (s) => s ? `n=${s.n} min=${s.min}ms p50=${s.p50}ms avg=${s.avg}ms p95=${s.p95}ms max=${s.max}ms` : 'no data';

  console.log(`Connect:    ${fmt(stats('tConnect'))}`);
  console.log(`Handshake:  ${fmt(stats('tHandshake'))}`);
  console.log(`Join (E2E): ${fmt(stats('tJoin'))}`);
  console.log('');

  const attempted = bots.reduce((s, b) => s + b.answersAttempted, 0);
  const acked = bots.reduce((s, b) => s + b.answersAcked, 0);
  const errors = bots.reduce((s, b) => s + b.errors, 0);
  const finished = bots.filter(b => b.gameFinished).length;
  const dead = bots.filter(b => !b.alive).length;

  console.log(`Answers attempted: ${attempted}`);
  console.log(`Answers acked:     ${acked} (${attempted > 0 ? ((acked/attempted)*100).toFixed(1) : 0}%)`);
  console.log(`Errors:            ${errors}`);
  console.log(`Finished:          ${finished}/${N}`);
  console.log(`Dropped (closed):  ${dead}`);

  for (const b of bots) {
    try { b.ws?.close(); } catch {}
  }
  process.exit(0);
}
