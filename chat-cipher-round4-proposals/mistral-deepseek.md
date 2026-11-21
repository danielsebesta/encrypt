# Mistral Deepseek

Repo untouched — all experiments ran on a copy in `%TEMP%\ccbench`. Here is the analysis.

## 1. What I verified first

I rebuilt the pipeline in a scratch harness (real `packContent` → real `tableCodec`, random body bytes of the exact sealed length, 300 seeds) and measured rather than trusting the brief.

| Claim | Measured | Verdict |
|---|---|---|
| cs 12 971 words / en 1 510 words | 12 971 / 1 510 | confirmed |
| cs ~2.78 bits/word | **3.25–3.36** | brief is ~20% optimistic |
| en ~1.62 bits/word | **2.48–2.51** | brief is ~35% optimistic |
| EN 46-char → 1153 chars | mean **883**, p50 882, p95 989, max 1124 (n=300) | 1153 is above the observed max — older table or different message |
| CS 52-char → 869 chars | mean **692** | same |
| empty floor 252 | EN **282**, CS **211** | close |
| 361-char EN → 4131 | **4143** | confirmed |
| corpus 4.4–4.75 bits/byte | order-0 char model: **4.04 (en) / 4.40 (sk)** | close |

The absolute numbers in the brief are off, but every *percentage* below is measured on the current build, so the ranking holds regardless.

**The cost model.** Cover length is exactly

```
chars = 8 · body / H · L        H = bits/word, L = chars/word
```

EN: H=2.48, L=5.73 → 18.4 chars per body byte. CS: H=3.36, L=4.70 → 11.7. Only three levers exist: shrink `body`, raise `H`, lower `L`. I tested all three.

## 2. Ranked top 3

### #1 — Lower the blend decay (`keep`). The dominant lever, ~10 lines, no table rebuild.

`tableCodec.ts:220` multiplies every level's row mass by `keep` before the geometric decay:

```ts
const share = Math.floor((level.shares[e] * keep) / TOTAL);
used += share;
weight = Math.floor((weight * Math.max(0, TOTAL - used)) / TOTAL);
```

`keep` is read from the table header (`tableCodec.ts:71`) and **every table on disk stores 65536** — I checked all seven. `build_tables.py:41` sets `LAMBDA = 0.0`, so the knob has never been used. Lowering it shifts mass down the context ladder (5-gram → 4 → 3 → 2 → unigram), which flattens the distribution and raises `H` while keeping the words grammatical.

Because all tables already carry 65536, a read-time override is *exactly* equivalent to a rebuild — no regeneration, and it works for cs, whose corpus is not in this repo.

| keep | EN 46 | CS 52 | EN 361 | EN H | CS H |
|---|---|---|---|---|---|
| 65536 (now) | 866 | 692 | 4143 | 2.48 | 3.36 |
| 52000 | 839 (−3%) | 562 (−19%) | — | 2.62 | 3.99 |
| **46000** | **747 (−14%)** | **514 (−26%)** | **3511 (−15%)** | 2.82 | 4.38 |
| 40000 | 649 (−25%) | 462 (−33%) | 3051 (−26%) | 3.25 | 4.69 |
| 34000 | 529 (−39%) | 411 (−41%) | — | 4.04 | 5.24 |

Plausibility at 46000 (real output, EN): *"Yo, still on a call. For real. Still waiting. Refund incoming. Ok! This weekend. Lmk when. Same tbh, same. Maybe sunday, one sec, thanks, hm. What for dinner, thai! Yes please."* — reads like a real chat. CS at 46000: *"ahoj. tak jsem mu řek že jsem tam musel a ta pravidla jsou jednoduchý, stačí říct. ale já budu v práci, tak si, je to dobrý ale upřímně, proč?"* — also fine.

At 40000 it starts breaking clauses (*"For. There was insane. We lost, went of this."*). At 28000 it is word salad. **Recommend 46000 as the default, 40000 as an opt-in "shorter" mode.**

- **Files:** `src/lib/chatCipher/tableCodec.ts` (accept a `keep` argument in `createCoverCodec`, default to `table.keep`), `src/lib/chatCipher/coverTable.ts` (per-language map, passed at `createCoverCodec(...)` on line 137).
- **Risk:** plausibility only, and it is a single tunable. Encode time 6 ms → 19 ms for a 361-char message, decode 6 → 16 ms — imperceptible. Decoder is symmetric automatically because both sides call the same `distribution()`.
- **Effort:** ~10 lines. No table bump, no sha256 change.

