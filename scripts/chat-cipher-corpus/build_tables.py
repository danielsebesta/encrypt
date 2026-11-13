"""Build ECT1 cover tables from data/chat-cipher-{lang}/clean/all.clean.jsonl.

Mirrors C:/Users/dast/chat-model/table/{corpus,count,export}.py, but reads the
encrypt multi-lang one-writer bursts (messages[]) and writes
public/chat-cipher/{lang}/{ver}/table.bin plus a SHA manifest.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import struct
import sys
import time
import unicodedata
from array import array
from collections import Counter
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
CHAT_MODEL = Path(r'C:\Users\dast\chat-model')
OUT_ROOT = ROOT / 'public' / 'chat-cipher'
WORK = ROOT / 'data' / 'chat-cipher-build'
SPECIALS = ['<pad>', '<eol>', '<unk>', '<turn>']
EOL, UNK, TURN = 1, 2, 3
VOCAB_CAP = 16_000
ORDER = 5
COUNT_MINIMUM = 3
PARTS = 32
MUL = np.uint64(0x9E3779B97F4A7C15)
MASK = np.uint64((1 << 15) - 1)
DISCOUNT = 0.75
STEPS = 12
UNIGRAMS = 2000
LAMBDA = 0.0
# Softer than the 60M-token CS pack; still enough for a usable cover table.
MINS = {2: 8, 3: 5, 4: 4, 5: 3}
WORD = re.compile(r'[^\W\d_]+', re.UNICODE)
# Characters that NFD does not strip to ASCII (foldWord must match).
LATIN_MAP = str.maketrans({
    'ł': 'l', 'ß': 'ss', 'œ': 'oe', 'æ': 'ae', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th',
    'ı': 'i', 'ĳ': 'ij', 'ŋ': 'n',
})
COMBINING = str.maketrans('', '', ''.join(chr(c) for c in range(0x300, 0x370)))
ASCII_WORD = re.compile(r'^[a-z]+$')

LANGS = {
    'en': 1,
    'de': 1,
    'es': 1,
    'fr': 1,
    'sk': 1,
    'pl': 1,
}

BAN = re.compile(
    r'nigg\w*|faggot\w*|retard\w*|hitler\w*|nazi\w*|pedof\w*|porn\w*|'
    r'neg(r|re|ri|ra|ry|ru|rum|rovi|rem|rech)|'
    r'cig[aá]n\w*|zidak\w*|teplous\w*|kokot\w*|kund\w*|pic(a|e|i|o|u|ou)\w*|'
    r'kurw\w*|pierdol\w*|jeba\w*|hure\w*|fotze\w*|putain\w*|connard\w*',
    re.IGNORECASE,
)


def fold(word: str) -> str:
    return unicodedata.normalize('NFD', word).translate(COMBINING).lower().translate(LATIN_MAP)


def tokens_of(text: str) -> list[str]:
    out = []
    for raw in WORD.findall(text):
        folded = fold(raw)
        folded = re.sub(r'[^a-z]', '', folded)
        if folded and ASCII_WORD.match(folded):
            out.append(folded)
    return out


def load_messages(lang: str) -> list[list[str]]:
    path = ROOT / f'data/chat-cipher-{lang}/clean/all.clean.jsonl'
    bursts = []
    for line in path.open(encoding='utf-8'):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        msgs = row.get('messages')
        if not isinstance(msgs, list) or len(msgs) < 2:
            continue
        clean = [m.strip() for m in msgs if isinstance(m, str) and m.strip()]
        if len(clean) >= 2:
            bursts.append(clean)
    return bursts


def build_vocab(bursts: list[list[str]]) -> dict:
    counts: Counter[str] = Counter()
    forms: dict[str, Counter[str]] = {}
    for msgs in bursts:
        for text in msgs:
            for raw in WORD.findall(text):
                lower = raw.lower()
                folded = re.sub(r'[^a-z]', '', fold(lower))
                if not folded:
                    continue
                counts[folded] += 1
                forms.setdefault(folded, Counter())[lower] += 1
    ranked = [w for w, _ in counts.most_common() if not BAN.fullmatch(w)]
    words = SPECIALS + ranked[: VOCAB_CAP - len(SPECIALS)]
    display = {w: forms[w].most_common(1)[0][0] for w in words[len(SPECIALS):] if w in forms}
    # Prefer ASCII display when the original had non-foldable leftovers that foldWord would drop oddly.
    for w, d in list(display.items()):
        if re.sub(r'[^a-z]', '', fold(d)) != w:
            display[w] = w
    return {'words': words, 'display': display, 'turn': TURN}


def encode_bursts(bursts: list[list[str]], vocab: dict) -> np.ndarray:
    index = {w: i for i, w in enumerate(vocab['words'])}
    for w in list(index):
        if BAN.fullmatch(w):
            index[w] = UNK
    ids = array('H')
    kept = skipped = 0
    for msgs in bursts:
        chunk = [TURN]
        ok = False
        for text in msgs:
            message = []
            for raw in WORD.findall(text):
                folded = re.sub(r'[^a-z]', '', fold(raw.lower()))
                if not folded:
                    continue
                message.append(index.get(folded, UNK))
            if not message or message.count(UNK) > max(1, len(message) // 4):
                continue
            chunk.extend(message)
            chunk.append(EOL)
            ok = True
        if ok and len(chunk) > 2:
            ids.extend(chunk)
            kept += 1
        else:
            skipped += 1
    data = np.frombuffer(ids, dtype=np.uint16).copy()
    print(f'  encoded {kept:,} bursts, skipped {skipped:,}, {len(data):,} tokens, unk={(data == UNK).mean():.2%}', flush=True)
    return data


def count_order(tokens: np.ndarray, order: int):
    reps, words, counts, totals = [], [], [], []
    newest = tokens[:-1] % PARTS
    for part in range(PARTS):
        idx = np.flatnonzero(newest == part)
        idx = idx[idx >= order - 2].astype(np.int64)
        following = tokens[idx + 1]
        ok = (following != TURN) & (following != UNK) & (following != 0)
        for back in range(order - 1):
            token = tokens[idx - back]
            ok &= token != UNK
            if back < order - 2:
                ok &= token != TURN
        idx, following = idx[ok], following[ok]
        if not len(idx):
            continue
        key = np.zeros(len(idx), dtype=np.uint64)
        for back in range(order - 1):
            key = (key * MUL) ^ (tokens[idx - back].astype(np.uint64) + np.uint64(back + 1))
        key = ((key * MUL) >> np.uint64(15) << np.uint64(15)) | following.astype(np.uint64)
        by = np.argsort(key)
        key = key[by]
        starts = np.concatenate(([0], np.flatnonzero(key[1:] != key[:-1]) + 1))
        amount = np.diff(np.concatenate((starts, [len(key)]))).astype(np.uint32)
        uniq = key[starts]
        rep = idx[by[starts]]
        context = uniq >> np.uint64(15)
        edges = np.concatenate(([0], np.flatnonzero(context[1:] != context[:-1]) + 1))
        total = np.add.reduceat(amount.astype(np.uint64), edges)
        total = np.repeat(total, np.diff(np.concatenate((edges, [len(uniq)]))))
        keep = amount >= COUNT_MINIMUM
        reps.append(rep[keep])
        words.append((uniq[keep] & MASK).astype(np.uint16))
        counts.append(amount[keep])
        totals.append(total[keep].astype(np.uint32))
    rep, word, amount, total = map(np.concatenate, (reps, words, counts, totals))
    ctx = np.stack([tokens[rep - back] for back in range(order - 1)], axis=1)
    return ctx, word, amount, total


def steps(share):
    return np.clip(np.round(-STEPS * np.log2(np.clip(share, 1e-12, 1))), 0, 255).astype(np.uint8)


def pair(values):
    values = values.astype(np.uint16)
    return (values & 0xFF).astype(np.uint8).tobytes() + (values >> 8).astype(np.uint8).tobytes()


def export_table(name: str, vocab: dict, counts_dir: Path, out_prefix: Path) -> dict:
    LUT = np.clip(np.round(65535 * 2.0 ** (-np.arange(256) / STEPS)), 1, 65535).astype(np.uint16)
    levels = []
    used = {EOL, TURN}
    for n in sorted(MINS):
        data = np.load(counts_dir / f'{name}-{n}.npz')
        keep = data['count'] >= MINS[n]
        if not keep.any():
            raise SystemExit(f'{name}: order {n} empty at min={MINS[n]}')
        ctx, word, count, total = data['ctx'][keep], data['word'][keep], data['count'][keep], data['total'][keep]
        share = (count - DISCOUNT) / total
        used.update(np.unique(word).tolist())
        used.update(np.unique(ctx).tolist())
        levels.append((n, ctx, word, share))
    used -= {0, UNK}
    order = sorted(used)
    remap = np.zeros(1 << 15, dtype=np.uint16)
    for new, old in enumerate(order):
        remap[old] = new
    assert remap[EOL] == 0 and remap[TURN] == 1
    words = ['', ''] + [vocab['display'].get(vocab['words'][w], vocab['words'][w]) for w in order[2:]]

    blob = bytearray()
    sizes = {}
    for n, ctx, word, share in levels:
        col = remap[ctx]
        wid = remap[word]
        keys = [wid] + [col[:, k] for k in range(n - 1)]
        by = np.lexsort(keys)
        col, wid, share = col[by], wid[by], share[by]
        change = np.any(col[1:] != col[:-1], axis=1)
        starts = np.concatenate(([0], np.flatnonzero(change) + 1))
        rows = np.diff(np.concatenate((starts, [len(wid)])))
        assert rows.max() < 65536
        head = col[starts]
        blob += struct.pack('<II', len(starts), len(wid))
        for k in range(n - 2, -1, -1):
            c = head[:, k].astype(np.int64)
            blob += pair((np.diff(c, prepend=0) & 0xFFFF) if k == n - 2 else c)
        blob += pair(rows)
        delta = np.diff(wid.astype(np.int64), prepend=0)
        delta[starts] = wid[starts]
        blob += pair(delta & 0xFFFF)
        blob += steps(share).tobytes()
        sizes[n] = (len(starts), len(wid))

    uni = np.load(counts_dir / f'{name}-unigram.npy').astype(np.float64)
    uni[[0, UNK, TURN]] = 0
    allowed = np.zeros(1 << 15, dtype=bool)
    allowed[order] = True
    uni[~allowed] = 0
    top = np.sort(np.argsort(uni)[::-1][:UNIGRAMS])
    top = top[uni[top] > 0]
    uni_ids = remap[top].astype(np.int64)
    blob += struct.pack('<I', len(top))
    blob += pair(uni_ids)
    blob += steps(uni[top] / uni[top].sum()).tobytes()

    word_bytes = '\n'.join(words).encode('utf-8')
    keep_int = round((1 - LAMBDA) * 65536)
    head = b'ECT1' + struct.pack('<III', keep_int, len(levels), len(word_bytes)) + word_bytes + pair(LUT)
    raw = head + bytes(blob)
    packed = gzip.compress(raw, 9, mtime=0)
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    bin_path = Path(str(out_prefix) + '.bin')
    bin_path.write_bytes(packed)
    Path(str(out_prefix) + '.ids.json').write_text(json.dumps(order), encoding='utf-8')
    sha = hashlib.sha256(packed).hexdigest()
    entries = sum(v[1] for v in sizes.values())
    meta = {
        'words': len(order),
        'entries': entries,
        'sizes': {str(k): list(v) for k, v in sizes.items()},
        'raw_mb': round(len(raw) / 1e6, 3),
        'gzip_mb': round(len(packed) / 1e6, 3),
        'sha256': sha,
        'mins': MINS,
    }
    print(f'  {bin_path}: {entries:,} entries {sizes}, {len(order):,} words, gzip {meta["gzip_mb"]} MB sha={sha[:12]}…', flush=True)
    return meta


def build_lang(lang: str, ver: int) -> dict:
    print(f'=== {lang}/{ver} ===', flush=True)
    bursts = load_messages(lang)
    print(f'  {len(bursts):,} clean bursts', flush=True)
    vocab = build_vocab(bursts)
    work = WORK / lang
    work.mkdir(parents=True, exist_ok=True)
    (work / 'vocab.json').write_text(json.dumps(vocab, ensure_ascii=False), encoding='utf-8')
    tokens = encode_bursts(bursts, vocab)
    tokens.tofile(work / 'mono.bin')
    uni = np.bincount(tokens, minlength=1 << 15)
    np.save(work / 'mono-unigram.npy', uni)
    t0 = time.time()
    for order in range(2, ORDER + 1):
        ctx, word, amount, total = count_order(tokens, order)
        np.savez(work / f'mono-{order}.npz', ctx=ctx, word=word, count=amount, total=total)
        rows = {m: int((amount >= m).sum()) for m in (3, 5, 8, 12, 20, 30, 40)}
        print(f'  order {order}: {rows}, {time.time() - t0:.0f}s', flush=True)
    dest_dir = OUT_ROOT / lang / str(ver)
    dest_dir.mkdir(parents=True, exist_ok=True)
    prefix = dest_dir / 'table'
    meta = export_table('mono', vocab, work, prefix)
    meta['url'] = f'/chat-cipher/{lang}/{ver}/table.bin'
    meta['lang'] = lang
    meta['version'] = ver
    (dest_dir / 'table.meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    return meta


def main():
    only = sys.argv[1:] or list(LANGS)
    manifest = {}
    for lang in only:
        if lang not in LANGS:
            raise SystemExit(f'unknown lang {lang}')
        manifest[lang] = build_lang(lang, LANGS[lang])
    (WORK / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('DONE', json.dumps({k: {'sha': v['sha256'][:16], 'gzip_mb': v['gzip_mb'], 'words': v['words']} for k, v in manifest.items()}, indent=2), flush=True)


if __name__ == '__main__':
    main()
