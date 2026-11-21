# Devin SWE-2 (swe-2-high)

I have all the evidence. Here's the full analysis.

---

# Chat Cipher cover-shortening: verified measurements & next-round plan

## What I verified by running the actual code (tsx probes on this build)

**Pipeline**: `encryptToChat` = `packContent` → `sealPassword(compact)` → `stripFixedHeader` → `codec.encode`. The byte string the word coder carries is **not** the whole envelope — the 12-byte fixed header (magic+argon2 params) is stripped and re-added locally at decode. On the wire:

```
body = salt(8) + GCM( u16len(2) + flag(1) + payload ) + tag(8)   =  19 B fixed + payload
```

The `ECP4` magic costs **zero** cover bytes — it's never transmitted. Confirmed by `tests/chat-cipher-compact.test.ts:54` (empty → body 19 B).

**Measured density** (30-60 seeded encodes each):

| | cs/2 | en/1 |
|---|---|---|
| bits/word (words only) | **3.03** | **2.44** |
| bits/token (incl. EOL) | 2.65 | 1.58 |
| EOL share of tokens | 12.5% | **35%** |
| mean line length | 6.0 words | **1.8 words** |
| chars/bit | 1.55 | 2.36 |
| run-on tail (final unfinished line) | ~9.4 words (~7%) | ~2.1 words |
| vocab | 12 969 | 1 508 |
| diacritic mass (unigram) | 30.4% | 0% (ASCII vocab) |