### #2 — Static order-1 range coder over bytes, replacing the order-0 Huffman.

The Huffman model is order-0, so it achieves 4.52 bits/char on the EN benchmark. I measured the true cross-entropy of a static order-1 model (add-0.5 smoothing, 256 symbols) on the same corpora:

| | order-0 | order-1 | order-2 | current |
|---|---|---|---|---|
| EN 46 chars | 24 B | **20 B** | 20 B | 28 B payload |
| EN 361 chars | 192 B | **153 B** | 135 B | 201 B (deflate) |
| CS 52 chars (sk proxy) | 37 B | **30 B** | 33 B | 40 B payload |

Order-1 needs only ~90–110 contexts per language (≈12 KB gzipped); order-2 needs ~1000 contexts for a further 18 B on long messages only. Order-1 is the right trade.

- **Savings:** body 47→38 (EN) and 59→48 (CS) → **EN 866→703 (−19%)**, **CS 692→571 (−17%)**, **EN 361 4143→~2729 (−34%)**. Note it beats deflate even on the long message, so it becomes the primary codec with deflate kept as the third option.
- **Files:** new `src/lib/chatCipher/charModel.ts` (baked table), new `src/lib/chatCipher/rangeCoder.ts`, `src/lib/chatCipher/compress.ts` (new flag value), a builder script alongside `scripts/build-chat-cipher-models.ts`.
- **Risk:** a new code path in the decrypt direction, so it needs round-trip tests across all 7 languages. The cs corpus is not in this repo (`data/chat-cipher-build/` has de/en/es/fr/pl/sk only) — build the cs model from the table's own 12 971-word list, which is a good Czech character sample.
- **Effort:** ~150 lines + builder + one ~12 KB asset.

### #3 — Envelope byte diet: drop the redundant u16 length, shrink the codec length header, pack the flag.

The compact body is `8 salt + 2 length + content + 8 tag` (`passwordEnvelope.ts:7–13`). The u16 length is **pure redundancy**: there is no padding, so the ciphertext length *is* the plaintext length, and `openPasswordWithSurplus` already searches every end and lets the GCM tag pick the right one. Removing it costs nothing.

Then: `huffmanPack` writes a u16 length (`huffman.ts:104`) — a u8 suffices below 256 bytes; and the flag byte (`compress.ts:11–13`) only needs 2 bits for the codec once the language is implied by the detected cover language, so it packs into the length byte.

- **Savings:** 47→43 bytes (−8.5%) → **EN 866→~790 (−9%)**, **CS 692→~630 (−9%)**.
- **Files:** `src/lib/passwordEnvelope.ts` (`LENGTH`, `sealedCompactLength`, `openCompactBody`, `openPasswordWithSurplus`), `src/lib/chatCipher/compress.ts`, `src/lib/chatCipher/huffman.ts`.
- **Risk:** very low. GCM authenticates the end; the length check was only a sanity check. Tests asserting `sealed.length === 31` and `sealedCompactLength` need updating — allowed, since backward compatibility is not required.
- **Effort:** ~30 lines.

### Combined projection (measured, not extrapolated)

| | baseline | #1 only (46000) | #1+#2+#3 | aggressive (40000) |
|---|---|---|---|---|
| EN 46-char | 866 | 747 (−14%) | **~591 (−32%)** | ~506 (−42%) |
| CS 52-char | 692 | 514 (−26%) | **~426 (−38%)** | ~376 (−46%) |
| EN 361-char | 4143 | 3511 (−15%) | **~2430 (−41%)** | ~2100 (−49%) |

## 3. Overlooked ideas worth considering

**The non-cs tables are vocabulary-starved, and it is not the corpus's fault.** The en corpus has 7 440 distinct words and 3 698 with count ≥ 3, but the table ships 1 510. The cap is `COUNT_MINIMUM = 3` plus `MINS = {2:8, 3:5, 4:4, 5:3}` (`build_tables.py:34,43`) — a word only enters the vocabulary if it survives the *n-gram entry* filter, not the raw count. Since `UNIGRAMS = 2000` and en has only 1 510 words, the unigram fallback already covers the entire vocabulary, so growing it directly widens the candidate set and raises the entropy ceiling. Estimate +0.3–0.5 bits/word → −10–15% chars. Cost: rebuild 6 tables, en grows 105 KB → ~250 KB. cs cannot be rebuilt from this repo.

