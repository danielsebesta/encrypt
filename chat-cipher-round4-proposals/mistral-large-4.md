# Mistral Large 4

I've read the full pipeline (`tableCodec.ts`, `compress.ts`, `huffman.ts`, `coverTable.ts`, `index.ts`, `passwordEnvelope.ts`, `build_tables.py`, table metadata). Here is the analysis.

## Baseline math (recomputed from the code, consistent with your benchmarks)

- ECP4 compact carries `12 fixed header (stripped) + 8 salt + 2 length + content + 8 tag`. So the cover pays **18 bytes of incompressible overhead** plus the compressed content. For the 46-char EN message: content = 18 B, carried = 36 B = 288 bits → 1153 chars ⇒ **~4.0 chars/bit at 1.62 bits/word (~6.5 chars/word)**. For the 52-char CS message: ~53 B content (Huffman didn't beat raw) → 71 B = 568 bits → 869 chars ⇒ **~1.5 chars/bit at 2.78 bits/word (~5.7 chars/word)**. Note ~44% of the EN cover is envelope overhead (salt+tag+length), which is why overhead shaving matters for short messages.

---

## 1. Ranked top 3 changes

### #1 — Temperature-flatten the word distributions at table-read time (zero rebuild)

**What:** shares are stored as `LUT[code] = round(65535·2^(−code/12))`, so `share^(1/T)` with `T = 2^k` is exactly `LUT[code >> k]`. Apply an integer shift in `parseCoverTable` (`tableCodec.ts:130,137`): `lut[Math.max(0, bytes[at+e] − k·? )]` — precisely `lut[bytes[at+e] >> k]`. The shift must be known to both sides: either hardcode a per-language constant in `coverTable.ts`, or bump ECT1→ECT2 and store `k` in the header (one u8). No regeneration needed for integer `k`; a non-integer temperature needs a rebuild via `steps()` in `build_tables.py`.

**Math:** your experiment: en flat 1.25 → 3.41 bits/word (vs 1.62), cs flat 1.1 → 7.34 (vs 2.78). Chars scale ~inversely with bits/word:
- EN 46-char: 1153 × 1.62/3.41 ≈ **~550 chars (−52%)**
- CS 52-char: 869 × 2.78/7.34 ≈ **~330 chars (−62%)**
Integer `k=1` (T=2) flattens harder than both measured points, so expect at least this much; tune `k`/temperature per language to stay plausible.

**Risk:** plausibility only — flatter covers pick rarer words; contexts still chain so it stays word-salad-ish, not random-word-salad. Decode is unaffected (encoder and decoder use the same shifted LUT; `MIN_MASS` safety floor still guarantees EOL/safety words are decodable). **Effort:** ~5 lines in `tableCodec.ts` + optional 1-byte header field. Cheapest big win by far.

### #2 — Word-level arithmetic coding of the *message* using the cover table's own n-gram model

**What:** the message is natural text in the cover language, but `packContent` (`compress.ts`) only tries byte-level codecs (raw / deflate-raw / static byte-Huffman). Add a branch: tokenize the message with the same folding as `foldWord`, arithmetic-code the word-id sequence with the same `distribution()` model from `tableCodec.ts`, and emit a new flag value (flags 0,1,2..8 are taken; extend to e.g. 16+lang). Keep the existing three branches and pick the shortest, so OOV-heavy or non-text messages fall back safely. Needs an UNK/escape path for out-of-vocab words and a decision on preserving original case/punctuation (either a small side-channel or accept normalized output — flag it explicitly in the UI).

**Math:** a 5-gram word model codes English chat at roughly 2.5–4 bits/word. The EN benchmark is ~9 words → ~25–40 bits ≈ **4–5 B payload vs 17 B today**, saving ~12–13 B = ~100 bits → at 4.0 chars/bit (and *more* after change #1, since bits/word rises) ≈ **−400+ chars (−35%+ on EN, compounding)**. The CS benchmark is stored ~raw at 53 B; ~10 words × ~4 bits ≈ 5 B + flag ⇒ save ~47 B ≈ 376 bits × 1.5 chars/bit ≈ **−560 chars (−60%+)**.

**Risk:** medium — encoder/decoder must use the byte-identical table (it does: pinned sha256 per lang/version; the flag already carries the lang id, and word-coding must also pin the table *version*); OOV and fidelity edge cases; more code in the hot path. **Effort:** medium — reuse `distribution()` from the codec in a new `wordPack/wordUnpack` (or extend `huffman.ts`-style module); new flag handling in `compress.ts`; tests in `tests/chat-cipher-compact.test.ts`.

### #3 — Shave fixed overhead: drop the u16 length in the compact envelope, slim the Huffman length prefix

**What:** in the chat-cipher path the arithmetic decoder already returns the exact byte count (`decode` returns `bytes.slice(0, written >> 3)`), so the 2-byte plaintext length in ECP4 is redundant there — GCM authenticates the exact ciphertext length regardless. Bump the layout byte (magic is already `[69,67,80,52,2]` → `…53,3]`) and make `openCompactBody` skip the length field for v3. Also `huffmanPack` wastes a u16 (2 B) on the payload length; for ≤255-byte messages 1 byte suffices (or a terminator symbol), saving ~1 B.

**Math:** ~3 B = 24 bits saved. EN: 24 × 4.0 ≈ **−95 chars (−8%)**; CS: 24 × 1.5 ≈ **−37 chars (−4%)**. Helps the empty-message floor (252 chars CS) most in relative terms.

**Risk:** low — integrity is unchanged (AAD + GCM tag cover everything); just keep v2 readers/writers separated by the version byte. **Effort:** small, confined to `passwordEnvelope.ts` + one branch in `compress.ts`/`huffman.ts`.

---

## 2. Overlooked ideas worth considering

- **The cs vocabulary (12 971 words, log2 ≈ 13.7 bits) is barely used at 2.78 bits/word** — that's mostly change #1, but also tune the build: lower `MINS`/`COUNT_MINIMUM` in `build_tables.py` to admit more 4/5-gram rows, and lower the `STOP = 655` cascade cutoff (tableCodec.ts) so the unigram level gets more than the ~1% leftover floor. Both push bits/word up at some plausibility cost.
- **Multiword tokens** (frequent phrases like "v pořádku" / "at the" as single emittable symbols): more bits per emitted unit; partially what n-gram *contexts* already exploit, but as *symbols* they'd raise bits per surface token. Needs table rebuild; watch char-per-token economics (space costs a char).
- **Try deflate-raw on top of the Huffman output** (and pick the shortest of 4 branches) — occasionally wins at 100–400 B sizes; nearly free at seal time since it's already the "pick shortest" pattern in `packContent`.
- **Replace static byte-Huffman with a static arithmetic coder over `TEXT_MODELS` weights** — a few percent on the payload, and it composes with #2's flag mechanism. Cheap since the coder in `tableCodec.ts` is already integer-only arithmetic.
- **Tune `GUARD_WINDOW`/`MIN_MASS`**: the repeat-suppression (`/16` mass cut) and the 16/65536 floor both burn bits; small but free knobs.
- **Punctuation glyph choice carrying ~1–2 bits per line end** — real capacity, but see below: I'd reject it.
- **Cover-language choice**: cs is densest per char; `decryptFromChatAuto` already finds the table by coverage, so nothing to change, just note that defaulting to cs when the UI language has no table maximizes capacity.

## 3. What NOT to do

- **Don't touch the crypto floor**: keep AES-256-GCM with the 64-bit tag, argon2id at 64 MiB/3/1, and the 8-byte random salt. The salt must stay per-message random — the IV is HKDF-derived from the salt-derived key, so a fixed or shrunk salt risks nonce reuse; and the 64-bit tag is already the accepted minimum (2^64 offline forgery per guess). No smaller tags, no weaker KDF, no dropping the header from the AAD.
- **Don't let punctuation, case, diacritics, or typos carry data.** Decode deliberately folds all of these (`parse`, `foldWord`, typo-tolerant `slotOf`) so the receiver can retype the cover. Making glyphs load-bearing breaks manual re-entry — a real usability regression for ~2 bits per sentence.
- **Don't flatten so hard the cover stops looking like chat.** Cap the temperature per language and validate with the existing corpus-quality test (`tests/chat-cipher-corpus-quality.test.ts`); implausible covers defeat the purpose even if shorter.
- **Don't compress after sealing** — ciphertext is incompressible; the order (compress → seal → cover) is load-bearing.
- **Don't remove self-description**: the flag byte (codec + language-model id) and the sha256-pinned, versioned table URLs are what make decode robust; keep them even when adding branches.
- **Don't remove the `MIN_MASS`/safety-word floor in `distribution()`** — it guarantees EOL and common words stay decodable regardless of context.

**Suggested order of implementation:** #1 first (minutes, −50–60% chars), then #3 (small, −4–8%), then #2 (the big payload win for short messages, compounding with #1).
