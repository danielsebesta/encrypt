# Cursor Grok (grok-4.7)

The next cut is the word model, not the cipher. On this tree a 46-character English message already seals to a **47-byte** body and about **850 characters** of cover; the Czech 13k-word table is real and still only spends about **2.9 bits per word**.

## What this tree actually does

The cover coder is an arithmetic coder over a 5-gram (`tableCodec.ts`). `keep` is **65536** in every table, which is `LAMBDA = 0` in `scripts/chat-cipher-corpus/build_tables.py`: a matching context keeps its whole discounted mass. Rows are tiny.

| | words | conditional bits/word | unigram bits | order-4 row |
|---|---:|---:|---:|---|
| en | 1,510 | **1.60** (quoted 1.62) | 7.02, reached on 2% of steps | 1.37 continuations, 88% are a single word |
| cs | 12,971 | **2.87** (quoted 2.78) | 7.80 over a **2,000-word cap** | 1.55 continuations, 78% are a single word |

`MIN_MASS = 16` then deletes whatever is left of the tail. The other six tables match English (1,239–2,274 words, same `keep`), not Czech.

Live sizes, from `packContent` plus `encode` of those bodies:

- `"meet me at the old station at nine, come alone"` → Huffman flag, **content 29 bytes, body 47 bytes**. Covers of a 48-byte body came out **813, 911, and 913** characters. About **18.3 characters per body byte**.
- A 52-character Czech line with diacritics is 59 UTF-8 bytes → **content 43, body 61**, covers **735 and 827**.
- Empty message → body **19**, Czech covers **234–270** (the quoted 252 sits in that range).
- Huffman on the English line is **4.52 bits/byte**. That is the corpus byte entropy. The short message is already at the byte-model floor.
- The quoted **1153** does not reproduce. The quoted **4131** for a ~360-character English text does: a 382-character paragraph sealed to a 241-byte body, and 241 × 18.3 ≈ 4,400. **1153 matches a pre-Huffman body** (raw 46 bytes + framing ≈ 65 bytes × ~18 characters).

Power-tempering the blended mass by `mass^(1/T)` also does not reproduce the quoted jump. **T = 1.1 and T = 1.25 save about 14%**, not 50–61%. The quoted rates show up only at much harder settings: English **T = 2 → 3.29 bits/word, −50% characters**; Czech **T = 2 with the mass floor removed → 7.69 bits/word, −53% characters**. At T = 2 with `MIN_MASS` left at 16, the floor deletes the tail and the candidate set shrinks.

There is a character wall near **5 characters per body byte**. Past that, extra bits land on longer words and the character count stops falling (English T = 4 reached 7.3 bits/word and only 5.4 characters/byte). Salt plus the 64-bit tag is 16 bytes, so even at that wall every cover is at least ~80 characters before the message.

## 1. Mix in the backoff: set `LAMBDA` to about 0.5

Scale the context shares by `(1 − λ)` so leftover mass falls through to the shorter n-grams and the unigram. The format already has this knob (`keep_int = round((1 − LAMBDA) × 65536)`); it is just set to 0. The same multiply can live in `distribution()` in `src/lib/chatCipher/tableCodec.ts` while tuning, then be baked by regenerating `public/chat-cipher/*/table.bin` and the pins in `coverTable.ts`.

Measured by walking the real tables:

| | bits/word | characters/byte | character ratio |
|---|---:|---:|---:|
| en now | 1.60 | 18.2 | 1 |
| en λ = 0.5 | 3.04 | 9.9 | **0.54** |
| en λ = 0.25 | 5.39 | 5.7 | **0.31** |
| cs now | 2.87 | 11.3 | 1 |
| cs λ = 0.5 | 4.65 | 6.9 | **0.61** |
| cs λ = 0.25 | 6.22 | 4.9 | **0.43** |

Applied to the live covers:

- English 46-character message, ~860 characters → **~465** at λ = 0.5, **~270** at λ = 0.25.
- Czech ~800–870 characters → **~480–530** at λ = 0.5, **~340–380** at λ = 0.25.
- Empty floor ~250 → **~150** at λ = 0.5, **~110** at λ = 0.25.

If the 1153 figure is still what a given sample prints, the same ratios land at **~625** and **~360**.

λ = 0.5 is the operating point. The modal word stays modal (English max probability 0.71 → 0.56) and the sampled words stay short. λ = 0.25 hits the unigram on every step (`uniRate = 1`, longest context hits 17% of the time in English and 6% in Czech) and is the plausibility cliff: a bag of common words. Do not stack this with temperature; both moves pour the same leftover mass onto the unigram.

Risk: medium at 0.5, high at 0.25. A current English sample reads as choppy chat (`hey / rebooting / still / ok / been ages / coffee run`). After a hard mix it turns into phrase salad. Czech today still forms sentences; λ = 0.5 punches holes in them. Retune per language: English, German, and Slovak are the peaked tables; Czech needs less.

Effort: small. One scale factor, new samples, update the golden cover in `tests/chat-cipher-table.test.ts`. No new dependency and no change to AES-GCM or Argon2id.