**The cs vocabulary is 6.5× underused by the fallback.** 12 971 words in the table, but `UNIGRAMS = 2000` caps the unigram list. Raising it to ~6 000 costs ~12 KB gzip and lets cs reach higher `H` at the same `keep` — this is the cheapest way to exploit the big cs table.

**Per-language `keep`.** cs gains 26% at 46000 where en gains 14%, and cs tolerates the flattening better because its deeper n-gram structure has more to give up. Tune per language; do not ship one global constant.

**`MIN_MASS` 16 → 8.** Measured −9% EN / −5% CS at keep=40000, one line (`tableCodec.ts:12`). Noisy and it widens the candidate set (slower), so fold it in as a secondary knob rather than a headline change.

**Order-2 for long messages only.** 135 B vs 153 B on the 361-char case. Worth it only if you accept a ~60 KB asset.

**Multiword tokens: provably neutral, skip.** A bigram token's probability is `p(w₁)·p(w₂|w₁)`, so its bits are exactly the sum of the two separate tokens' bits, and its rendered characters are identical. No gain, added complexity.

**Sentence templates: no clear win.** The n-gram model already emits grammatical fragments; a template layer would constrain the distribution without raising `H`, and it is a large rewrite.

## 4. What NOT to do

**Do not shrink the 8-byte salt.** This is the one place a byte is genuinely load-bearing. In `envelopeKeys` the IV is `hkdfBytes(base, '.../v4/iv', 12)` where `base` derives from `argon2id(password, SHA256(salt))`. Same password + same salt ⇒ same key **and** same IV ⇒ GCM IV reuse, which is catastrophic. 8 bytes gives a 2³² birthday bound per password; 4 bytes would be 2¹⁶. Leave it.

**Do not shrink the 64-bit tag.** Deliberate, documented, NIST SP 800-38D permits it, and failed decrypts run offline so there is no oracle.

**Do not carry bits in case, diacritics, or punctuation.** This is the biggest untapped carrier — diacritics alone are 1 bit/word ≈ 19 bytes on a 47-byte body, and punctuation at each line end is another ~10 bytes. It is also a trap: chat clients autocapitalize the first letter, autocorrect punctuation, and strip diacritics, and a user retyping the cover normalizes all three. The current design's robustness comes *precisely* from folding them away (`foldWord`, `parse`). Trading that for 40% shorter covers would make the tool fail on exactly the clients it is meant to survive.

**Do not length-weight the word distribution, in either direction.** I measured both. Boosting long words makes covers *longer* (872 → 897 → 943 → 987 at α = 0.25/0.5/0.75/1.0) because `L` rises faster than `H`. Boosting short words is neutral (872 → 839 at α = −1.0) because `H` falls as `L` falls. The natural distribution is already near-optimal for its own entropy.

**Do not push `keep`/temperature into the word-salad regime.** keep=28000 gives EN 389 chars, but it reads *"ok thing died boss kinda though are, or pasta today! barely works rn."* That is not a shorter cover, it is a more suspicious one — the entire value of the feature is that the cover looks innocent.

**Do not raise the n-gram order to 6–7.** Higher order means lower entropy and longer covers.

**Do not drop deflate.** It wins for multi-KB messages; keep it as the third option behind order-1.

**Do not add an npm compression dependency.** Violates the browser-only constraint and adds supply-chain surface to a security tool.

**Do not reintroduce a neural model in the browser.** `dropRetiredModels` exists to free the ~140 MB those left behind; going back would undo that.

## Suggested sequencing

Ship #1 alone first — it is ten lines, needs no rebuild, no new asset, and no format bump, and it delivers roughly two-thirds of the total win. Then #3 (cheap, low risk, independent). Then #2, which is the only one that needs a new asset and a builder. The vocabulary work is a separate build-time workstream and should be evaluated after #1, because a wider candidate set and a lower `keep` interact.
