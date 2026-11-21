# Claude Sonnet (claude-sonnet-5-5)

# Next round of cover-shortening: ranked plan

I changed nothing in the repo. The measurements came from throwaway copies of `tableCodec.ts` in `/tmp/cc`, run on the shipped `en/1` and `cs/2` tables with 40–200 random payloads each.

## What I measured

| | en | cs |
|---|---|---|
| Net bits per word (random payload) | 2.42 | 3.0–3.15 |
| Cover chars per sealed byte | ~19 | ~12.5 |
| Words in table / 5-gram contexts | 1,510 / ~21k rows | 12,971 / ~190k rows |
| Words emitted after the data is fully resolved, before the text ends | 1.9 | 5.3 |

- **Density.** The brief's 1.62 and 2.78 bits/word don't reproduce. Mine are higher, so chars per byte are better than the brief implies.
- **Benchmark length.** The 46-char EN benchmark gives ~900 chars here, not 1153. Estimates below are percentages with the brief's baselines in brackets.
- **Where the sealed bytes go.** For EN, 48 B is salt 8 + length 2 + flag 1 + Huffman length 2 + payload 27 + tag 8. Only 27 of 48 bytes are message. The CS message is worse: the cs Huffman model comes out at ~6 bits/char (38 B payload for 47 chars) because every diacritic costs two byte-symbols.
- **After change 1** the 16 fixed bytes (salt plus tag) become about half the cover. That is ~300 chars EN and ~200 chars CS.

## Top 3 changes

### 1. Compress the message with the cover's own language model (largest win)

**Idea.** Use the n-gram table as a text compressor, in the same arithmetic coder as the cover. Today `tableCodec.decode()` already turns words into bytes, which is exactly a compressor. A message word costs −log2 P(word | context) bits instead of ~5 bits per char.

**Measured.** I summed those costs with the unmodified `distribution()` and charged 16 bits per escape:

| Message | LM cost | Huffman now |
|---|---|---|
| `meet me at the old station at nine, come alone` | ~14.7 B | 27–29 B |
| 3 other EN messages | 6.8–18.8 B | 21–35 B |
| CS 47-char message | ~14.5 B | 38–40 B |
| 3 other CS messages | 5.6–15.3 B | 22–38 B |

**What to build.**
- A new content mode `LMTEXT` in the flag byte. It uses the cover language's table, so no extra download.
- Tokenise with `/\p{L}+|\p{N}+|\s+|[^\p{L}\p{N}\s]+/u`. Code each token with a compression variant of `distribution()` that reserves a small ESC mass (~1/16) and END mass (~1/64) out of 65536.
  - Words go through the coder. Case is a ~0.1-bit flag per word.
  - Marks and newlines are EOL plus a small static mark-type symbol.
  - ESC introduces a literal run (digits, emoji, URLs, unknown words) spelled with the existing Huffman bytes.
  - END replaces both the Huffman length and the flag-length field.
- `packContent` keeps picking the shortest mode, so an OOV-heavy message is never worse than today.

**Files:**
- `tableCodec.ts`: export `encodeText` and `decodeText`, sharing `distribution()`, `findRow` and the range coder.
- `compress.ts`: new mode and `unpackContent` that needs the codec.
- `index.ts`: pass the codec into `packContent` and `unpackContent`.
- `tests/chat-cipher-compact.test.ts`: round-trip fuzz over odd text.

**Estimated savings** (alone, plus ~1.5 B of case and mark side-info):
- EN: −13 B of 48, so −27% (≈ −310 chars on 1153).
- CS: −25 B of ~66, so −40% (≈ −350 chars on 869).

**Risk: medium.**
- The tokeniser and reconstruction are the fiddly part.
- Integer math must stay exact. It reuses the existing code, so it is.
- Cover length becomes more content-dependent, but there is already no padding, and a one-shot message gives no compression oracle.

**Effort:** 3–5 days.

### 2. Framing diet (do this first: a day's work, zero security cost)

| Change | Saves |
|---|---|
| Drop the envelope u16 length in `passwordEnvelope.ts`. The GCM tag already authenticates the exact end, and `openPasswordWithSurplus` already tries each end. The false-accept chance per trial is 2^-64. | 2 B |
| Drop the Huffman u16 length in `huffman.ts`. Pad the last byte with 1-bits: the canonical all-ones prefix shorter than the longest code (MAX_LEN 15, so ≥ 8) never completes a symbol. | 2 B |
| Fold the flag byte into a 4-bit mode prefix at the start of the bitstream. | ~0.5 B |
| Optional: salt 8 → 6 B. Both IV and key derive from it, and a collision needs the same password and 2^-48 per pair (~2e-7 at 10^4 messages). | 2 B |

