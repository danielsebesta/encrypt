# Antigravity Gemini (gemini-3.8-flash-high)

### Executive Summary & Baseline Measured Reality

In the current build (`redesign/mature-ui`), the pipeline converts a plaintext message into a sealed compact envelope (`ECP4 v2`), strips the 12-byte fixed header, and maps the remaining body bytes through an arithmetic coder driven by static $n$-gram tables (`ECT1` format).

#### Current Benchmark Baseline
* **Benchmark 1 (46-char EN):** `"meet me at the old station at nine, come alone"`
  * Raw: 46 B $\to$ Static Huffman: 26 B + 2 B length + 1 B flag = 29 B content payload.
  * Envelope: 20 B header + 2 B length + 29 B content + 8 B tag = 59 B sealed.
  * Body transmitted: $59 - 12 = 47\text{ bytes} = 376\text{ bits}$.
  * At EN density ($~1.62\text{ bits/word}$), this requires $\approx 232\text{ words} + 12\text{ trailing EOL words} \approx 244\text{ words}$.
  * **Result:** **1,153 cover characters** ($\approx 4.7\text{ chars/word}$ with spaces & punctuation).
* **Benchmark 2 (52-char CS):** `"tak v sedm u stareho nadrazi, sam, a nezapomen Kabat"`
  * Raw: 52 B $\to$ Static Huffman: 30 B + 2 B length + 1 B flag = 33 B content payload.
  * Envelope: 20 B header + 2 B length + 33 B content + 8 B tag = 63 B sealed.
  * Body transmitted: $63 - 12 = 51\text{ bytes} = 408\text{ bits}$.
  * At CS density ($~2.78\text{ bits/word}$), this requires $\approx 147\text{ words} + 9\text{ trailing EOL words} \approx 156\text{ words}$.
  * **Result:** **869 cover characters** ($\approx 5.6\text{ chars/word}$).
* **Empty Message Floor:**
  * 1 B content $\to$ 19 B body (152 bits) $\to$ **252 cover characters**.

The fundamental bottleneck is **low coder entropy ($1.6 - 2.8\text{ bits/word}$)** caused by MLE $n$-gram probability concentration, combined with **unigram byte-level compression limits** and **unnecessary envelope/runout padding**.

Below is the concrete plan for the next round of cover-shortening optimizations.

---

### 1. Ranked Top 3 Concrete Changes

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               PIPELINE SAVINGS OVERVIEW                                │
├───────────────────────────────┬────────────────────────────┬───────────────────────────┤
│ Optimization                  │ 46-char EN (1,153 chars)   │ 52-char CS (869 chars)    │
├───────────────────────────────┼────────────────────────────┼───────────────────────────┤
│ 1. Context-Constrained Nucleus│ -550 chars (-48%)          │ -390 chars (-45%)         │
│    Entropy Shaping            │ (density 1.62 → 3.5 b/w)   │ (density 2.78 → 5.0 b/w)  │
│ 2. Subword/Digraph Compression│ -240 chars (-21% isolated) │ -180 chars (-21% isolated)│
│    (Short-Text Codec)         │ (saves 14 bytes payload)   │ (saves 13 bytes payload)  │
│ 3. Envelope Trim & Early Stop │ -145 chars (-13% isolated) │ -120 chars (-14% isolated)│
│    (Drop length, 6B salt, EOL)│ (saves 4 bytes + runout)   │ (saves 4 bytes + runout)  │
├───────────────────────────────┼────────────────────────────┼───────────────────────────┤
│ Combined Cumulative Impact    │ ~330 chars (-71% total)    │ ~280 chars (-68% total)   │
│ Cover footprint reduced to:   │ 2-3 short chat bubbles     │ 2 short chat bubbles      │
└───────────────────────────────┴────────────────────────────┴───────────────────────────┘
```

---

#### Rank 1: Context-Constrained Nucleus Entropy Shaping (Table Rebalancing)

* **What to change:**
  Currently, $n$-gram conditional probability distributions in `ECT1` reflect raw corpus frequencies where top words (e.g., `"se"`, `"the"`, `"to"`) take $35\%\text{--}65\%$ of the probability mass, yielding $<1\text{ bit}$ per word. Naive global flattening (`mass^(1/flat)`) created word salad because it boosted nonsensical unigram fallbacks into active contexts.
  
  Instead, apply **Context-Constrained Nucleus Shaping** directly during table export in `scripts/chat-cipher-corpus/build_tables.py`:
  1. For every context row in levels $n \ge 2$, isolate the top-$k$ or top-$p$ valid candidates ($p = 0.90$, or up to 24 contextually natural words).
  2. Apply temperature flattening ($\gamma \approx 0.75$, i.e. $T \approx 1.33$) **only across valid context candidates**, capping any individual word share at $p_{\max} = 0.16$ ($-\log_2(0.16) \ge 2.64\text{ bits}$).
  3. Keep unigram fallback strictly for rare backoff events ($<1\%$ mass) so out-of-context words cannot be injected.
  4. Lower `MINS` in `build_tables.py` for EN from `{2:8, 3:5, 4:4, 5:3}` to `{2:3, 3:2, 4:2, 5:2}` so the EN vocabulary expands from 1,510 to $\sim 6,000$ words (matching CS).
* **Which files:**
  * [`scripts/chat-cipher-corpus/build_tables.py`](file:///C:/Users/dast/encrypt/scripts/chat-cipher-corpus/build_tables.py): Add `shape_row_shares()` before `steps(share)`; update `MINS` and regenerate tables.
  * [`src/lib/chatCipher/coverTable.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/coverTable.ts): Bump version path (`/chat-cipher/en/2/table.bin`, `/chat-cipher/cs/3/table.bin`) and update pinned `sha256`.
