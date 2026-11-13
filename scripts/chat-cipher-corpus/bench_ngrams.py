#!/usr/bin/env python3
"""Tiny coverage benchmark over clean JSONL: vocab size, bigram entropy proxy, top repeats."""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)
ROOT = Path(__file__).resolve().parents[2] / "data"


def fold(s: str) -> str:
    return s.casefold()


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True)
    args = ap.parse_args(argv)
    path = ROOT / f"chat-cipher-{args.lang}" / "clean" / "all.clean.jsonl"
    if not path.exists():
        print(f"missing {path}; run validate_filter.py first", file=sys.stderr)
        return 1
    uni: Counter[str] = Counter()
    bi: Counter[tuple[str, str]] = Counter()
    bursts = 0
    messages = 0
    for line in path.open(encoding="utf-8"):
        row = json.loads(line)
        bursts += 1
        for msg in row["messages"]:
            messages += 1
            toks = [fold(t) for t in TOKEN.findall(msg)]
            uni.update(toks)
            bi.update(zip(toks, toks[1:]))
    total_u = sum(uni.values()) or 1
    total_b = sum(bi.values()) or 1
    def ent(counter: Counter, total: int) -> float:
        return -sum((c / total) * math.log2(c / total) for c in counter.values())

    report = {
        "lang": args.lang,
        "bursts": bursts,
        "messages": messages,
        "unique_unigrams": len(uni),
        "unique_bigrams": len(bi),
        "unigram_entropy_bits": round(ent(uni, total_u), 3),
        "bigram_entropy_bits": round(ent(bi, total_b), 3),
        "top_unigrams": uni.most_common(15),
        "top_bigrams": [(" ".join(k), v) for k, v in bi.most_common(15)],
        "msgs_per_burst": round(messages / bursts, 2) if bursts else 0,
    }
    out = ROOT / f"chat-cipher-{args.lang}" / "BENCH_REPORT.json"
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    out.write_text(payload, encoding="utf-8")
    try:
        print(payload, end="")
    except UnicodeEncodeError:
        print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