- **Savings.** −4.5 B (−9% EN, −7% CS; ≈ −105 and −60 chars). With the salt change −6.5 B. After change 1 those same bytes are 14–20% of the cover.
- **Risk:** low. Tests: `chat-cipher-huffman.test.ts`, the compact test, and the sealed-length helpers.
- **Effort:** about a day.

Changes 1 and 2 together: EN 48 → ~32 B (−33%, ≈ 1153 → ~770 chars); CS ~66 → ~33 B (−50%, ≈ 869 → ~435 chars).

### 3. Cap over-confident contexts (opt-in "compact" density)

**Idea.** The pasted "flatten" experiment helps but spreads mass into tail words. A cap on the top word's share instead moves mass only onto continuations the corpus attests after that context.

**What to build.** After blending and before the `MIN_MASS` filter, water-fill so no candidate exceeds share `c`. Integer-only. My prototype used floats just to measure.

**Measured** (round-trip checked):

| cap | en chars/byte | cs chars/byte |
|---|---|---|
| none | 18.7 | 12.5 |
| 0.9 | 18.3 | 12.3 |
| 0.8 | 16.4 | 11.6 |
| 0.7 | 13.6 (−27%) | 10.8 (−14%) |
| 0.6 | 11.2 (−40%) | 9.6 (−23%) |
| 0.5 | 9.9 | 9.6 |

- **Plausibility.**
  - cs at 0.6 reads as rambling but still chat Czech.
  - en at 0.7 is fine. At 0.6 en starts to collapse ("milk and breadd it, hm i still need stamps i checked the weather").
- **Suggested defaults:** `c` = 0.7 for all languages, 0.6 for a user-chosen compact mode on cs only.
- **Stacked on 1+2:** EN ~608 → ~440 chars at cap 0.7 (≈ −52% from today). CS ~412 → ~355 (≈ −57%).
- **Risk:** medium. The cap is runtime code rather than table data, so it breaks old covers (acceptable). A second density level means a second decode attempt, so argon2 runs again on a mismatch. Better to bake the level into a table version.
- **Effort:** 1–2 days, including the golden fixture in `chat-cipher-table.test.ts`.

## Overlooked ideas

| Idea | Verdict |
|---|---|
| **Bigger corpora for en, de, es, fr, sk, pl** | The single biggest structural gap. The en table is 1,510 words from ~19.5k bursts, partly phrasebank-generated ("one sec", "coffee run" loop in the samples). cs has 12,971 words from a ~60M-token pack. A comparable corpus per language should give en cs-like density plus less repetition, plausibly −25–35% for six of seven languages. Heavy effort, and licensing and quality are unverified. The cs corpus lives outside the repo (`C:\Users\dast\chat-model`), so I couldn't check it. |
| **Shorter natural tail** | After the data resolves the encoder picks random words to a natural EOL. Those words are free choices, so pick the likeliest 1–2-word ending, randomised among the top-k. Saves ~1.5 words EN (~7 chars) and ~4 words CS (~20 chars). Small. |
| **Better literal model** | Fallback only: a code-point alphabet instead of bytes saves ~2 B on diacritic-heavy cs. An order-1/2 static model could reach ~3.2 bits/char (estimate, not measured). |
| **Emoji after some sentence ends** | A fixed set of ~16 single-codepoint emoji without variation selectors or skin tones. Estimate ~+9% bits for ~2% more chars. Medium robustness risk across chat apps. Only after 1–3. |
| **Multiword tokens and sentence templates** | No density gain: bits per char is bounded by the model's entropy per char. They would only help n-gram reach or table size. |
| **Morphological endings** | cs already lists inflected forms as separate vocabulary words, so nothing extra. |
| **Dual-sequence spreads** | Splitting data across two streams adds framing and no density. Skip. |
| **Punctuation, case or diacritics carrying bits** | Mark type is ~1.5–2 bits per sentence end (~5–8%), but chat apps and people fold these. The "covers survive what chat apps do" test exists for this reason. Skip. |

## What not to do

- **Security:**
  - Don't shorten the tag below 64 bits, or use a fixed or message-derived salt.
  - Don't go below a 5–6 B random salt.
  - Don't reuse a key and IV.
  - Don't drop the end-of-ciphertext AEAD check.
- **Determinism:** no `Math.pow`, `log` or float rounding anywhere the encoder and decoder must agree. Engines can differ in the last bit, which makes covers undecodable. My flatten prototype used `pow` for measurement only.
- **Cover quality:**
  - Don't flatten the whole table to 7+ bits/word. It produces tail-word salad.
  - Don't remove the repetition guard, `STOP`, `MIN_MASS` or the EOL structure.
  - Don't add fixed lead-in or sign-off words, or always the same ending; both fingerprint the cover.
- **Fragile carriers:** no emoji with U+FE0F or skin-tone modifiers.

**Order of work:** 2, then 1, then 3, then the corpus work as its own project.