## 2. Cap the modal probability, and drop `MIN_MASS` if you temper

Capping the most likely word (then renormalizing over the words already in the distribution) is the plausibility-shaped version of the same idea: rank order stays, the mode just stops eating 70% of the mass.

On English a cap of **0.5** went from 1.71 to **3.48 bits/word** and from 16.5 to **9.1 characters/byte (−45%)**, in line with λ = 0.5: ~860 → **~470** characters. On Czech the mode is already 0.46, so a 0.5 cap only saved **~15%** (~800 → **~680**). Czech needs the cap nearer **0.25** (−22%, ~**650**) or the λ mix from change 1.

Use this instead of λ where a row actually has several attested continuations (Czech order-1 rows average 19). On English order-4, 88% of rows have one word, so the leftover spills to the unigram anyway.

The earlier temperature result is this same knob turned much harder, and only if `MIN_MASS` drops from 16 to 1 in the same edit. Otherwise `mass^(1/T)` pushes the tail under the floor and the candidate list shrinks. T = 1.1 / 1.25 is not worth a table rebuild.

Files: the same `distribution()` in `tableCodec.ts`. Effort: small. Risk: same as λ, and worse if T ≥ 2 (Czech T = 2 with the floor removed is −53%, ~800 → **~370**, with support jumping from ~90 words to ~700 and the text leaving the n-gram).

## 3. Delete the length fields the surplus opener already ignores

Of the 47-byte English body, **21 bytes are framing**: salt 8, inner u16 length 2, flag 1, Huffman u16 length 2, tag 8. The message bits are ~26 bytes. At 18.3 characters/byte the framing is ~380 of the ~860 characters.

`openPasswordWithSurplus` already tries every end, and the 64-bit tag checks each try. The inner u16 repeats that. The Huffman u16 exists only to stop the bit parser; these plaintexts fit in one byte (the packer already rejects 2¹⁶). Drop both.

- **−3 bytes.** English **~55 characters** now, **~30** after λ = 0.5. Czech **~40** now, **~25** after.
- Stacks with changes 1–2 and does not change a single word.
- Files: `passwordEnvelope.ts` (bump the ECP4 layout byte; compatibility is disposable) and `huffman.ts`. Effort: small. Risk: none to security or plausibility. Keep the flag inside the ciphertext.

Salt and tag should stay. After λ = 0.5 those 16 bytes are still ~160 English characters, which is the floor under the 46-character message.

## Worth considering, not the next patch

- **Line-start mix only.** English emits end-of-line on **36%** of symbols (the unigram itself is 27% end-of-line), Czech on 12%. Flattening only the word after end-of-line or turn keeps the middle of a line on the n-gram. A surprising first word misses the high-order context, so the rest of the line backs off too. Treat it as a way to spend λ, and remeasure; the cascade is the whole effect.
- **The Czech vocabulary is unused because it is unreachable, not because it is small.** 10,969 words never enter the 2,000-word unigram (`UNIGRAMS = 2000`). Raising that cap only pays once λ > 0. Lowering `MINS` without moving mass does not: a continuation at probability 0.01 adds a fraction of a bit. English does not need more words until it is past ~7 bits/word; `log2(1508) = 10.6` is not the binding limit.
- **Sibling inflections and synonym pairs** (`ok` / `okay`, a Czech case ending) add about a bit at the same length when both forms are actually grammatical. Wrong agreement is the most visible failure mode in Czech, Slovak, and Polish. High effort, smaller than λ.
- **Order-1 static model for long text only.** The 46-byte line is already at 4.52 bits/byte. The 361-character branch sealed at ~4.6 bits/byte with deflate and Huffman tied. An order-1 model might save ~6 bytes on the short line (~100 characters today, ~60 after λ) and more on the long one. It does not get the short cover under a few bubbles.
- **Multiword tokens** help only when a short phrase is given a middling probability. A common phrase is long and predictable, which makes the cover longer.
- **Ending mid-line** (`MAX_EXTRA_WORDS`) saves about one line. Small next to λ.

## Leave these alone

- **The 64-bit tag and the 8-byte salt.** The tag is ~150 English characters and it is the accepted floor. Cutting the salt to 4 bytes saves ~70 characters today and ~40 after λ = 0.5, and it is the parameter whose only job is stopping precomputation. Argon2id already receives 16 bytes because the 8-byte salt is SHA-256-expanded (`kdf.ts` rejects a shorter Argon2 salt).
- **Bits in case, accents, typos, or the choice of comma versus period.** `foldWord` strips the first three, and any mark is one end-of-line. The table tests require the cover to survive exactly those edits. A capital or a question mark chosen by the payload is also the easiest visual tell.
- **`MIN_MASS = 1` by itself.** Measured English entropy went from 1.60 to **1.48**. The tail has no mass to give.
- **A uniform draw over the word list.** That is the 5-character/byte wall, and the text is a word list. T = 4 already landed there.
- **A second sequence, a repeated cover, or synonym padding.** Those add words.
- **Another compression pass on the 46-byte message.** There is less than a byte left under the byte unigram.
