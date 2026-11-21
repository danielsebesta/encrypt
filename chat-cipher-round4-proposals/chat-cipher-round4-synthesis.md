# Chat cipher round 4 — synthesis

Six read-only proposals (`antigravity-gemini`, `devin-swe2`, `cursor-grok`, `claude-sonnet`, `mistral-large-4`, `mistral-deepseek`). Same brief, measured on the shipped tables. Nothing in those reports mutated the repo.

## Consensus ranking

1. **Density / blend decay** — lower `keep` (or bake temperature into tables). Biggest cover cut; plausibility is the risk.
2. **Framing diet** — drop redundant length fields the surplus opener already ignores. Low risk; do early.
3. **Better content coding** — LMTEXT via the cover table, or an order-1 byte model instead of order-0 Huffman.

**Do not:** cut the 64-bit GCM tag, shrink the 8-byte salt (Deepseek: same salt ⇒ same IV under the compact KDF), put payload bits in case / punctuation / diacritics.

## Already on `redesign/mature-ui` before this follow-up

| Lever | State | Where |
|---|---|---|
| Compact body has **no** plaintext length prefix | Done (ECP4 seals bare content) | `passwordEnvelope.ts` |
| Huffman length was already **u8**, not u16 | Done earlier | `huffman.ts` (pre-round) |
| Read-time `keep` override **46000** for every language | Done (`COVER_DENSITY`) | `coverTable.ts` |
| Salt stays 8 B, tag stays 64-bit | Deliberate | `passwordEnvelope.ts` |

Live check after density (46-char EN / CS-ish message): EN body **43 B**, covers ~**800** chars; CS body **44 B**, covers ~**360–380** chars. That matches the round-4 “keep = 46000” projections far more than the untuned 65536 baselines in the briefs.

## Implemented in this follow-up

| Change | Why |
|---|---|
| Drop the Huffman **length byte**; pad the last partial byte with **1-bits** | Framing diet remainder (~1 B ≈ 15–18 cover chars). Padding ≤ 7 bits; the only all-ones codeword in every language model is 15 bits, so the pad never decodes as a symbol. |
| Synthesis file | README pointed here; the session scratchpad was missing. |

Old Huffman payloads (length-prefixed) will not open. Chat-cipher covers are ephemeral one-shots; the proposals treated format bumps as acceptable.

## Still open (next rounds)

1. **Order-1 static byte model** (or LMTEXT) — largest remaining sealed-body cut once framing and density are in.
2. **Per-language `keep`** — EN/DE peaked tables may want a lower value than CS; tune with a plausibility bar, not a single global.
3. **Modal probability cap** as an alternative shape for density (Grok) — optional, do not stack hard with another flatten.
4. **Table rebuilds** (larger EN vocab, higher CS `UNIGRAMS`) — needs corpora; CS cannot rebuild from this repo.

## Suggested next sequence

1. Ship / soak this Huffman framing change.
2. Prototype order-1 models for `en` + `cs` with round-trip fuzz; keep Huffman and deflate as fallbacks in `packContent`.
3. Only then consider LMTEXT (shared arithmetic coder with the cover table) if short natural-language messages still dominate usage.