Benchmarks reproduced: 46-char EN → payload 28 B → body 47 B → **~906 chars mean** (the brief's 1153 ≈ what unstripped 60 B or an unlucky seed yields — same rate). 46-char CS → body 51 B → **~810 chars**.

**Key finding the brief missed**: `bits/word` is NOT the metric — **chars/bit** is. The en table is weak mainly because its LLM-built corpus produces 1.8-word lines: 35% of tokens are EOLs worth only ~1.5 bits each (surprisal −log2(0.35) is small). cs's 12.5% EOLs are worth ~3 bits each for ~2 rendered chars — the *best* sink in the system. Two consequences: (a) removing EOL would make covers ~18% **longer** (bits it consumed move to fat word tokens); (b) en's problem is corpus shape, not just distribution skew.

Also verified: `TURN` is never emitted (builder excludes it as a following token; only seeds history), `keep`=65536 (LAMBDA=0 — the shipped flatten knob is unused), `MIN_MASS`=16 admits only candidates ≥~0.024% mass per step.

---

## Top 3 changes, ranked

### #1 — Shape the coding distribution at table build (temperature per row-size + length prior) — est. −45…−60% cover chars

Every entry in a context row is an *attested* continuation of that context — flattening a row is synonym-slot selection, not word salad. This is why the already-run experiment got −61%/−50% chars. Do it properly:

- **Where**: `scripts/chat-cipher-corpus/build_tables.py` — after `share = (count - DISCOUNT) / total` (line 215) and before `steps(share)` (line 248), apply `share_i → share_i^(1/T)` **within each row, renormalized to the row's original shareSum**. Renorming preserves the backoff weights exactly — only intra-row choice flattens. Same for the unigram block (line 261).
- **Per-row temperature** `T(row) = 1 + α·log(entries_in_row)`: rows with ~4k attested continuations (the `[EOL]` row has 3 791) flatten hard; 3-entry grammar rows stay sharp. This is strictly better than the global-T experiment and buys plausibility back.
- **Length prior** `share_i ∝ …·len(word)^(−β)`: direct chars/bit optimizer. Headroom is modest (~75% of unigram mass is already ≤4 chars) but it compounds with T.
- **en caveat**: at vocab 1 508, flattening runs out of tail quickly. en needs corpus regen anyway (see below) — until then cap en's T lower than cs's, or its weirdness shows.
- **Codec changes: zero.** Shares are baked; `tableCodec.ts` just reads them. Bump URL version (`/chat-cipher/<lang>/2/`), regen all 7 tables, update `COVER_TABLES` sha256 pins in `coverTable.ts:8-37`. Regenerate the golden fixture at `tests/chat-cipher-table.test.ts:104` (it's a pinned decode).
- **Math**: using their measured factors — en ~906 → **~450-530 chars**, cs ~810 → **~315-340**. Even if only half the measured gain survives the plausibility review it's the biggest lever by 3×.
- **Effort**: ~30 lines in the builder + regen + repin + sample eyeballing. **Risk**: medium — plausibility is the product constraint; needs a per-lang quality bar (generate 20 samples per lang × T, review). Watch `MIN_MASS` interplay: deeper flat pushes more tail words over the 16/65536 bar → larger candidate sets → slower `distribution()`; verify encode time stays ms-scale.

### #2 — ECP5 envelope: drop the u16 length + salt 8→6 B — est. −4 B ≈ −8%

- **u16 length is redundant**: `openPasswordWithSurplus` already finds the plaintext end by trying GCM verification at every candidate end (`passwordEnvelope.ts:215-222`). `openCompactBody` (`:189-198`) uses the length only as a consistency check the tag already provides. Delete the `LENGTH` prefix from the compact padded layout (`:107-111`) and return `plain` directly.
- **Salt 8→6 B**: argon salt = `SHA256(salt)[:16]` regardless (`:50-52`), so argon2 is unaffected. 48-bit salts still defeat precomputation at this tool's scale (collision needs ~16 M envelopes). 4 B is defensible too — I'd ship 6.
- **Files**: `passwordEnvelope.ts` (constants `HEADER_COMPACT`→18, `SALT_COMPACT`→6, drop `LENGTH` in compact paths, `sealedCompactLength`, surplus loop bound `headerLength + 1 + TAG`), new `ECP5_MAGIC`, size assertions in `chat-cipher-compact.test.ts:54-55`. `index.ts` untouched.
- **Math**: −4 B → en ~−76 chars (2.36 c/b) → ~830, cs ~−50 → ~760. Scales with everything else since it's a fixed offset.
- **Effort**: ~50 lines + test updates, half a day. **Risk**: low — the tag is the length check; no ambiguity. Ship this first.

### #3 — Static order-1 payload coder replacing Huffman — est. −7…−9 B ≈ −13-15%

- `huffmanPack` is order-0: the en benchmark costs 4.87 bits/char, cs 5.56. Order-1 conditional entropy for these languages is ~3.4-3.8 → en payload 28→~21 B, cs 32→~23 B.
- **Where**: new `src/lib/chatCipher/order1.ts` — a small integer range coder over per-lang `P(next byte | prev byte)` tables (256 conditional rows, sparse u16 cums ≈ 20-60 KB/lang baked in `textModel.ts`-style). Flags extend the existing scheme (`compress.ts:13`: `O1 + COVER_LANGS.indexOf(lang)` — flag byte has room). `packContent` keeps picking the shortest of {raw, deflate, order1}; deflate still wins ≥~200 chars.
- **Model source**: extend `scripts/build-chat-cipher-models.ts` — the clean corpora exist at `data/chat-cipher-<lang>/clean/all.clean.jsonl`; for cs keep synthesizing from the table but weight **folded** forms too (current cs model is weakest).
- **Math**: −7 B en → ~−135 chars; −9 B cs → ~−110. Combined with #2: en ~36 B → **~700**, cs ~38 B → **~650** *before* #1's density multiplier.
- **Effort**: ~200 LOC + model gen + round-trip tests (mirroring `huffman.ts` + its test). **Risk**: low-medium — integer-exactness must match decode; the existing test style (300 seeded round-trips) covers it. Order-2/PPM is ~1 more bit/char but not worth the model size/complexity now.

**Combined outcome if all three land**: en 47−4−7 = 36 B → 288 bits × ~1.2 c/b (flattened) ≈ **350-450 chars**; cs 51−4−9 = 38 B → 304 × ~0.6 ≈ **180-330 chars** — i.e., roughly a 2.5-3× shorter cover, ~3-6 chat lines. Security unchanged: AES-256-GCM, 64-bit tag, argon2id all preserved.

---

## Overlooked ideas worth considering

- **Fix the en corpus, not just its distribution.** en vocab is 1 508 words from a 12%-natural LLM corpus (`data/chat-cipher-TIER_SUMMARY.json`) producing 1.8-word lines. cs got 12 971 words from a real 60 M-token pack. More/longer natural en bursts raises vocab, deepens context rows, fixes the 35%-EOL pathology — improves density *and* plausibility at once. It's the only true free lunch; it's also the slowest (data pipeline).
- **Cap the run-on tail.** After the data is exhausted, `chooseWords` emits until an EOL shows up (`tableCodec.ts:312-319`) — ~9.4 words ≈ ~45 chars ≈ **7% of the cs cover**. Allow terminating mid-line after ≥2 extra words and render a trailing "…" (chats end mid-thought all the time). Small, free, and makes ends *more* natural.
- **EOL→`\n` render variant (free realism).** EOL already means "message boundary" in training (`build_tables.py:144`), but `render()` only emits punctuation. Letting ~15% of EOLs render as `\n` costs nothing (parse maps `\n`→EOL via `MARKS` already) and produces multi-line chat pastes — more plausible.
- **Emoji / digits / symbol tokens as density sinks.** A rare 1-2-char symbol is the best chars/bit deal in the system (emoji at 0.5% mass ≈ 7.6 bits for ~2 chars ≈ 0.3 c/b). Blocked today because `parse()` (`tableCodec.ts:408-416`) only tokenizes `\p{L}+` — non-letters vanish. Extending parse to recognize a small emoji/digit set as first-class tokens is medium effort, ~5-10% gain at low rates, plausible in chat — but it makes the cover fragile to transports that strip them; same fragility class as the variant channel.
- **Attested spelling-variant channel (opt-in only).** 30.4% of cs unigram mass has a diacritic display ≠ folded form; caps and attested spellings (`jsem`/`sem`) add ~0.3-0.5 bits/word for cs/sk/pl ≈ −10-15% chars at *zero* naturalness cost (variants are real spellings). Implement as per-word variant lists chosen by stream bits after the token pick. **Cost**: it breaks the deliberate "spelling never carries data" property — covers would no longer survive accent-folding/ALL-CAPS (the property `chat-cipher-table.test.ts:74-91` enshrines). Only as a compactness-vs-robustness mode flag.
- **Multiword/phrase tokens**: mostly *neutral* for chars/bit — a bigram token's surprisal ≈ the sum of its parts' joint cost, and it renders ~the sum of their chars. Real value: preserves collocations under flatten → lets T go deeper before quality degrades. Test as a fluency aid, not a density lever.
- **`keep` field**: already in the format (unused, =65536). keep<1 bleeds row mass to unigrams — a coarser flatten knob than per-row temperature. Prefer T.
- **Nibble-merge flag into Huffman's u16 length** (top bits): −1 B. And salt→4 B: −2 B more than #2 if 48-bit feels conservative.
- **Multi-cover splitting** for long messages (the "dual-sequence spread" idea as I'd read it): split ciphertext across 2-3 independently-coded covers pasted as separate messages — plausible for the >100-char case where one cover gets suspicious anyway.
- **Sentence-length shaping is near-optimal already — don't chase it.** EOL helps only while its surprisal stays >~1.3 bits (i.e., share <~40%). en at 35% is at the edge; the fix is longer en lines, which *reduces* EOL share toward cs's ~15% and raises per-EOL value simultaneously.

## What NOT to do

- **No salt removal, fixed salt, or derived salt** — any deterministic salt enables a precomputed argon2 dictionary that then opens every cover for free. The 8→6 B trim is safe; going below ~4 B isn't worth it. Salt must stay random *and* transmitted (any derivation from ciphertext is circular: salt is an encryption *input*).
- **No GCM IV tricks** — the current HKDF-derived IV is correct. A predictable or password-derived IV risks nonce reuse across envelopes = keystream reuse = plaintext recovery.
- **No tag <64-bit** — already the accepted floor. No argon2 weakening (it's orthogonal to length anyway).
- **No data in whitespace, zero-width chars, homoglyphs, or double-spaces** — transports strip them (corruption), and they're a classic stego tell that fails the "innocent-looking" goal.
- **Don't make the spelling-variant channel the default** — it forfeits the fold/case/accent robustness the codec deliberately buys today (and tests enforce). Opt-in mode only.
- **Don't remove EOL tokens and don't inflate EOL rate** — measured counterproductive both ways; keep the natural ~12-20% rate (fix en's 35% via corpus, not knobs).
- **Don't flatten row sums / backoff weights** — only intra-row distributions. Flattening `weight` flow destroys context trust → unigram soup.
- **Don't drop the flag byte or self-describing payload** — unpacking must stay language-independent. Keep the BAN filter on regen. Don't re-add Padmé/length-hiding — exact size is already masked inside ciphertext by design, and padding defeats the goal.
- **Don't try to compress the ciphertext or the salt** — near-uniform already.

**Suggested landing order**: #2 (ship immediately, no quality risk) → #1 sweep + en corpus regen (the big win, needs the plausibility review) → #3 (independent, slots in anytime).