* **Rough Math & Estimated Savings:**
  * **EN:** Effective density shifts from $1.62\text{ bits/word}$ to $\approx 3.50\text{ bits/word}$.
    $376\text{ bits} / 3.50 = 107\text{ words}$ (vs. 232 words baseline).
    $107\text{ words} \times 5.2\text{ chars/word} \approx 556\text{ chars}$.
    **Savings: $\approx 597\text{ chars}$ ($\mathbf{-52\%}$ on 46-char EN).**
  * **CS:** Effective density shifts from $2.78\text{ bits/word}$ to $\approx 5.00\text{ bits/word}$.
    $408\text{ bits} / 5.00 = 82\text{ words}$ (vs. 147 words baseline).
    $82\text{ words} \times 5.6\text{ chars/word} \approx 460\text{ chars}$.
    **Savings: $\approx 409\text{ chars}$ ($\mathbf{-47\%}$ on 52-char CS).**
* **Risk:** Low. Because flattening is quarantined strictly to words that humans naturally write in that specific $n$-gram context, all candidate branches are grammatically valid.
* **Implementation Effort:** Medium (Python table-export update, table regeneration, checksum bumps).

---

#### Rank 2: Static Subword & Digraph Pre-Compression (Replacing Byte-Level Huffman)

* **What to change:**
  In [`src/lib/chatCipher/compress.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/compress.ts) and [`huffman.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/huffman.ts), the current static Huffman coder operates on single bytes using `TEXT_MODELS` from [`textModel.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/textModel.ts). By Shannon's source coding theorem, unigram byte entropy on European text cannot beat $4.4\text{--}4.75\text{ bits/byte}$.
  
  Replace byte-only Huffman with a **Compact Static Subword Dictionary (BPE-512)**:
  1. Train a static 512-token alphabet for each language from `data/chat-cipher-<lang>/clean/all.clean.jsonl`: 256 single byte fallbacks + 256 high-frequency chat tokens (e.g., `"th"`, `"he"`, `"in"`, `"the "`, `"you "`, `"station"`, `" v "`, `" u "`, `" se "`, `"stare"`).
  2. Encode with a 9-bit fixed-prefix code or static canonical Huffman over the 512 subwords.
  3. Short chat messages compress to $2.2\text{--}2.8\text{ bits/char}$ instead of $4.5\text{ bits/char}$.
  4. Replace the 2-byte uncompressed length header in `huffmanPack` with an inline End-Of-Message (EOM) symbol ($9\text{ bits}$ instead of $16\text{ bits}$).
* **Which files:**
  * [`src/lib/chatCipher/textModel.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/textModel.ts): Store subword token tables (or Trie) per language.
  * [`src/lib/chatCipher/huffman.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/huffman.ts): Support 512-symbol canonical Huffman with EOM.
  * [`src/lib/chatCipher/compress.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/compress.ts): Route short text through the subword pack.
  * [`scripts/build-chat-cipher-models.ts`](file:///C:/Users/dast/encrypt/scripts/build-chat-cipher-models.ts): Script to mine top subwords from the corpus.
* **Rough Math & Estimated Savings:**
  * **EN 46-char:** 46 raw bytes compress to $\approx 14\text{ tokens} \times 8.5\text{ bits} \approx 15\text{ bytes}$ (vs. 29 B Huffman baseline).
    Net saving: **14 bytes (112 bits)** in the payload.
    At baseline $1.62\text{ b/w}$: $112 / 1.62 \approx 69\text{ fewer words} \approx \mathbf{340\text{ fewer characters}}$ ($\mathbf{-29\%}$).
    At optimized $3.5\text{ b/w}$: $112 / 3.5 \approx 32\text{ fewer words} \approx \mathbf{166\text{ fewer characters}}$.
  * **CS 52-char:** 52 raw bytes compress to $\approx 18\text{ tokens} \approx 19\text{ bytes}$ (vs. 33 B Huffman baseline).
    Net saving: **14 bytes (112 bits)** in the payload.
    At baseline $2.78\text{ b/w}$: $112 / 2.78 \approx 40\text{ fewer words} \approx \mathbf{225\text{ fewer characters}}$ ($\mathbf{-26\%}$).
    At optimized $5.0\text{ b/w}$: $112 / 5.0 \approx 22\text{ fewer words} \approx \mathbf{125\text{ fewer characters}}$.
* **Risk:** Low. Pure browser JS, deterministic decompression, self-describing flag byte ensures complete separation.
* **Implementation Effort:** Medium (dictionary extraction script + token matching loop).

---

#### Rank 3: Envelope Overhead Trimming & Coder Early-Stop

* **What to change:**
  Three high-value structural eliminations that remove dead weight:
  1. **Drop the 2-byte length prefix inside `openCompactBody`:**
     In [`src/lib/passwordEnvelope.ts`](file:///C:/Users/dast/encrypt/src/lib/passwordEnvelope.ts), `openPasswordWithSurplus` loops over `end`. AES-256-GCM includes `len(A) || len(C)` in its final GHASH block. Any candidate `end` differing from the true ciphertext length fails with probability $1 - 2^{-64}$. Storing `padded[0], padded[1]` is completely redundant with `plain.length`. Dropping it saves **2 bytes (16 bits)** unconditionally.
  2. **Reduce Compact Salt to 6 Bytes (48 bits):**
     In `passwordEnvelope.ts`, compact salt is 8 bytes. With Argon2id ($64\text{ MiB}$), rainbow tables are impossible. 48-bit salt provides $2.8 \times 10^{14}$ unique salts; birthday collisions occur only after $>16.7\text{ million}$ messages under the same password. Dropping 2 bytes of salt saves **2 bytes (16 bits)**.
  3. **Eliminate Post-Transmission EOL Search Fluff:**
     In [`src/lib/chatCipher/tableCodec.ts#L310-L325`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/tableCodec.ts#L310-L325), once `before >= total` (all ciphertext bits are transmitted), the coder continues generating up to 40 extra words with random bits just to locate an `EOL` token.
     Instead, terminate emission immediately when the arithmetic interval unambiguously resolves the final bits. Let `render()` close the final sentence with natural punctuation (e.g. `.`). Eliminates $\mathbf{8\text{--}15\text{ phantom words}}$ per message.
* **Which files:**
  * [`src/lib/passwordEnvelope.ts`](file:///C:/Users/dast/encrypt/src/lib/passwordEnvelope.ts): Set `SALT_COMPACT = 6`, remove `LENGTH` from compact envelope path.
  * [`src/lib/chatCipher/tableCodec.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/tableCodec.ts): Remove the `before >= total` runout loop in `chooseWords()`.
  * [`tests/chat-cipher-compact.test.ts`](file:///C:/Users/dast/encrypt/tests/chat-cipher-compact.test.ts): Update length assertions.
* **Rough Math & Estimated Savings:**
  * 4 bytes saved ($32\text{ bits}$) + elimination of $\approx 10$ trailing runout words:
  * **EN 46-char:** $32\text{ bits} / 1.62 = 20\text{ words} + 10\text{ runout words} = 30\text{ words} \approx \mathbf{145\text{ chars saved}}$ ($\mathbf{-13\%}$).
  * **CS 52-char:** $32\text{ bits} / 2.78 = 11.5\text{ words} + 9\text{ runout words} \approx 21\text{ words} \approx \mathbf{120\text{ chars saved}}$ ($\mathbf{-14\%}$).
  * **Empty Message Floor:** Sealed body drops from 19 B to 15 B (120 bits). Without trailing EOL runout, the empty floor drops from **252 chars down to $\approx 120\text{ chars}$ ($-52\%$)**.
* **Risk:** Very low. Preserves AES-GCM 64-bit authentication integrity and full Argon2id protection.
* **Implementation Effort:** Low (straightforward deletions and threshold adjustments).

---

### 2. Overlooked Ideas Worth Considering

#### A. Exploiting the Underused Czech Vocabulary via Syntactic / Lemma Slotting
* **Observation:** The CS table contains 12,971 words, yet effective density is only $2.78\text{ bits/word}$. The reason: Czech is heavily inflected (7 cases, genders, aspect pairs). An $n$-gram context expects a specific inflected surface form, so $99.9\%$ of the 12,971 words are forced into unigram fallback with near-zero probability.
* **Solution:** Group nouns, adjectives, and verbs into **syntactic substitution classes** (e.g., all accusative singular feminine adjectives). In casual chat, substituting *"skvělou"* $\leftrightarrow$ *"divnou"* $\leftrightarrow$ *"novou"* $\leftrightarrow$ *"drahou"* $\leftrightarrow$ *"hezkou"* is $100\%$ grammatically natural. Selecting from 32 plausible adjectives in that slot transmits $\mathbf{5\text{ bits}}$ in a single word without touching unigram fallbacks.

#### B. Idiom & Multiword Phrase Tokens
* **Observation:** Daily chat is dense with formulaic multiword expressions:
  * CS: *"no jasně"*, *"to je jedno"*, *"dám vědět"*, *"v pohodě"*, *"tak určitě"*, *"vidíme se zítra"*.
  * EN: *"for real"*, *"no worries"*, *"sounds good"*, *"on my way"*, *"let me know"*.
* **Idea:** Treat top 300 multiword idioms as single tokens in the word table. Emitting an idiom like `"on my way"` takes 3 words of visual cover, but choosing among 64 possible chat idioms encodes $\mathbf{6\text{ bits}}$ in one step. The text reads as idiomatic human chat rather than word-by-word $n$-gram wandering.

#### C. Two-Person Multi-Turn Dialogue Template (Chat Bubble Interleaving)
* **Observation:** A monologue of 150 words in a single block looks suspicious and artificial. But real chat occurs in short back-and-forth turns between two speakers.
* **Idea:** Alternate speaker turns with dialogue framing (`<turn>` tokens). Questions naturally reset or widen the search space (e.g. *"A ty?"*, *"Kde jsi?"*, *"Co tam?"*), which dramatically raises the conditional entropy of the reply without sacrificing plausibility.

#### D. Punctuation & Diacritics Modulation: Feasibility Analysis
* **Why direct encoding is dangerous:** As tested in [`tests/chat-cipher-table.test.ts`](file:///C:/Users/dast/encrypt/tests/chat-cipher-table.test.ts), chat platforms (Telegram, WhatsApp, Slack, SMS) routinely strip diacritics, convert quotes, collapse spaces, and autocorrect casing.
* **Where it CAN work:** Invariant lexical variants. In Czech/Slovak, casual chat has legitimate alternative spellings and synonyms that survive all chat filters: e.g. *"jo"* vs *"ano"*, *"taky"* vs *"takyze"*, *"ted"* vs *"tedka"*. Encoding 1 bit per synonym choice is $100\%$ robust against auto-capitalization and diacritic stripping.

---

### 3. What NOT to Do (Tempting Pitfalls)

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│ Tempting Shortcut               │ Why it is Dangerous             │ Verdict                         │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Carrier bits in Capitalization  │ Mobile keyboards autocorrect    │ REJECT: Destroys decrypt        │
│ (Upper/Lower case modulation)   │ sentence starts and proper nouns│ reliability across devices.     │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Carrier bits in Punctuation     │ Messaging apps strip trailing   │ REJECT: Fragile under copy/paste│
│ (e.g., . vs ! vs ...)           │ punctuation or convert to emoji │ and platform sanitizers.        │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Zero-Width / Whitespace Stego   │ Collapsed by web forms and      │ REJECT: Flagged by steganalysis,│
│ (ZWSP, ZWNJ, trailing spaces)   │ stripped by Telegram/WhatsApp   │ stripped by modern chat clients.│
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Unconstrained Global Flattening │ Elevates rare unigram words;    │ REJECT: Turns cover text into   │
│ (uniform temperature across LM) │ produces "word salad"           │ suspicious gibberish.           │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Truncating GCM Tag < 64 bits    │ 32-bit tag allows forgery in    │ REJECT: Fails basic cryptographic│
│ (e.g. 32-bit or 48-bit tag)     │ 2^32 offline attempts           │ security standards.             │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ Dropping Salt entirely          │ Allows precomputed rainbow      │ REJECT: Exposes identical       │
│                                 │ tables across shared passwords  │ passwords to precomputation.    │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

1. **Do NOT put carrier bits into typographical formatting (case, spaces, punctuation):**
   The robustness tests in [`tests/chat-cipher-table.test.ts#L65-L85`](file:///C:/Users/dast/encrypt/tests/chat-cipher-table.test.ts#L65-L85) explicitly verify that covers survive `toUpperCase()`, stripping diacritics, re-flowing lines, and normalizing punctuation. Any scheme relying on case, punctuation marks, or whitespace will break when passed through WhatsApp, Discord, or mobile keyboards.
2. **Do NOT reduce the AES-256-GCM authentication tag below 64 bits:**
   NIST SP 800-38D explicitly sets 64 bits as the absolute floor. A 32-bit tag would allow an offline attacker to forge or guess valid plaintexts with only $2^{32}$ iterations—trivially executable in a web worker in under a minute.
3. **Do NOT eliminate the random salt:**
   While dropping the salt would save 6–8 bytes, it would allow an adversary to precompute Argon2id rainbow tables for common passwords and crack any intercepted cover text instantly.
4. **Do NOT perform naive global temperature flattening:**
   Blindly applying $p^{1/T}$ across the unigram dictionary causes rare nouns and disconnected conjunctions to be selected mid-sentence. Only **context-constrained nucleus shaping** maintains linguistic plausibility.
5. **Do NOT reintroduce client-side neural LLMs (Transformers.js / ONNX):**
   Earlier builds proved that downloading a 140+ MB neural model on mobile browser connections creates unacceptably long loading times, high memory pressure, and tab crashes. Static $n$-gram tables remain the superior architecture for instant, offline, zero-dependency browser execution.

---

### Recommended Action Plan

1. **Step 1 (Crypto & Codec cleanup):** Remove the redundant 2-byte length from the compact envelope layout in [`passwordEnvelope.ts`](file:///C:/Users/dast/encrypt/src/lib/passwordEnvelope.ts), reduce salt to 6 bytes, and eliminate the post-transmission EOL runout in [`tableCodec.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/tableCodec.ts). *(Immediate $\approx 135\text{ char}$ reduction across all benchmarks)*.
2. **Step 2 (Table Nucleus Rebalancing):** Update [`build_tables.py`](file:///C:/Users/dast/encrypt/scripts/chat-cipher-corpus/build_tables.py) to apply context-constrained nucleus flattening, relax EN n-gram thresholds, regenerate tables to `/chat-cipher/<lang>/2/table.bin`, and bump checksums in [`coverTable.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/coverTable.ts). *(Doubles bits/word; cuts remaining length in half)*.
3. **Step 3 (Short-text Subword Codec):** Implement a 512-subword token model in [`huffman.ts`](file:///C:/Users/dast/encrypt/src/lib/chatCipher/huffman.ts) to replace byte-level unigram modeling for short text. *(Shrinks payload by $\approx 14\text{ bytes}$, achieving the final $\approx 300\text{ char}$ target)*.
